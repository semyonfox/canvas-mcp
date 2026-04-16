import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { zodToJsonSchema } from "zod-to-json-schema";
import { loadConfig } from "./config.js";
import { CanvasClient } from "./canvas/client.js";
import { allTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

const cfg = loadConfig();
const canvas = new CanvasClient({ domain: cfg.canvasDomain, token: cfg.canvasApiToken });
const ctx: ToolContext = { canvas };

const server = new Server(
    { name: "canvas-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema, { target: "openApi3" }) as Record<string, unknown>,
    })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = allTools.find((t) => t.name === req.params.name);
    if (!tool) {
        return { content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
    const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) {
        return { content: [{ type: "text" as const, text: `Invalid input: ${parsed.error.message}` }], isError: true };
    }
    try {
        const result = await tool.handler(parsed.data, ctx);
        return {
            content: result.content.map((c) => ({ type: "text" as const, text: c.text })),
            isError: result.isError,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
});

const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport as unknown as Transport);

const http = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }
    await transport.handleRequest(req, res);
});

http.listen(cfg.port, () => {
    console.log(JSON.stringify({ msg: "canvas-mcp listening", port: cfg.port, domain: cfg.canvasDomain }));
});
