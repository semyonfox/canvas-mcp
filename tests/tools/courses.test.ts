import { describe, it, expect, vi } from "vitest";
import { courseTools } from "../../src/tools/courses.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = courseTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("course tools", () => {
    it("canvas_list_courses calls collectPaginated with filters", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, name: "Intro" }]);
        const tool = findTool("canvas_list_courses");
        const result = await tool.handler(
            { enrollment_state: "active" },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith("/api/v1/courses", expect.objectContaining({
            enrollment_state: "active",
            per_page: 100,
        }));
        expect(result.content[0].text).toContain("Intro");
    });

    it("canvas_get_course hits the single-course endpoint", async () => {
        const get = vi.fn().mockResolvedValue({ id: 42, name: "CT216" });
        const tool = findTool("canvas_get_course");
        const result = await tool.handler({ course_id: 42 }, { canvas: fakeCanvas({ get }) });
        expect(get).toHaveBeenCalledWith("/api/v1/courses/42", expect.any(Object));
        expect(result.content[0].text).toContain("CT216");
    });

    it("canvas_list_sections returns sections for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 7, name: "Section A" }]);
        const tool = findTool("canvas_list_sections");
        const result = await tool.handler({ course_id: 42 }, { canvas: fakeCanvas({ collectPaginated: collect }) });
        expect(collect).toHaveBeenCalledWith("/api/v1/courses/42/sections", expect.any(Object));
        expect(result.content[0].text).toContain("Section A");
    });
});
