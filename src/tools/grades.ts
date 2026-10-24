import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";
import { courseScore, type GradeGroup, neededOnRemaining, scoreGroup } from "./grade-calc.js";

const idString = z.union([z.string(), z.number()]).transform(String);

const assignmentGroupSchema = z.looseObject({
    id: idString,
    name: z.string(),
    group_weight: z.number().nullable().optional(),
    rules: z.looseObject({
        drop_lowest: z.number().optional(),
        drop_highest: z.number().optional(),
        never_drop: z.array(idString).optional(),
    }).nullable().optional(),
    assignments: z.array(z.looseObject({
        id: idString,
        name: z.string(),
        points_possible: z.number().nullable().optional(),
        omit_from_final_grade: z.boolean().optional(),
        grading_type: z.string().optional(),
        submission: z.looseObject({
            score: z.number().nullable().optional(),
            excused: z.boolean().nullable().optional(),
        }).nullable().optional(),
    })).optional(),
});

const courseTotalsSchema = z.looseObject({
    apply_assignment_group_weights: z.boolean().optional(),
    enrollments: z.array(z.looseObject({
        type: z.string().optional(),
        computed_current_score: z.number().nullable().optional(),
        computed_final_score: z.number().nullable().optional(),
    })).optional(),
});

const round = (value: number | null): number | null => (value === null ? null : Math.round(value * 100) / 100);

export const gradeTools: ToolDef[] = [
    {
        name: "canvas_get_my_grades",
        description:
            "Get the authenticated student's grades across courses. Returns enrollment objects that include current_score, final_score, current_grade, final_grade, and grading-period fields. Optional filters: course_id (single course), state (active|completed|invited — defaults to active+invited), limit (cap result count). Use this for any 'what are my grades' question.",
        inputSchema: z.object({
            course_id: canvasId.optional(),
            state: z.array(z.enum(["active", "invited", "completed", "inactive"])).optional(),
            limit: z.number().int().positive().optional(),
        }),
        handler: async (args, { canvas }) => {
            const enrollments = await canvas.collectPaginated<Record<string, unknown>>(
                "/api/v1/users/self/enrollments",
                {
                    per_page: 100,
                    ...(args.course_id ? { course_id: args.course_id } : {}),
                    ...(args.state ? { state: args.state } : {}),
                },
            );
            const result = args.limit !== undefined ? enrollments.slice(0, args.limit) : enrollments;
            return jsonResult(result);
        },
    },
    {
        name: "canvas_get_my_grade_breakdown",
        description:
            "Break down the authenticated student's grade in one course by assignment group, and answer what-if questions. " +
            "what_if substitutes hypothetical scores (points) for any assignments. target_percent reports the average " +
            "percentage needed on all still-ungraded work to finish there. current_percent ignores ungraded work and " +
            "final_percent counts it as zero, like Canvas. This is a local calculation: drop rules are approximated and " +
            "grading periods are not weighted separately, so Canvas's own total is included for comparison when the course shows it.",
        inputSchema: z.object({
            course_id: canvasId,
            what_if: z.array(z.object({ assignment_id: canvasId, score: z.number().min(0) })).optional(),
            target_percent: z.number().min(0).max(200).optional(),
        }),
        handler: async (args, { canvas }) => {
            const [rawCourse, rawGroups] = await Promise.all([
                canvas.get(`/api/v1/courses/${args.course_id}`, { include: ["total_scores"] }),
                canvas.collectPaginated<unknown>(`/api/v1/courses/${args.course_id}/assignment_groups`, {
                    per_page: 100,
                    include: ["assignments", "submission"],
                }),
            ]);
            const course = courseTotalsSchema.parse(rawCourse ?? {});
            const weighted = course.apply_assignment_group_weights ?? false;
            const whatIf = new Map<string, number>(
                (args.what_if ?? []).map((entry: { assignment_id: string; score: number }) => [entry.assignment_id, entry.score]),
            );
            const applied: string[] = [];

            const groups: GradeGroup[] = rawGroups.map((raw) => {
                const group = assignmentGroupSchema.parse(raw);
                return {
                    id: group.id,
                    name: group.name,
                    weight: group.group_weight ?? 0,
                    drop_lowest: group.rules?.drop_lowest ?? 0,
                    drop_highest: group.rules?.drop_highest ?? 0,
                    never_drop: new Set(group.rules?.never_drop ?? []),
                    items: (group.assignments ?? [])
                        .filter((a) => !a.omit_from_final_grade && a.grading_type !== "not_graded" && a.points_possible != null)
                        .map((a) => {
                            const hypothetical = whatIf.get(a.id);
                            if (hypothetical !== undefined) applied.push(a.name);
                            return {
                                id: a.id,
                                name: a.name,
                                points_possible: a.points_possible ?? 0,
                                score: hypothetical ?? a.submission?.score ?? null,
                                excused: hypothetical === undefined && a.submission?.excused === true,
                            };
                        }),
                };
            });

            const unknownWhatIf = [...whatIf.keys()].filter(
                (id) => !groups.some((group) => group.items.some((item) => item.id === id)),
            );
            const enrollment = course.enrollments?.find((e) => e.type === "student" || e.type === "StudentEnrollment");
            const needed = args.target_percent !== undefined
                ? neededOnRemaining(groups, weighted, args.target_percent)
                : undefined;

            return jsonResult({
                weighted,
                current_percent: round(courseScore(groups, weighted, undefined)),
                final_percent: round(courseScore(groups, weighted, 0)),
                canvas_current_score: enrollment?.computed_current_score ?? null,
                groups: groups.map((group) => {
                    const current = scoreGroup(group, undefined);
                    return {
                        name: group.name,
                        weight: weighted ? group.weight : null,
                        current_percent: round(current.percent),
                        earned: round(current.earned),
                        possible: round(current.possible),
                        ungraded: group.items.filter((item) => !item.excused && item.score === null).length,
                        dropped: current.dropped,
                    };
                }),
                ...(applied.length > 0 ? { what_if_applied: applied } : {}),
                ...(unknownWhatIf.length > 0 ? { what_if_not_found: unknownWhatIf } : {}),
                ...(args.target_percent !== undefined
                    ? {
                        target: {
                            target_percent: args.target_percent,
                            needed_percent_on_remaining: needed == null ? null : round(needed * 100),
                            status: needed == null
                                ? "nothing left to grade"
                                : needed <= 0 ? "already secured" : needed > 1 ? "out of reach without extra credit" : "reachable",
                        },
                    }
                    : {}),
            });
        },
    },
    {
        name: "canvas_get_grading_standards",
        description:
            "Get grading standards (letter-grade thresholds) for a course.",
        inputSchema: z.object({
            course_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const standards = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/grading_standards`,
                { per_page: 100 },
            );
            return jsonResult(standards);
        },
    },

    // ============================================================
    // ADMIN / EDUCATOR TOOLS
    // ============================================================
    {
        name: "canvas_submit_grade",
        description: "Grade a student's submission for an assignment. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            user_id: canvasId,
            posted_grade: z.string().optional(),
            excuse: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.put(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/${args.user_id}`,
                {
                    submission: {
                        ...(args.posted_grade !== undefined ? { posted_grade: args.posted_grade } : {}),
                        ...(args.excuse !== undefined ? { excuse: args.excuse } : {}),
                    },
                },
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_get_all_students_status",
        description: "List all student submissions for a course across assignments. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            workflow_state: z.enum(["submitted", "unsubmitted", "graded", "pending_review"]).optional(),
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const submissions = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/students/submissions`,
                {
                    per_page: 100,
                    student_ids: ["all"],
                    ...(args.workflow_state ? { workflow_state: args.workflow_state } : {}),
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(submissions);
        },
    },
    {
        name: "canvas_get_comprehensive_status",
        description: "Composite grade + submission roll-up for all students in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const enrollments = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/enrollments`,
                {
                    per_page: 100,
                    type: ["StudentEnrollment"],
                    include: ["grades"],
                },
            );
            const submissions = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/students/submissions`,
                {
                    per_page: 100,
                    student_ids: ["all"],
                },
            );
            return jsonResult({ enrollments, submissions });
        },
    },
];
