import { describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../../src/canvas/client.js";
import { progressTools } from "../../src/tools/progress.js";

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("progress tools", () => {
    it("canvas_get_progress fetches a Canvas asynchronous job by ID", async () => {
        const get = vi.fn().mockResolvedValue({ id: "9007199254740993", workflow_state: "running" });
        const tool = progressTools.find((candidate) => candidate.name === "canvas_get_progress");
        if (!tool) throw new Error("canvas_get_progress not registered");

        const result = await tool.handler(
            { progress_id: "9007199254740993" },
            { canvas: fakeCanvas({ get }) },
        );

        expect(get).toHaveBeenCalledWith("/api/v1/progress/9007199254740993", {});
        expect(result.content[0].text).toContain("running");
    });
});
