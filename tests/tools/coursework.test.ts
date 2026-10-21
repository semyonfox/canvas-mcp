import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../../src/canvas/client.js";
import { courseworkTools } from "../../src/tools/coursework.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");

function plannerItem(overrides: Record<string, unknown>, submissions: Record<string, boolean> | false, plannable: Record<string, unknown>) {
    return {
        course_id: "5",
        context_name: "CT216 Software Engineering",
        plannable_type: "assignment",
        html_url: "/courses/5/assignments/1",
        planner_override: null,
        submissions,
        plannable,
        ...overrides,
    };
}

const planner = [
    plannerItem({ plannable_id: "1" }, { submitted: false }, { title: "Lab 4", due_at: "2026-10-25T23:59:00Z", points_possible: 10 }),
    plannerItem({ plannable_id: "2" }, { submitted: false, missing: true }, { title: "Lab 3", due_at: "2026-10-18T23:59:00Z" }),
    plannerItem({ plannable_id: "3" }, { submitted: false }, { title: "Lab 3b", due_at: "2026-10-20T23:59:00Z" }),
    plannerItem({ plannable_id: "4" }, { submitted: true, late: true }, { title: "Essay", due_at: "2026-10-19T23:59:00Z" }),
    plannerItem({ plannable_id: "5" }, { submitted: true, graded: true, has_feedback: true }, { title: "Quiz 1" }),
    plannerItem({ plannable_id: "6", planner_override: { marked_complete: true } }, { submitted: false }, { title: "Paper handin", due_at: "2026-10-26T10:00:00Z" }),
    plannerItem({ plannable_id: "7", plannable_type: "quiz" }, { submitted: false }, { title: "Quiz 2", due_at: "2026-10-23T10:00:00Z", assignment_id: "70" }),
    plannerItem({ plannable_id: "8", plannable_type: "announcement" }, false, { title: "Welcome" }),
];

const missing = [
    { id: "2", name: "Lab 3", course_id: "5", due_at: "2026-10-18T23:59:00Z", course: { name: "CT216 Software Engineering" } },
    { id: "40", name: "Old project", course_id: "9", due_at: "2026-09-01T23:59:00Z", course: { name: "CT2106 OOP" } },
];

function run(args: Record<string, unknown>) {
    const collectPaginated = vi.fn(async (path: string) => (path === "/api/v1/planner/items" ? planner : missing));
    const tool = courseworkTools[0]!;
    const canvas = { collectPaginated } as unknown as CanvasClient;
    return { collectPaginated, result: tool.handler(tool.inputSchema.parse(args), { canvas }) };
}

interface Row { title: string; status: string; assignment_id?: string }

describe("canvas_list_my_coursework", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it("lists work still to hand in, oldest due first, merging Canvas's missing list", async () => {
        const { result, collectPaginated } = run({});
        const body = (await result).structuredContent as { items: Row[]; counts: Record<string, number> };

        expect(body.items.map((row) => [row.title, row.status])).toEqual([
            ["Old project", "missing"],
            ["Lab 3", "missing"],
            ["Lab 3b", "overdue"],
            ["Quiz 2", "not_submitted"],
            ["Lab 4", "not_submitted"],
        ]);
        expect(body.counts).toEqual({ missing: 2, overdue: 1, not_submitted: 2 });
        expect(body.items.find((row) => row.title === "Quiz 2")?.assignment_id).toBe("70");

        expect(collectPaginated).toHaveBeenCalledWith("/api/v1/planner/items", {
            per_page: 100,
            start_date: "2026-10-14T12:00:00.000Z",
            end_date: "2026-11-04T12:00:00.000Z",
        });
    });

    it("shows every submittable item with status=all and skips non-submittable planner entries", async () => {
        const body = (await run({ status: "all" }).result).structuredContent as { items: Row[] };
        const statuses = Object.fromEntries(body.items.map((row) => [row.title, row.status]));

        expect(statuses).toMatchObject({ "Essay": "submitted_late", "Quiz 1": "graded", "Paper handin": "not_submitted" });
        expect(statuses).not.toHaveProperty("Welcome");
    });

    it("scopes both Canvas calls to the requested courses", async () => {
        const { result, collectPaginated } = run({ course_ids: ["5"], days_ahead: 3, days_back: 0 });
        await result;
        expect(collectPaginated).toHaveBeenCalledWith("/api/v1/planner/items", expect.objectContaining({
            context_codes: ["course_5"],
            start_date: "2026-10-21T12:00:00.000Z",
        }));
        expect(collectPaginated).toHaveBeenCalledWith("/api/v1/users/self/missing_submissions", expect.objectContaining({
            course_ids: ["5"],
            filter: ["submittable"],
        }));
    });
});
