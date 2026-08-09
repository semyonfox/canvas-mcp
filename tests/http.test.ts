import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { createCanvasHttpServer, type CanvasHttpServer } from "../src/http.js";

interface RunningServer {
    server: CanvasHttpServer;
    url: string;
}

async function startServer(cfg: Config): Promise<RunningServer> {
    const server = createCanvasHttpServer(cfg);
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, cfg.host, () => {
            server.off("error", reject);
            resolve();
        });
    });
    const address = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: CanvasHttpServer): Promise<void> {
    await server.closeMcpHandler();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function requestWithHost(url: string, host: string): Promise<number> {
    const target = new URL(url);
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            {
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port,
                path: target.pathname,
                headers: { host },
            },
            (res) => {
                res.resume();
                res.on("end", () => resolve(res.statusCode ?? 0));
            },
        );
        req.on("error", reject);
        req.end();
    });
}

describe("Canvas MCP HTTP shell", () => {
    it("serves a modern stateless MCP exchange before requiring Canvas credentials", async () => {
        const { server, url } = await startServer(loadConfig({}));
        const requests: Array<{ headers: Headers; body: string }> = [];
        const mcpFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const request = new Request(input, init);
            requests.push({ headers: new Headers(request.headers), body: await request.clone().text() });
            return fetch(request);
        };
        const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { fetch: mcpFetch });
        const client = new Client(
            { name: "canvas-mcp-http-test", version: "1.0.0" },
            { versionNegotiation: { mode: { pin: "2026-07-28" } } },
        );

        try {
            await client.connect(transport);
            expect(client.getProtocolEra()).toBe("modern");
            expect(client.getDiscoverResult()).toMatchObject({
                ttlMs: 300_000,
                cacheScope: "public",
                supportedVersions: expect.arrayContaining(["2026-07-28"]),
            });

            const tools = await client.listTools();
            expect(tools.tools).toContainEqual(expect.objectContaining({ name: "canvas_get_my_profile" }));

            const toolResult = await client.callTool({ name: "canvas_get_my_profile", arguments: {} });
            expect(toolResult).toMatchObject({ isError: true });
            expect(toolResult.content).toContainEqual(
                expect.objectContaining({ type: "text", text: expect.stringContaining("Canvas credentials missing") }),
            );

            expect(requests[0]?.headers.get("mcp-protocol-version")).toBe("2026-07-28");
            expect(requests[0]?.headers.get("mcp-method")).toBe("server/discover");
            expect(requests.every((request) => !request.headers.has("mcp-session-id"))).toBe(true);
            expect(requests.map((request) => JSON.parse(request.body).method)).not.toContain("initialize");
        } finally {
            await client.close();
            await stopServer(server);
        }
    });

    it("keeps the endpoint surface and browser origins constrained", async () => {
        const { server, url } = await startServer(
            loadConfig({ MCP_ALLOWED_ORIGINS: "https://client.example.test" }),
        );

        try {
            const health = await fetch(`${url}/health`);
            expect(health.status).toBe(200);
            await expect(health.json()).resolves.toEqual({ ok: true });

            expect((await fetch(`${url}/`)).status).toBe(404);
            expect((await fetch(`${url}/mcp`, { method: "OPTIONS" })).status).toBe(204);

            const allowedPreflight = await fetch(`${url}/mcp`, {
                method: "OPTIONS",
                headers: { origin: "https://client.example.test" },
            });
            expect(allowedPreflight.status).toBe(204);
            expect(allowedPreflight.headers.get("access-control-allow-origin")).toBe(
                "https://client.example.test",
            );
            expect(allowedPreflight.headers.get("access-control-allow-origin")).not.toBe("*");

            const rejectedOrigin = await fetch(`${url}/mcp`, {
                method: "OPTIONS",
                headers: { origin: "http://client.example.test" },
            });
            expect(rejectedOrigin.status).toBe(403);

            expect(await requestWithHost(`${url}/health`, "attacker.example.test")).toBeGreaterThanOrEqual(400);
        } finally {
            await stopServer(server);
        }
    });

    it("retains the SDK's stateless legacy compatibility path without sessions", async () => {
        const { server, url } = await startServer(loadConfig({}));
        const headers = {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
        };

        try {
            const initialize = await fetch(`${url}/mcp`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-11-25",
                        capabilities: {},
                        clientInfo: { name: "legacy-http-test", version: "1.0.0" },
                    },
                }),
            });
            expect(initialize.status).toBe(200);
            expect(initialize.headers.get("mcp-session-id")).toBeNull();
            await expect(initialize.text()).resolves.toContain('"protocolVersion":"2025-11-25"');

            const tools = await fetch(`${url}/mcp`, {
                method: "POST",
                headers,
                body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
            });
            expect(tools.status).toBe(200);
            expect(tools.headers.get("mcp-session-id")).toBeNull();
            await expect(tools.text()).resolves.toContain('"name":"canvas_get_my_profile"');
        } finally {
            await stopServer(server);
        }
    });
});
