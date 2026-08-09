import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
    hostHeaderValidation,
    localhostHostValidation,
    originValidation,
    toNodeHandler,
    type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { CanvasClient } from "./canvas/client.js";
import { type Config, resolveCanvasCredentials } from "./config.js";
import { createCanvasMcpServer } from "./server.js";

export interface HttpServerOptions {
    onError?: (error: Error) => void;
}

export interface CanvasHttpServer extends Server {
    /** Closes modern per-request exchanges and subscription streams. */
    closeMcpHandler(): Promise<void>;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
    const value = req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

function requestOrigin(req: IncomingMessage): string | undefined {
    const origin = headerValue(req, "origin");
    if (!origin) return undefined;
    try {
        return new URL(origin).origin;
    } catch {
        return undefined;
    }
}

function originHostname(origin: string): string {
    const hostname = new URL(origin).hostname;
    return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function setCorsHeaders(res: ServerResponse, origin: string): void {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader(
        "access-control-allow-headers",
        "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, X-Canvas-Token, X-Canvas-Domain",
    );
    res.setHeader("vary", "Origin");
}

/**
 * Creates the Node HTTP shell around the SDK's dual-era MCP handler. The MCP
 * handler itself owns protocol-version, metadata, and Mcp-Method/Mcp-Name
 * validation; this shell owns endpoint routing and HTTP boundary hardening.
 */
export function createCanvasHttpServer(cfg: Config, options: HttpServerOptions = {}): CanvasHttpServer {
    const handler = createMcpHandler(
        (ctx) => {
            let canvas: CanvasClient | undefined;
            const getCanvasClient = (): CanvasClient => {
                if (!canvas) {
                    const credentials = resolveCanvasCredentials(ctx.requestInfo?.headers, cfg);
                    canvas = new CanvasClient(credentials);
                }
                return canvas;
            };
            return createCanvasMcpServer(getCanvasClient);
        },
        {
            // Retain the safe, per-request 2025 compatibility path while
            // serving 2026-07-28 as the primary protocol revision.
            legacy: "stateless",
            responseMode: "auto",
            ...(options.onError ? { onerror: options.onError } : {}),
        },
    );
    const handleMcpRequest = toNodeHandler(
        handler,
        options.onError ? { onerror: options.onError } : {},
    );
    const validateHost = cfg.allowedHosts.length > 0
        ? hostHeaderValidation([...cfg.allowedHosts])
        : localhostHostValidation();
    const allowedOrigins = new Set(cfg.allowedOrigins);
    const validateOrigin = cfg.allowedOrigins.length > 0
        ? originValidation([...new Set(cfg.allowedOrigins.map(originHostname))])
        : undefined;

    const server = createServer(async (req, res) => {
        if (!validateHost(req, res)) return;
        if (validateOrigin && !validateOrigin(req, res)) return;

        const origin = requestOrigin(req);
        if (headerValue(req, "origin") && (!origin || !allowedOrigins.has(origin))) {
            writeJson(res, 403, { error: "Origin is not allowed." });
            return;
        }
        if (origin) setCorsHeaders(res, origin);

        const url = new URL(req.url ?? "/", "http://canvas-mcp.local");
        if (req.method === "OPTIONS" && url.pathname === "/mcp") {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === "GET" && url.pathname === "/health") {
            writeJson(res, 200, { ok: true });
            return;
        }
        if (url.pathname !== "/mcp") {
            writeJson(res, 404, { error: "Not found." });
            return;
        }

        await handleMcpRequest(req as unknown as NodeIncomingMessageLike, res);
    });

    return Object.assign(server, {
        closeMcpHandler: () => handler.close(),
    });
}
