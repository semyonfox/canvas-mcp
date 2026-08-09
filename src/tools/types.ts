import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { CanvasClient } from "../canvas/client.js";

export interface ToolContext {
    canvas: CanvasClient;
}

// The registry stores heterogeneous Zod schemas. Keep its erased boundary as
// `any` so individual tool modules retain their contextual argument types
// under Zod 4 rather than collapsing every handler argument to `unknown`.
export interface ToolDef<Schema extends z.ZodType = z.ZodType<any>> {
    name: string;
    title?: string;
    description: string;
    annotations?: ToolAnnotations;
    inputSchema: Schema;
    handler: (args: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
    structuredContent?: unknown;
}

export function textResult(text: string): ToolResult {
    return { content: [{ type: "text", text }] };
}

export function jsonResult(value: unknown): ToolResult {
    return {
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        structuredContent: value,
    };
}
