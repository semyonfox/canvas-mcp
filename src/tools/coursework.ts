import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

const DAY_MS = 86_400_000;
const TODO_STATUSES = new Set(["missing", "overdue", "not_submitted", "redo_requested"]);

export type CourseworkStatus =
    | "excused"
    | "graded"
    | "redo_requested"
    | "submitted_late"
    | "submitted"
    | "missing"
    | "overdue"
    | "not_submitted";

export interface CourseworkItem {
    key: string;
    course_id: string | undefined;
    course: string | undefined;
    type: string;
    title: string | undefined;
    assignment_id: string | undefined;
    due_at: string | null;
    points_possible: number | null;
    status: CourseworkStatus;
    has_feedback: boolean;
    marked_complete: boolean;
    html_url: string | undefined;
}

const plannerSubmissionSchema = z.looseObject({
    submitted: z.boolean().optional(),
    excused: z.boolean().optional(),
    graded: z.boolean().optional(),
    late: z.boolean().optional(),
    missing: z.boolean().optional(),
    has_feedback: z.boolean().optional(),
    redo_request: z.boolean().optional(),
});

const idString = z.union([z.string(), z.number()]).transform(String);

// planner items are validated loosely: anything not submittable is dropped
const plannerItemSchema = z.looseObject({
    course_id: idString.optional(),
    context_name: z.string().optional(),
    plannable_id: idString,
    plannable_type: z.string(),
    plannable_date: z.string().nullable().optional(),
    html_url: z.string().optional(),
    planner_override: z.looseObject({ marked_complete: z.boolean().optional() }).nullable().optional(),
    submissions: z.union([z.literal(false), plannerSubmissionSchema]).optional(),
    plannable: z.looseObject({
        title: z.string().optional(),
        due_at: z.string().nullable().optional(),
        points_possible: z.number().nullable().optional(),
        assignment_id: idString.optional(),
    }).optional(),
});

const missingAssignmentSchema = z.looseObject({
    id: idString,
    name: z.string().optional(),
    course_id: idString.optional(),
    due_at: z.string().nullable().optional(),
    points_possible: z.number().nullable().optional(),
    html_url: z.string().optional(),
    course: z.looseObject({ name: z.string().optional() }).optional(),
});

function plannerStatus(flags: z.infer<typeof plannerSubmissionSchema>, dueAt: string | null, now: number): CourseworkStatus {
    if (flags.excused) return "excused";
    if (flags.graded) return "graded";
    if (flags.redo_request) return "redo_requested";
    if (flags.submitted) return flags.late ? "submitted_late" : "submitted";
    if (flags.missing) return "missing";
    if (dueAt && Date.parse(dueAt) < now) return "overdue";
    return "not_submitted";
}

function plannerToCoursework(raw: unknown, now: number): CourseworkItem | undefined {
    const parsed = plannerItemSchema.safeParse(raw);
    if (!parsed.success || !parsed.data.submissions) return undefined;
    const item = parsed.data;
    const flags = parsed.data.submissions;
    const dueAt = item.plannable?.due_at ?? item.plannable_date ?? null;
    const assignmentId = item.plannable?.assignment_id
        ?? (item.plannable_type === "assignment" ? item.plannable_id : undefined);
    return {
        key: assignmentId ? `assignment:${assignmentId}` : `${item.plannable_type}:${item.plannable_id}`,
        course_id: item.course_id,
        course: item.context_name,
        type: item.plannable_type,
        title: item.plannable?.title,
        assignment_id: assignmentId,
        due_at: dueAt,
        points_possible: item.plannable?.points_possible ?? null,
        status: plannerStatus(flags, dueAt, now),
        has_feedback: flags.has_feedback ?? false,
        marked_complete: item.planner_override?.marked_complete ?? false,
        html_url: item.html_url,
    };
}

function missingToCoursework(raw: unknown): CourseworkItem | undefined {
    const parsed = missingAssignmentSchema.safeParse(raw);
    if (!parsed.success) return undefined;
    const assignment = parsed.data;
    return {
        key: `assignment:${assignment.id}`,
        course_id: assignment.course_id,
        course: assignment.course?.name,
        type: "assignment",
        title: assignment.name,
        assignment_id: assignment.id,
        due_at: assignment.due_at ?? null,
        points_possible: assignment.points_possible ?? null,
        status: "missing",
        has_feedback: false,
        marked_complete: false,
        html_url: assignment.html_url,
    };
}

function byDueDate(a: CourseworkItem, b: CourseworkItem): number {
    if (a.due_at === b.due_at) return 0;
    if (a.due_at === null) return 1;
    if (b.due_at === null) return -1;
    return Date.parse(a.due_at) - Date.parse(b.due_at);
}

export const courseworkTools: ToolDef[] = [
    {
        name: "canvas_list_my_coursework",
        description:
            "The authenticated student's assignments, quizzes and graded discussions across all courses, one compact row each " +
            "with due_at and a status: not_submitted, overdue, missing, redo_requested, submitted, submitted_late, graded or excused. " +
            "status=todo (default) keeps only work still to hand in, including every missing item Canvas knows about even outside " +
            "the date window. Use this for 'what is due', 'what have I not submitted' or 'am I behind' questions.",
        inputSchema: z.object({
            status: z.enum(["todo", "all"]).default("todo"),
            days_ahead: z.number().int().min(0).max(365).default(14),
            days_back: z.number().int().min(0).max(365).default(7),
            course_ids: z.array(canvasId).optional(),
        }),
        handler: async (args, { canvas }) => {
            const now = Date.now();
            const start = new Date(now - args.days_back * DAY_MS).toISOString();
            const end = new Date(now + args.days_ahead * DAY_MS).toISOString();
            const courseIds: string[] | undefined = args.course_ids;

            const [planner, missing] = await Promise.all([
                canvas.collectPaginated<unknown>("/api/v1/planner/items", {
                    per_page: 100,
                    start_date: start,
                    end_date: end,
                    ...(courseIds ? { context_codes: courseIds.map((id) => `course_${id}`) } : {}),
                }),
                canvas.collectPaginated<unknown>("/api/v1/users/self/missing_submissions", {
                    per_page: 100,
                    filter: ["submittable"],
                    include: ["course"],
                    ...(courseIds ? { course_ids: courseIds } : {}),
                }),
            ]);

            // planner rows carry richer status, so they win over the missing list
            const items = new Map<string, CourseworkItem>();
            for (const raw of planner) {
                const item = plannerToCoursework(raw, now);
                if (item) items.set(item.key, item);
            }
            for (const raw of missing) {
                const item = missingToCoursework(raw);
                if (item && !items.has(item.key)) items.set(item.key, item);
            }

            let rows = [...items.values()];
            if (args.status === "todo") {
                rows = rows.filter((item) => TODO_STATUSES.has(item.status) && !item.marked_complete);
            }
            rows.sort(byDueDate);

            const counts: Partial<Record<CourseworkStatus, number>> = {};
            for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
            return jsonResult({ window: { start, end }, counts, items: rows });
        },
    },
];
