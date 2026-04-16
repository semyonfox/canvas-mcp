import { describe, it, expect, vi } from "vitest";
import { submissionTools } from "../../src/tools/submissions.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = submissionTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("submission tools", () => {
    it("canvas_get_my_submission hits the self submission endpoint", async () => {
        const get = vi.fn().mockResolvedValue({ id: 101, score: 88, workflow_state: "graded" });
        const tool = findTool("canvas_get_my_submission");
        const result = await tool.handler(
            { course_id: 5, assignment_id: 10 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/5/assignments/10/submissions/self",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("graded");
    });

    it("canvas_list_my_submissions calls collectPaginated with student_ids=self", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 202, assignment_id: 10, workflow_state: "submitted" }]);
        const tool = findTool("canvas_list_my_submissions");
        const result = await tool.handler(
            { course_id: 5 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/5/students/submissions",
            expect.objectContaining({ per_page: 100, student_ids: ["self"] }),
        );
        expect(result.content[0].text).toContain("submitted");
    });

    it("canvas_get_submission_comments wraps include submission_comments", async () => {
        const get = vi.fn().mockResolvedValue({ id: 303, submission_comments: [{ comment: "Nice work" }] });
        const tool = findTool("canvas_get_submission_comments");
        const result = await tool.handler(
            { course_id: 5, assignment_id: 10 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/5/assignments/10/submissions/self",
            expect.objectContaining({ include: ["submission_comments"] }),
        );
        expect(result.content[0].text).toContain("Nice work");
    });

    it("canvas_list_peer_reviews_todo calls get on todo and returns items", async () => {
        const get = vi.fn().mockResolvedValue([
            { type: "reviewing", assignment: { id: 7, name: "Lab Report" } },
            { type: "submitting", assignment: { id: 8, name: "Essay" } },
        ]);
        const tool = findTool("canvas_list_peer_reviews_todo");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/users/self/todo", {});
        expect(result.content[0].text).toContain("reviewing");
    });

    it("canvas_list_peer_reviews_for_assignment calls collectPaginated on peer_reviews endpoint", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 404, assessor_id: 11 }]);
        const tool = findTool("canvas_list_peer_reviews_for_assignment");
        const result = await tool.handler(
            { course_id: 5, assignment_id: 10 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/5/assignments/10/peer_reviews",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("assessor_id");
    });
});
