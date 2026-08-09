import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CanvasClient } from "./canvas/client.js";
import { CanvasCredentialsError } from "./config.js";
import { CanvasError } from "./canvas/errors.js";
import { allTools } from "./tools/index.js";
import type { ToolDef, ToolResult } from "./tools/types.js";

export const SERVER_NAME = "canvas-mcp";
export const SERVER_VERSION = "0.2.0";

export type CanvasClientProvider = () => CanvasClient;

const JSON_VALUE_SCHEMA = z.unknown();

const READ_ONLY_PREFIXES = ["canvas_get_", "canvas_list_"];
const DESTRUCTIVE_NAMES = new Set([
    "canvas_bulk_delete_announcements",
    "canvas_delete_announcement",
    "canvas_delete_assignment",
    "canvas_delete_calendar_event",
    "canvas_delete_conversation",
    "canvas_delete_discussion_topic",
    "canvas_delete_file",
    "canvas_delete_module",
    "canvas_delete_module_item",
    "canvas_delete_page",
    "canvas_delete_planner_note",
    "canvas_delete_quiz",
    "canvas_delete_quiz_question",
    "canvas_delete_rubric",
    "canvas_revert_page_revision",
]);

function humaniseToolName(name: string): string {
    return `Canvas: ${name
        .replace(/^canvas_/, "")
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")}`;
}

function defaultAnnotations(tool: ToolDef): ToolAnnotations {
    const readOnly = READ_ONLY_PREFIXES.some((prefix) => tool.name.startsWith(prefix));
    // MCP treats an omitted destructive hint conservatively. Only affirm that
    // a tool is non-destructive when it is actually read-only; updates and
    // state changes must not accidentally opt callers out of confirmation UX.
    const destructiveHint = readOnly
        ? false
        : DESTRUCTIVE_NAMES.has(tool.name)
            ? true
            : undefined;
    return {
        readOnlyHint: readOnly,
        ...(destructiveHint === undefined ? {} : { destructiveHint }),
        ...(readOnly ? { idempotentHint: true } : {}),
        // Every live tool sends a request to the tenant selected by the
        // deployment, which is external to the MCP host.
        openWorldHint: true,
        ...tool.annotations,
    };
}

function asMcpResult(result: ToolResult) {
    return {
        content: result.content,
        ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: result.structuredContent }),
        ...(result.isError ? { isError: true } : {}),
    };
}

function errorResult(error: unknown) {
    if (error instanceof CanvasCredentialsError || error instanceof CanvasError) {
        return {
            content: [{ type: "text" as const, text: error.message }],
            isError: true,
        };
    }

    const message = error instanceof Error ? error.message : "Unexpected Canvas tool failure.";
    return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Builds a fresh MCP server for one request. `createMcpHandler` calls this
 * factory once per exchange in the 2026-07-28 era, keeping Canvas credentials
 * and HTTP request state out of long-lived MCP sessions.
 */
export function createCanvasMcpServer(getCanvasClient: CanvasClientProvider): McpServer {
    const server = new McpServer(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            capabilities: { tools: {} },
            instructions:
                "Use Canvas tools to inspect or change Canvas LMS data. Canvas identifiers are strings to preserve 64-bit IDs. Mutating tools may affect live coursework.",
            cacheHints: {
                "server/discover": { ttlMs: 300_000, cacheScope: "public" },
                "tools/list": { ttlMs: 300_000, cacheScope: "public" },
            },
        },
    );

    for (const tool of allTools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title ?? humaniseToolName(tool.name),
                description: tool.description,
                inputSchema: tool.inputSchema,
                outputSchema: JSON_VALUE_SCHEMA,
                annotations: defaultAnnotations(tool),
            },
            async (args) => {
                try {
                    const result = await tool.handler(args, { canvas: getCanvasClient() });
                    return asMcpResult(result);
                } catch (error) {
                    return errorResult(error);
                }
            },
        );
    }

    return server;
}
