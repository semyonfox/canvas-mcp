import { z } from "zod";

/**
 * Canvas resource IDs are 64-bit values. Accept their canonical decimal
 * string form, while retaining compatibility with legacy JSON-number callers
 * only when the number can be represented exactly by JavaScript.
 */
export const canvasId = z
    .union([
        z.string().regex(/^[1-9]\d*$/, "Canvas IDs must be positive decimal strings"),
        z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ])
    .transform((value) => String(value));
