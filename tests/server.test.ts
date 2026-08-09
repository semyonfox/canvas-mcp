import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasClient } from "../src/canvas/client.js";
import { createCanvasMcpServer, SERVER_NAME, SERVER_VERSION } from "../src/server.js";

interface CapturedRequest {
    headers: Headers;
    body: string;
}

async function createModernClient(canvasFetch = vi.fn()) {
    const canvas = new CanvasClient({
        domain: "canvas.example.test",
        token: "test-token",
        fetch: canvasFetch,
    });
    const handler = createMcpHandler(() => createCanvasMcpServer(() => canvas), {
        legacy: "stateless",
        responseMode: "auto",
    });
    const requests: CapturedRequest[] = [];
    const transport = new StreamableHTTPClientTransport(new URL("http://mcp.example.test/mcp"), {
        fetch: async (input, init) => {
            const request = new Request(input, init);
            requests.push({ headers: new Headers(request.headers), body: await request.clone().text() });
            return handler.fetch(request);
        },
    });
    const client = new Client(
        { name: "canvas-mcp-integration-test", version: "1.0.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );

    await client.connect(transport);
    return { canvasFetch, client, handler, requests };
}

describe("Canvas MCP v2 server", () => {
    const closeables: Array<{ client: Client; handler: { close(): Promise<void> } }> = [];

    afterEach(async () => {
        await Promise.all(
            closeables.splice(0).map(async ({ client, handler }) => {
                await client.close();
                await handler.close();
            }),
        );
    });

    it("serves the 2026-07-28 discovery, cache, metadata, and structured-tool contracts", async () => {
        const canvasFetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ id: "9007199254740993", name: "Ada Lovelace" }), {
                headers: { "content-type": "application/json" },
            }),
        );
        const connection = await createModernClient(canvasFetch);
        closeables.push(connection);

        expect(connection.client.getProtocolEra()).toBe("modern");
        expect(connection.client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
        expect(connection.client.getServerVersion()).toEqual({ name: SERVER_NAME, version: SERVER_VERSION });
        expect(connection.client.getDiscoverResult()).toMatchObject({
            ttlMs: 300_000,
            cacheScope: "public",
            supportedVersions: expect.arrayContaining(["2026-07-28"]),
        });

        const toolList = await connection.client.listTools();
        expect(toolList).toMatchObject({ ttlMs: 300_000, cacheScope: "public" });

        const profile = toolList.tools.find((tool) => tool.name === "canvas_get_my_profile");
        expect(profile).toMatchObject({
            title: "Canvas: Get My Profile",
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                destructiveHint: false,
                openWorldHint: true,
            },
        });
        expect(toolList.tools.find((tool) => tool.name === "canvas_delete_page")).toMatchObject({
            annotations: { destructiveHint: true },
        });
        expect(
            toolList.tools.find((tool) => tool.name === "canvas_update_page")?.annotations?.destructiveHint,
        ).not.toBe(false);

        const result = await connection.client.callTool({ name: "canvas_get_my_profile", arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toEqual({ id: "9007199254740993", name: "Ada Lovelace" });
        expect(canvasFetch).toHaveBeenCalledWith(
            "https://canvas.example.test/api/v1/users/self/profile",
            expect.objectContaining({ method: "GET" }),
        );

        expect(connection.requests).not.toHaveLength(0);
        expect(connection.requests[0]?.headers.get("mcp-protocol-version")).toBe("2026-07-28");
        expect(connection.requests[0]?.headers.get("mcp-method")).toBe("server/discover");
        expect(connection.requests.every((request) => !request.headers.has("mcp-session-id"))).toBe(true);
        expect(connection.requests.map((request) => JSON.parse(request.body).method)).not.toContain("initialize");
    });
});
