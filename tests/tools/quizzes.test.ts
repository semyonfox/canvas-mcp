import { describe, it, expect, vi } from "vitest";
import { quizTools } from "../../src/tools/quizzes.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = quizTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("quiz tools", () => {
    it("canvas_list_quizzes calls collectPaginated for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, title: "Midterm Quiz" }]);
        const tool = findTool("canvas_list_quizzes");
        const result = await tool.handler(
            { course_id: 10 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/quizzes",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Midterm Quiz");
    });

    it("canvas_list_quizzes passes search_term when provided", async () => {
        const collect = vi.fn().mockResolvedValue([]);
        const tool = findTool("canvas_list_quizzes");
        await tool.handler(
            { course_id: 10, search_term: "final" },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/quizzes",
            expect.objectContaining({ search_term: "final" }),
        );
    });

    it("canvas_get_quiz fetches a single quiz", async () => {
        const get = vi.fn().mockResolvedValue({ id: 5, title: "Final Exam" });
        const tool = findTool("canvas_get_quiz");
        const result = await tool.handler(
            { course_id: 10, quiz_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/quizzes/5",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Final Exam");
    });

    it("canvas_list_my_quiz_submissions calls collectPaginated", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, score: 95 }]);
        const tool = findTool("canvas_list_my_quiz_submissions");
        const result = await tool.handler(
            { course_id: 10, quiz_id: 5 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/quizzes/5/submissions",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("95");
    });

    it("canvas_get_my_quiz_submission fetches the self submission", async () => {
        const get = vi.fn().mockResolvedValue({ id: 1, score: 88, attempts_allowed: 3 });
        const tool = findTool("canvas_get_my_quiz_submission");
        const result = await tool.handler(
            { course_id: 10, quiz_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/quizzes/5/submissions/self",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("88");
    });
});
