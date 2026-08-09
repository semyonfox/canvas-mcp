import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

export const progressTools: ToolDef[] = [
    {
        name: "canvas_get_progress",
        description:
            "Get completion and status information for an asynchronous Canvas job, such as a bulk assignment-date update.",
        inputSchema: z.object({
            progress_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const progress = await canvas.get(`/api/v1/progress/${args.progress_id}`, {});
            return jsonResult(progress);
        },
    },
];
