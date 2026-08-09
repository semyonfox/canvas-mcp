import { describe, expect, it } from "vitest";
import { canvasId } from "../../src/tools/canvas-id.js";

describe("canvasId", () => {
    it("preserves a 64-bit Canvas ID supplied as a string", () => {
        expect(canvasId.parse("9223372036854775807")).toBe("9223372036854775807");
    });

    it("keeps safely representable legacy number inputs compatible", () => {
        expect(canvasId.parse(42)).toBe("42");
        expect(canvasId.parse(Number.MAX_SAFE_INTEGER)).toBe(String(Number.MAX_SAFE_INTEGER));
    });

    it.each(["0", "-1", "01", "42.5", Number.MAX_SAFE_INTEGER + 1])(
        "rejects an unsafe Canvas ID: %s",
        (value) => {
            expect(() => canvasId.parse(value)).toThrow();
        },
    );
});
