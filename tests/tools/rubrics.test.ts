import { describe, it, expect, vi } from "vitest";
import { rubricTools } from "../../src/tools/rubrics.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = rubricTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("rubric tools", () => {
    it("canvas_list_rubrics calls collectPaginated for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, title: "Essay Rubric" }]);
        const tool = findTool("canvas_list_rubrics");
        const result = await tool.handler(
            { course_id: 10 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/rubrics",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Essay Rubric");
    });

    it("canvas_list_rubrics passes include when provided", async () => {
        const collect = vi.fn().mockResolvedValue([]);
        const tool = findTool("canvas_list_rubrics");
        await tool.handler(
            { course_id: 10, include: ["associations"] },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/rubrics",
            expect.objectContaining({ include: ["associations"] }),
        );
    });

    it("canvas_get_rubric fetches a single rubric", async () => {
        const get = vi.fn().mockResolvedValue({ id: 3, title: "Presentation Rubric" });
        const tool = findTool("canvas_get_rubric");
        const result = await tool.handler(
            { course_id: 10, rubric_id: 3 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/rubrics/3",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Presentation Rubric");
    });

    it("canvas_get_rubric passes include and style when provided", async () => {
        const get = vi.fn().mockResolvedValue({ id: 3, title: "Rubric" });
        const tool = findTool("canvas_get_rubric");
        await tool.handler(
            { course_id: 10, rubric_id: 3, include: ["assessments"], style: "full" },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/rubrics/3",
            expect.objectContaining({ include: ["assessments"], style: "full" }),
        );
    });

    it("canvas_get_rubric_statistics fetches assessments and returns stats", async () => {
        const get = vi.fn().mockResolvedValue({
            id: 3,
            title: "Stats Rubric",
            assessments: [
                { data: [{ points: 4 }, { points: 8 }] },
                { data: [{ points: 3 }, { points: 7 }] },
            ],
        });
        const tool = findTool("canvas_get_rubric_statistics");
        const result = await tool.handler(
            { course_id: 10, rubric_id: 3 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/rubrics/3",
            expect.objectContaining({ include: ["assessments"] }),
        );
        expect(result.content[0].text).toContain("Stats Rubric");
    });

    it("canvas_get_my_rubric_assessment fetches submission with rubric_assessment", async () => {
        const get = vi.fn().mockResolvedValue({
            id: 99,
            rubric_assessment: { criterion_1: { points: 10 } },
        });
        const tool = findTool("canvas_get_my_rubric_assessment");
        const result = await tool.handler(
            { course_id: 10, assignment_id: 7 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/assignments/7/submissions/self",
            expect.objectContaining({ include: ["rubric_assessment"] }),
        );
        expect(result.content[0].text).toContain("rubric_assessment");
    });
});
