import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasClient } from "../src/canvas/client.js";
import {
    createCanvasMcpServer,
    isReadOnlyTool,
    SERVER_NAME,
    SERVER_VERSION,
    type CanvasMcpServerOptions,
} from "../src/server.js";
import { allTools } from "../src/tools/index.js";

interface CapturedRequest {
    headers: Headers;
    body: string;
}

async function createModernClient(canvasFetch = vi.fn(), options: CanvasMcpServerOptions = {}) {
    const canvas = new CanvasClient({
        domain: "canvas.example.test",
        token: "test-token",
        fetch: canvasFetch,
    });
    const handler = createMcpHandler(() => createCanvasMcpServer(() => canvas, options), {
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
        const connection = await createModernClient(canvasFetch, { enableWrites: true });
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

    it("registers only read tools unless writes are enabled", async () => {
        const readOnly = await createModernClient();
        closeables.push(readOnly);
        const names = (await readOnly.client.listTools()).tools.map((tool) => tool.name);

        expect(names).toHaveLength(allTools.filter(isReadOnlyTool).length);
        expect(names).toContain("canvas_list_my_coursework");
        expect(names).not.toContain("canvas_submit_assignment");
        expect(names).not.toContain("canvas_send_conversation");
        expect(names).not.toContain("canvas_mark_module_item_read");
        expect(readOnly.client.getInstructions()).toContain("read-only");

        const readWrite = await createModernClient(vi.fn(), { enableWrites: true });
        closeables.push(readWrite);
        expect((await readWrite.client.listTools()).tools).toHaveLength(allTools.length);
    });
});

describe("read-only tool classification", () => {
    const READ_METHODS = new Set(["get", "getRaw", "getPaginated", "collectPaginated", "graphql"]);

    it("never lets a get or list tool call a mutating Canvas method", async () => {
        const offenders: string[] = [];
        for (const tool of allTools.filter(isReadOnlyTool)) {
            const called = new Set<string>();
            const canvas = new Proxy({}, {
                get: (_target, prop) => {
                    const method = String(prop);
                    if (method === "then") return undefined;
                    called.add(method);
                    if (method === "getPaginated") return async function* () {};
                    return async () => (method === "collectPaginated" ? [] : null);
                },
            }) as CanvasClient;
            // required arguments stay empty, so a handler may throw once it reaches one
            const parsed = tool.inputSchema.safeParse({});
            const args: unknown = parsed.success ? parsed.data : {};
            await tool.handler(args, { canvas }).catch(() => undefined);
            expect(called.size, `${tool.name} never reached Canvas`).toBeGreaterThan(0);
            const writes = [...called].filter((method) => !READ_METHODS.has(method));
            if (writes.length > 0) offenders.push(`${tool.name}: ${writes.join(", ")}`);
        }
        expect(offenders).toEqual([]);
    });
});
