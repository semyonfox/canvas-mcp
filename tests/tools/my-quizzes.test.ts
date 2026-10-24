import { describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../../src/canvas/client.js";
import { CanvasError } from "../../src/canvas/errors.js";
import { quizTools } from "../../src/tools/quizzes.js";

const tool = quizTools.find((t) => t.name === "canvas_list_my_quizzes")!;

function run(args: Record<string, unknown>, canvas: Partial<CanvasClient>) {
    return tool.handler(tool.inputSchema.parse(args), { canvas: canvas as CanvasClient });
}

const quizzes: Record<string, unknown> = {
    "/api/v1/courses/5/quizzes/1": { id: "1", title: "Checkpoint 5", allowed_attempts: 2, time_limit: 20, points_possible: 8, hide_results: null },
    "/api/v1/courses/5/quizzes/2": { id: "2", title: "Checkpoint 6", allowed_attempts: -1, points_possible: 8, hide_results: "always" },
    "/api/v1/courses/6/quizzes/3": { id: "3", title: "Locked quiz", allowed_attempts: 1, locked_for_user: true, lock_explanation: "Locked until Monday." },
};

const submissions: Record<string, unknown> = {
    "/api/v1/courses/5/quizzes/1/submission": {
        quiz_submissions: [{ attempt: 1, attempts_left: 1, workflow_state: "complete", score: 6, kept_score: 6 }],
    },
    "/api/v1/courses/5/quizzes/2/submission": {
        quiz_submissions: [{ attempt: 1, workflow_state: "untaken", end_at: "2026-10-21T12:20:00Z" }],
    },
    "/api/v1/courses/6/quizzes/3/submission": { quiz_submissions: [] },
};

const get = vi.fn(async (path: string) => {
    if (path === "/api/v1/courses/7/quizzes/4/submission") throw new CanvasError(404, "Canvas GET failed: not found");
    return submissions[path] ?? quizzes[path] ?? null;
});

describe("canvas_list_my_quizzes", () => {
    it("finds quizzes across courses from the planner and reports attempt status", async () => {
        const collectPaginated = vi.fn().mockResolvedValue([
            { plannable_type: "quiz", plannable_id: "1", course_id: "5", context_name: "CT326" },
            { plannable_type: "quiz", plannable_id: "2", course_id: "5", context_name: "CT326" },
            { plannable_type: "quiz", plannable_id: "3", course_id: "6", context_name: "CT3536" },
            { plannable_type: "quiz", plannable_id: "4", course_id: "7", context_name: "Broken" },
            { plannable_type: "assignment", plannable_id: "9", course_id: "5" },
        ]);

        const rows = (await run({}, { get, collectPaginated })).structuredContent as Array<Record<string, unknown>>;

        expect(collectPaginated).toHaveBeenCalledWith("/api/v1/planner/items", expect.objectContaining({ per_page: 100 }));
        expect(rows).toHaveLength(4);
        expect(rows[0]).toMatchObject({
            title: "Checkpoint 5", status: "submitted", attempts_used: 1, attempts_left: 1,
            allowed_attempts: 2, kept_score: 6, time_limit_minutes: 20, results_hidden: "never",
        });
        expect(rows[1]).toMatchObject({
            title: "Checkpoint 6", status: "in_progress", allowed_attempts: null, attempts_left: null,
            attempt_ends_at: "2026-10-21T12:20:00Z", results_hidden: "always",
        });
        expect(rows[2]).toMatchObject({ status: "locked", attempts_used: 0, attempts_left: 1, lock_explanation: "Locked until Monday." });
        expect(rows[3]).toEqual({ course_id: "7", quiz_id: "4", error: "Canvas GET failed: not found" });
    });

    it("covers every quiz in one course without re-fetching quiz objects", async () => {
        const courseGet = vi.fn(async (path: string) => submissions[path] ?? null);
        const collectPaginated = vi.fn().mockResolvedValue([quizzes["/api/v1/courses/5/quizzes/1"]]);

        const rows = (await run({ course_id: "5" }, { get: courseGet, collectPaginated })).structuredContent as Array<Record<string, unknown>>;

        expect(collectPaginated).toHaveBeenCalledWith("/api/v1/courses/5/quizzes", { per_page: 100 });
        expect(courseGet).toHaveBeenCalledTimes(1);
        expect(rows[0]).toMatchObject({ quiz_id: "1", status: "submitted" });
    });
});
