import { describe, expect, it, vi } from "vitest";
import type { CanvasClient } from "../../src/canvas/client.js";
import { feedbackTools } from "../../src/tools/feedback.js";

function tool(name: string) {
    const found = feedbackTools.find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} not registered`);
    return found;
}

function run(name: string, args: Record<string, unknown>, canvas: Partial<CanvasClient>) {
    const t = tool(name);
    return t.handler(t.inputSchema.parse(args), { canvas: canvas as CanvasClient });
}

const assignment = {
    id: "10",
    name: "Lab Report",
    points_possible: 20,
    grading_type: "points",
    due_at: "2026-10-20T23:59:00Z",
    allowed_attempts: 3,
    rubric: [
        {
            id: "c1",
            description: "Analysis",
            long_description: "Depth of the analysis",
            points: 10,
            ratings: [{ id: "r1", description: "Full marks", points: 10 }, { id: "r2", description: "Partial", points: 5 }],
        },
        { id: "c2", description: "Formatting", points: 10, ratings: [{ id: "r3", description: "Good", points: 10 }] },
    ],
};

const submission = {
    workflow_state: "graded",
    submitted_at: "2026-10-20T22:00:00Z",
    graded_at: "2026-10-21T09:00:00Z",
    posted_at: "2026-10-21T09:00:00Z",
    attempt: 1,
    grade: "15",
    score: 15,
    late: false,
    points_deducted: null,
    attachments: [{ id: "900", display_name: "report.pdf", url: "https://x/files/900?verifier=do-not-leak" }],
    submission_comments: [{
        author_name: "Dr Byrne",
        comment: "Good start, expand section 2.",
        created_at: "2026-10-21T09:01:00Z",
        attempt: 1,
        attachments: [{ display_name: "marked.pdf", url: "https://x/files/1?verifier=do-not-leak" }],
    }],
    rubric_assessment: { c1: { rating_id: "r2", points: 5, comments: "Thin in places" } },
    submission_history: [{ attempt: 1, submitted_at: "2026-10-20T22:00:00Z", workflow_state: "graded", attachments: [{ display_name: "report.pdf" }] }],
};

describe("canvas_get_assignment_feedback", () => {
    it("merges rubric criteria with the assessment and reports attempts without URLs", async () => {
        const get = vi.fn(async (path: string) => (path.endsWith("/submissions/self") ? submission : assignment));
        const result = await run("canvas_get_assignment_feedback", { course_id: "5", assignment_id: "10" }, { get });

        expect(get).toHaveBeenCalledWith("/api/v1/courses/5/assignments/10/submissions/self", {
            include: ["submission_comments", "rubric_assessment"],
        });
        const body = result.structuredContent as Record<string, unknown>;
        expect(body.rubric).toEqual([
            { criterion: "Analysis", details: "Depth of the analysis", points_possible: 10, points: 5, rating: "Partial", comments: "Thin in places" },
            { criterion: "Formatting", points_possible: 10, points: null, rating: null, comments: null },
        ]);
        expect(body.comments).toEqual([{
            author: "Dr Byrne",
            comment: "Good start, expand section 2.",
            created_at: "2026-10-21T09:01:00Z",
            attempt: 1,
            files: ["marked.pdf"],
        }]);
        expect(body.attempts).toMatchObject({ allowed: 3, used: 1, remaining: 2, can_submit: true });
        expect(body.submission).toMatchObject({ grade: "15", grade_released: true, files: ["report.pdf"] });
        expect(body).not.toHaveProperty("history");
        expect(result.content[0]?.text).not.toContain("verifier");
    });

    it("adds earlier attempts with include_history and never asks for read_status", async () => {
        const get = vi.fn(async (path: string) => (path.endsWith("/submissions/self") ? submission : assignment));
        const result = await run("canvas_get_assignment_feedback", { course_id: "5", assignment_id: "10", include_history: true }, { get });

        const include = (get.mock.calls.find(([path]) => path.endsWith("/self")) as unknown[] | undefined)?.[1];
        expect(include).toEqual({ include: ["submission_comments", "rubric_assessment", "submission_history"] });
        expect((result.structuredContent as Record<string, unknown>).history).toEqual([
            { attempt: 1, submitted_at: "2026-10-20T22:00:00Z", workflow_state: "graded", late: false, files: ["report.pdf"] },
        ]);
    });

    it("returns null rubric when the assignment has none", async () => {
        const get = vi.fn(async (path: string) =>
            (path.endsWith("/submissions/self") ? { workflow_state: "unsubmitted" } : { id: "10", name: "Essay" }));
        const result = await run("canvas_get_assignment_feedback", { course_id: "5", assignment_id: "10" }, { get });
        expect((result.structuredContent as Record<string, unknown>).rubric).toBeNull();
    });
});

describe("canvas_list_my_feedback", () => {
    const node = (overrides: Record<string, unknown>) => ({
        unreadCommentCount: 0,
        hasUnreadRubricAssessment: false,
        readState: "read",
        gradedAt: "2026-10-01T10:00:00Z",
        postedAt: "2026-10-01T10:00:00Z",
        score: 8,
        grade: "8",
        late: false,
        missing: false,
        excused: false,
        assignment: { _id: "1", name: "Read", pointsPossible: 10, htmlUrl: "https://x/courses/5/assignments/1" },
        ...overrides,
    });

    const data = {
        user: {
            enrollments: [
                {
                    type: "StudentEnrollment",
                    course: {
                        _id: "5",
                        name: "CT216",
                        submissionsConnection: {
                            pageInfo: { hasNextPage: false },
                            nodes: [
                                node({}),
                                node({ unreadCommentCount: 2, gradedAt: "2026-10-03T10:00:00Z", assignment: { _id: "2", name: "Comments" } }),
                                node({ readState: "unread", gradedAt: "2026-10-05T10:00:00Z", assignment: { _id: "3", name: "New grade" } }),
                                node({ readState: "unread", score: null, grade: null, gradedAt: null, postedAt: null, assignment: { _id: "4", name: "Ungraded" } }),
                            ],
                        },
                    },
                },
                { type: "TaEnrollment", course: { _id: "9", name: "Tutoring", submissionsConnection: { nodes: [node({ unreadCommentCount: 5 })] } } },
            ],
        },
    };

    it("lists unread feedback newest first from one GraphQL query", async () => {
        const get = vi.fn().mockResolvedValue({ id: "42" });
        const graphql = vi.fn().mockResolvedValue(data);
        const result = await run("canvas_list_my_feedback", {}, { get, graphql });

        expect(graphql).toHaveBeenCalledWith(expect.stringContaining("unreadCommentCount"), { userId: "42" });
        const items = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        expect(items.map((item) => [item.title, item.unread_comments, item.unread_grade, item.released])).toEqual([
            ["New grade", 0, true, true],
            ["Comments", 2, false, true],
        ]);
    });

    it("includes read feedback when unread_only is false, skipping work with no feedback", async () => {
        const result = await run("canvas_list_my_feedback", { unread_only: false }, {
            get: vi.fn().mockResolvedValue({ id: "42" }),
            graphql: vi.fn().mockResolvedValue(data),
        });
        const titles = (result.structuredContent as { items: Array<{ title: string }> }).items.map((item) => item.title);
        expect(titles).toEqual(["New grade", "Comments", "Read"]);
    });
});

describe("canvas_mark_submission_read", () => {
    it("marks one item or the whole submission", async () => {
        const put = vi.fn().mockResolvedValue(null);
        await run("canvas_mark_submission_read", { course_id: "5", assignment_id: "10", item: "comment" }, { put });
        await run("canvas_mark_submission_read", { course_id: "5", assignment_id: "10" }, { put });
        expect(put.mock.calls.map(([path]) => path)).toEqual([
            "/api/v1/courses/5/assignments/10/submissions/self/read/comment",
            "/api/v1/courses/5/assignments/10/submissions/self/read",
        ]);
    });
});
