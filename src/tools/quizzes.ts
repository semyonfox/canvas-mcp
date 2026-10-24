import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

const DAY_MS = 86_400_000;
const QUIZ_FETCH_CONCURRENCY = 5;

const idString = z.union([z.string(), z.number()]).transform(String);
const optionalText = z.string().nullable().optional();
const optionalNumber = z.number().nullable().optional();

const quizSchema = z.looseObject({
    id: idString,
    title: z.string().optional(),
    assignment_id: idString.nullable().optional(),
    due_at: optionalText,
    lock_at: optionalText,
    unlock_at: optionalText,
    time_limit: optionalNumber,
    allowed_attempts: optionalNumber,
    points_possible: optionalNumber,
    hide_results: optionalText,
    locked_for_user: z.boolean().optional(),
    lock_explanation: optionalText,
    published: z.boolean().optional(),
});

const quizSubmissionSchema = z.looseObject({
    attempt: optionalNumber,
    extra_attempts: optionalNumber,
    attempts_left: optionalNumber,
    workflow_state: z.string().optional(),
    score: optionalNumber,
    kept_score: optionalNumber,
    finished_at: optionalText,
    end_at: optionalText,
});

const plannerQuizSchema = z.looseObject({
    plannable_type: z.string(),
    plannable_id: idString,
    course_id: idString.optional(),
    context_name: z.string().optional(),
});

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]!);
        }
    });
    await Promise.all(workers);
    return results;
}

function quizStatus(quiz: z.infer<typeof quizSchema>, submission: z.infer<typeof quizSubmissionSchema> | undefined): string {
    // "untaken" is Canvas's name for an attempt that is started but not handed in
    if (submission?.workflow_state === "untaken") return "in_progress";
    if (submission?.workflow_state === "pending_review") return "pending_review";
    if (submission?.workflow_state === "complete") return "submitted";
    return quiz.locked_for_user ? "locked" : "not_started";
}

export const quizTools: ToolDef[] = [
    {
        name: "canvas_list_quizzes",
        description: "List quizzes for a course. Optionally filter by search_term.",
        inputSchema: z.object({
            course_id: canvasId,
            search_term: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            const quizzes = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/quizzes`,
                {
                    per_page: 100,
                    ...(args.search_term ? { search_term: args.search_term } : {}),
                },
            );
            return jsonResult(quizzes);
        },
    },
    {
        name: "canvas_get_quiz",
        description: "Get details for a single quiz by course and quiz ID.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const quiz = await canvas.get(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}`,
                {},
            );
            return jsonResult(quiz);
        },
    },
    {
        name: "canvas_list_my_quiz_submissions",
        title: "Canvas: List Quiz Submissions",
        description:
            "List quiz submissions visible to the authenticated user. Students receive only their own submissions; users who can manage grades may receive submissions from multiple users.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            include: z.array(z.enum(["submission", "quiz", "user"])).optional(),
        }),
        handler: async (args, { canvas }) => {
            const response = await canvas.get<{ quiz_submissions?: unknown[] } | unknown[]>(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/submissions`,
                {
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            const submissions = Array.isArray(response)
                ? response
                : response?.quiz_submissions ?? [];
            return jsonResult(submissions);
        },
    },
    {
        name: "canvas_list_my_quizzes",
        description:
            "Classic quizzes with the authenticated student's attempt status: not_started, in_progress, submitted, " +
            "pending_review or locked, plus attempts used and left, time limit, kept and latest score, and when results are " +
            "hidden. With course_id it covers every quiz in that course; without it, quizzes due in the date window " +
            "across all courses. New Quizzes are assignments, so they show in canvas_list_my_coursework instead.",
        inputSchema: z.object({
            course_id: canvasId.optional(),
            days_ahead: z.number().int().min(0).max(365).default(14),
            days_back: z.number().int().min(0).max(365).default(14),
        }),
        handler: async (args, { canvas }) => {
            let targets: Array<{ courseId: string; course: string | undefined; quizId: string; quiz?: unknown }>;
            if (args.course_id) {
                const quizzes = await canvas.collectPaginated<unknown>(`/api/v1/courses/${args.course_id}/quizzes`, { per_page: 100 });
                targets = quizzes.map((quiz) => ({
                    courseId: args.course_id,
                    course: undefined,
                    quizId: quizSchema.parse(quiz).id,
                    quiz,
                }));
            } else {
                const now = Date.now();
                const items = await canvas.collectPaginated<unknown>("/api/v1/planner/items", {
                    per_page: 100,
                    start_date: new Date(now - args.days_back * DAY_MS).toISOString(),
                    end_date: new Date(now + args.days_ahead * DAY_MS).toISOString(),
                });
                targets = items.flatMap((raw) => {
                    const item = plannerQuizSchema.safeParse(raw);
                    if (!item.success || item.data.plannable_type !== "quiz" || !item.data.course_id) return [];
                    return [{ courseId: item.data.course_id, course: item.data.context_name, quizId: item.data.plannable_id }];
                });
            }

            const rows = await mapWithLimit(targets, QUIZ_FETCH_CONCURRENCY, async (target) => {
                const base = `/api/v1/courses/${target.courseId}/quizzes/${target.quizId}`;
                try {
                    const [rawQuiz, rawSubmission] = await Promise.all([
                        target.quiz ?? canvas.get(base),
                        canvas.get<{ quiz_submissions?: unknown[] }>(`${base}/submission`),
                    ]);
                    const quiz = quizSchema.parse(rawQuiz ?? {});
                    const latest = rawSubmission?.quiz_submissions?.at(-1);
                    const submission = latest === undefined ? undefined : quizSubmissionSchema.parse(latest);
                    const allowed = quiz.allowed_attempts != null && quiz.allowed_attempts >= 0 ? quiz.allowed_attempts : null;
                    const used = submission?.attempt ?? 0;
                    return {
                        course_id: target.courseId,
                        course: target.course ?? null,
                        quiz_id: quiz.id,
                        assignment_id: quiz.assignment_id ?? null,
                        title: quiz.title ?? null,
                        status: quizStatus(quiz, submission),
                        due_at: quiz.due_at ?? null,
                        lock_at: quiz.lock_at ?? null,
                        time_limit_minutes: quiz.time_limit ?? null,
                        allowed_attempts: allowed,
                        attempts_used: used,
                        attempts_left: submission?.attempts_left
                            ?? (allowed === null ? null : Math.max(allowed + (submission?.extra_attempts ?? 0) - used, 0)),
                        kept_score: submission?.kept_score ?? null,
                        latest_score: submission?.score ?? null,
                        points_possible: quiz.points_possible ?? null,
                        // canvas uses null, "always" or "until_after_last_attempt"
                        results_hidden: quiz.hide_results ?? "never",
                        ...(submission?.workflow_state === "untaken" && submission.end_at ? { attempt_ends_at: submission.end_at } : {}),
                        ...(quiz.locked_for_user && quiz.lock_explanation ? { lock_explanation: quiz.lock_explanation } : {}),
                    };
                } catch (error) {
                    return {
                        course_id: target.courseId,
                        quiz_id: target.quizId,
                        error: error instanceof Error ? error.message : "Could not read this quiz.",
                    };
                }
            });
            return jsonResult(rows);
        },
    },
    {
        name: "canvas_get_my_quiz_submission",
        description:
            "Get the authenticated user's current quiz submission, including score and attempt data when available.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            include: z.array(z.enum(["submission", "quiz", "user"])).optional(),
        }),
        handler: async (args, { canvas }) => {
            const submission = await canvas.get(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/submission`,
                {
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(submission);
        },
    },

    // ============================================================
    // EDUCATOR / ADMINISTRATOR TOOLS
    // ============================================================
    {
        name: "canvas_create_quiz",
        description: "Create a quiz in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            title: z.string(),
            quiz_type: z.enum(["practice_quiz", "assignment", "graded_survey", "survey"]).optional(),
            time_limit: z.number().int().positive().optional(),
            allowed_attempts: z.number().int().optional(),
            published: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const { course_id, ...fields } = args;
            const quiz = await canvas.post(`/api/v1/courses/${course_id}/quizzes`, {
                quiz: {
                    title: fields.title,
                    ...(fields.quiz_type !== undefined ? { quiz_type: fields.quiz_type } : {}),
                    ...(fields.time_limit !== undefined ? { time_limit: fields.time_limit } : {}),
                    ...(fields.allowed_attempts !== undefined ? { allowed_attempts: fields.allowed_attempts } : {}),
                    ...(fields.published !== undefined ? { published: fields.published } : {}),
                },
            });
            return jsonResult(quiz);
        },
    },
    {
        name: "canvas_update_quiz",
        description: "Update a quiz in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            title: z.string().optional(),
            quiz_type: z.enum(["practice_quiz", "assignment", "graded_survey", "survey"]).optional(),
            time_limit: z.number().int().positive().optional(),
            allowed_attempts: z.number().int().optional(),
            published: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const { course_id, quiz_id, ...fields } = args;
            const quiz = await canvas.put(
                `/api/v1/courses/${course_id}/quizzes/${quiz_id}`,
                {
                    quiz: {
                        ...(fields.title !== undefined ? { title: fields.title } : {}),
                        ...(fields.quiz_type !== undefined ? { quiz_type: fields.quiz_type } : {}),
                        ...(fields.time_limit !== undefined ? { time_limit: fields.time_limit } : {}),
                        ...(fields.allowed_attempts !== undefined ? { allowed_attempts: fields.allowed_attempts } : {}),
                        ...(fields.published !== undefined ? { published: fields.published } : {}),
                    },
                },
            );
            return jsonResult(quiz);
        },
    },
    {
        name: "canvas_delete_quiz",
        description: "Delete a quiz from a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}`,
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_list_quiz_questions",
        description: "List questions for a quiz. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const questions = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/questions`,
                { per_page: 100 },
            );
            return jsonResult(questions);
        },
    },
    {
        name: "canvas_create_quiz_question",
        description: "Create a question in a quiz. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            question_name: z.string().optional(),
            question_text: z.string(),
            question_type: z.string(),
            points_possible: z.number().optional(),
        }),
        handler: async (args, { canvas }) => {
            const { course_id, quiz_id, question_name, question_text, question_type, points_possible } = args;
            const question = await canvas.post(
                `/api/v1/courses/${course_id}/quizzes/${quiz_id}/questions`,
                {
                    question: {
                        question_text,
                        question_type,
                        ...(question_name !== undefined ? { question_name } : {}),
                        ...(points_possible !== undefined ? { points_possible } : {}),
                    },
                },
            );
            return jsonResult(question);
        },
    },
    {
        name: "canvas_update_quiz_question",
        description: "Update a question in a quiz. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            question_id: canvasId,
            question_name: z.string().optional(),
            question_text: z.string().optional(),
            points_possible: z.number().optional(),
        }),
        handler: async (args, { canvas }) => {
            const { course_id, quiz_id, question_id, question_name, question_text, points_possible } = args;
            const question = await canvas.put(
                `/api/v1/courses/${course_id}/quizzes/${quiz_id}/questions/${question_id}`,
                {
                    question: {
                        ...(question_name !== undefined ? { question_name } : {}),
                        ...(question_text !== undefined ? { question_text } : {}),
                        ...(points_possible !== undefined ? { points_possible } : {}),
                    },
                },
            );
            return jsonResult(question);
        },
    },
    {
        name: "canvas_delete_quiz_question",
        description: "Delete a question from a quiz. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            question_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/questions/${args.question_id}`,
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_list_quiz_question_groups",
        description: "List question groups for a quiz. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const groups = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/groups`,
                { per_page: 100 },
            );
            return jsonResult(groups);
        },
    },
    {
        name: "canvas_start_quiz_attempt",
        description: "Start a quiz-taking session. Requires permission to take the quiz.",
        inputSchema: z.object({
            course_id: canvasId,
            quiz_id: canvasId,
            access_code: z.string().optional(),
            preview: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const options = {
                ...(args.access_code !== undefined ? { access_code: args.access_code } : {}),
                ...(args.preview !== undefined ? { preview: args.preview } : {}),
            };
            const submission = Object.keys(options).length > 0
                ? await canvas.post(`/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/submissions`, options)
                : await canvas.post(`/api/v1/courses/${args.course_id}/quizzes/${args.quiz_id}/submissions`);
            return jsonResult(submission);
        },
    },
];
