import { describe, it, expect, vi } from "vitest";
import { gradeTools } from "../../src/tools/grades.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = gradeTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("grade tools", () => {
    it("canvas_get_my_course_grades calls collectPaginated with course_id filter", async () => {
        const collect = vi.fn().mockResolvedValue([
            { id: 10, course_id: 42, grades: { current_grade: "A", final_grade: "A" } },
        ]);
        const tool = findTool("canvas_get_my_course_grades");
        const result = await tool.handler(
            { course_id: 42 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/users/self/enrollments",
            expect.objectContaining({ course_id: 42, per_page: 100 }),
        );
        expect(result.content[0].text).toContain("current_grade");
    });

    it("canvas_get_all_my_grades calls collectPaginated with state filter", async () => {
        const collect = vi.fn().mockResolvedValue([
            { id: 1, course_id: 10, grades: { final_score: 88 } },
            { id: 2, course_id: 20, grades: { final_score: 75 } },
        ]);
        const tool = findTool("canvas_get_all_my_grades");
        const result = await tool.handler(
            { state: ["active"] },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/users/self/enrollments",
            expect.objectContaining({ state: ["active"], per_page: 100 }),
        );
        expect(result.content[0].text).toContain("final_score");
    });

    it("canvas_list_recent_grades calls collectPaginated for enrollments", async () => {
        const collect = vi.fn().mockResolvedValue([
            { id: 5, course_id: 99, grades: { current_score: 90 } },
        ]);
        const tool = findTool("canvas_list_recent_grades");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/users/self/enrollments",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("current_score");
    });

    it("canvas_get_assignment_feedback hits the submission/self endpoint", async () => {
        const get = vi.fn().mockResolvedValue({
            id: 77,
            assignment_id: 5,
            grade: "B+",
            submission_comments: [{ comment: "Good work" }],
        });
        const tool = findTool("canvas_get_assignment_feedback");
        const result = await tool.handler(
            { course_id: 42, assignment_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/42/assignments/5/submissions/self",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Good work");
    });

    it("canvas_get_grading_standards calls collectPaginated for course grading standards", async () => {
        const collect = vi.fn().mockResolvedValue([
            { id: 3, title: "Letter Grade", grading_scheme: [{ name: "A", value: 0.94 }] },
        ]);
        const tool = findTool("canvas_get_grading_standards");
        const result = await tool.handler(
            { course_id: 42 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/42/grading_standards",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Letter Grade");
    });
});
