#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CanvasClient } from "./canvas/client.js";
import { loadConfig, resolveCanvasCredentials } from "./config.js";
import { createCanvasHttpServer } from "./http.js";
import { createCanvasMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const USAGE = `Usage: canvas-mcp [--http]

Runs the Canvas MCP server. With no flag it speaks MCP over stdio, which is
what Claude Code, Claude Desktop and Codex expect. --http serves MCP at
http://HOST:PORT/mcp instead.

Environment:
  CANVAS_API_TOKEN       your Canvas personal access token
  CANVAS_DOMAIN          your Canvas hostname, e.g. your-school.instructure.com
  CANVAS_ENABLE_WRITES   set to true to register tools that change Canvas
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    process.exit(0);
}
const unknown = args.filter((arg) => arg !== "--http");
if (unknown.length > 0) {
    process.stderr.write(`Unknown argument: ${unknown.join(" ")}\n\n${USAGE}`);
    process.exit(2);
}

const cfg = loadConfig();
const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const;

// stdout carries the protocol in stdio mode, so logs always go to stderr
function log(level: keyof typeof levels, event: Record<string, unknown>): void {
    if (levels[level] < levels[cfg.logLevel]) return;
    console.error(JSON.stringify({ level, ...event }));
}

if (args.includes("--http")) {
    startHttp();
} else {
    startStdio();
}

function startStdio(): void {
    // one client for the whole session so its request limiter covers every tool call
    let canvas: CanvasClient | undefined;
    const getCanvasClient = (): CanvasClient => {
        canvas ??= new CanvasClient(resolveCanvasCredentials(undefined, cfg));
        return canvas;
    };
    serveStdio(
        () => createCanvasMcpServer(getCanvasClient, {
            uploadRoots: cfg.uploadRoots,
            enableWrites: cfg.enableWrites,
        }),
        { onerror: (error) => log("error", { msg: "MCP stdio error", error: error.message }) },
    );
    log("info", {
        msg: "canvas-mcp ready on stdio",
        name: SERVER_NAME,
        version: SERVER_VERSION,
        writes: cfg.enableWrites ? "enabled" : "disabled",
        credentials: cfg.canvasDomain ? "configured" : "missing",
    });
    if (!cfg.canvasDomain) {
        log("warn", { msg: "CANVAS_API_TOKEN and CANVAS_DOMAIN are not set, so every tool call will fail" });
    }
}

function startHttp(): void {
    const http = createCanvasHttpServer(cfg, {
        onError: (error) => log("error", { msg: "MCP request failed", error: error.message }),
    });

    http.listen(cfg.port, cfg.host, () => {
        log("info", {
            msg: "canvas-mcp listening",
            name: SERVER_NAME,
            version: SERVER_VERSION,
            host: cfg.host,
            port: cfg.port,
            mcpEndpoint: "/mcp",
            writes: cfg.enableWrites ? "enabled" : "disabled",
            credentials: cfg.canvasDomain ? "server-default" : "none",
        });
    });

    let shuttingDown = false;

    function shutdown(signal: string): void {
        if (shuttingDown) return;
        shuttingDown = true;
        log("info", { msg: "shutting down", signal });
        void http.closeMcpHandler()
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                log("error", { msg: "failed to close MCP handler", error: message });
            })
            .finally(() => http.close(() => process.exit(0)));
        setTimeout(() => process.exit(1), 10_000).unref();
    }

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}
