import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import { attemptStatus } from "./submissions.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

const idString = z.union([z.string(), z.number()]).transform(String);
const optionalNumber = z.number().nullable().optional();
const optionalText = z.string().nullable().optional();

const fileNames = z
    .array(z.looseObject({ display_name: z.string().optional() }))
    .optional()
    .transform((files) => (files ?? []).flatMap((file) => (file.display_name ? [file.display_name] : [])));

const ratingSchema = z.looseObject({
    id: idString.optional(),
    description: optionalText,
    points: optionalNumber,
});

const criterionSchema = z.looseObject({
    id: idString,
    description: optionalText,
    long_description: optionalText,
    points: optionalNumber,
    ratings: z.array(ratingSchema).optional(),
});

const assignmentSchema = z.looseObject({
    id: idString.optional(),
    name: z.string().optional(),
    points_possible: optionalNumber,
    grading_type: z.string().optional(),
    due_at: optionalText,
    allowed_attempts: optionalNumber,
    locked_for_user: z.boolean().optional(),
    rubric: z.array(criterionSchema).optional(),
});

const assessmentEntrySchema = z.looseObject({
    rating_id: idString.nullable().optional(),
    points: optionalNumber,
    comments: optionalText,
});

const submissionSchema = z.looseObject({
    workflow_state: z.string().optional(),
    submitted_at: optionalText,
    graded_at: optionalText,
    posted_at: optionalText,
    attempt: optionalNumber,
    grade: optionalText,
    score: optionalNumber,
    late: z.boolean().optional(),
    missing: z.boolean().optional(),
    excused: z.boolean().nullable().optional(),
    seconds_late: optionalNumber,
    points_deducted: optionalNumber,
    attachments: fileNames,
    submission_comments: z.array(z.looseObject({
        author_name: z.string().optional(),
        comment: z.string().optional(),
        created_at: z.string().optional(),
        attempt: optionalNumber,
        attachments: fileNames,
    })).optional(),
    rubric_assessment: z.record(z.string(), assessmentEntrySchema).nullable().optional(),
    submission_history: z.array(z.looseObject({
        attempt: optionalNumber,
        submitted_at: optionalText,
        workflow_state: z.string().optional(),
        late: z.boolean().optional(),
        attachments: fileNames,
    })).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const parsed = schema.safeParse(value ?? {});
    if (!parsed.success) throw new Error(`Canvas returned an unexpected ${what} shape.`);
    return parsed.data;
}

type Criterion = z.infer<typeof criterionSchema>;
type Assessment = Record<string, z.infer<typeof assessmentEntrySchema>>;

function rubricFeedback(rubric: Criterion[] | undefined, assessment: Assessment | null | undefined) {
    if (!rubric || rubric.length === 0) return null;
    return rubric.map((criterion) => {
        const entry = assessment?.[criterion.id];
        const rating = criterion.ratings?.find((candidate) => candidate.id !== undefined && candidate.id === entry?.rating_id);
        return {
            criterion: criterion.description ?? criterion.id,
            ...(criterion.long_description ? { details: criterion.long_description } : {}),
            points_possible: criterion.points ?? null,
            points: entry?.points ?? null,
            rating: rating?.description ?? null,
            comments: entry?.comments || null,
        };
    });
}

// one row per submission in the GraphQL feedback query
const feedbackNodeSchema = z.looseObject({
    unreadCommentCount: z.number().nullable().optional(),
    hasUnreadRubricAssessment: z.boolean().nullable().optional(),
    readState: z.string().nullable().optional(),
    gradedAt: optionalText,
    postedAt: optionalText,
    score: optionalNumber,
    grade: optionalText,
    late: z.boolean().nullable().optional(),
    missing: z.boolean().nullable().optional(),
    excused: z.boolean().nullable().optional(),
    assignment: z.looseObject({
        _id: idString,
        name: z.string().nullable().optional(),
        pointsPossible: optionalNumber,
        htmlUrl: optionalText,
    }).nullable().optional(),
});

const feedbackQuerySchema = z.object({
    user: z.object({
        enrollments: z.array(z.looseObject({
            type: z.string().nullable().optional(),
            course: z.looseObject({
                _id: idString,
                name: z.string().nullable().optional(),
                submissionsConnection: z.looseObject({
                    pageInfo: z.looseObject({ hasNextPage: z.boolean() }).optional(),
                    nodes: z.array(feedbackNodeSchema.nullable()),
                }).nullable().optional(),
            }).nullable().optional(),
        })).nullable().optional(),
    }).nullable(),
});

// GraphQL reads these flags without marking anything read, which REST's
// include[]=read_status would do
const FEEDBACK_QUERY = `
query MyFeedback($userId: ID!) {
  user(id: $userId) {
    enrollments(currentOnly: true) {
      type
      course {
        _id
        name
        submissionsConnection(first: 100, studentIds: [$userId], filter: {states: [graded, submitted, pending_review]}) {
          pageInfo { hasNextPage }
          nodes {
            unreadCommentCount
            hasUnreadRubricAssessment
            readState
            gradedAt
            postedAt
            score
            grade
            late
            missing
            excused
            assignment { _id name pointsPossible htmlUrl }
          }
        }
      }
    }
  }
}`;

export const feedbackTools: ToolDef[] = [
    {
        name: "canvas_get_assignment_feedback",
        description:
            "Everything about the authenticated student's submission for one assignment in a readable form: grade, score, " +
            "late penalty, comments with attached file names, rubric criteria with the rating and points awarded, and attempts " +
            "(allowed, used, remaining, whether a resubmission is possible, redo requests). include_history adds every " +
            "earlier attempt. Reading feedback here does not mark it as read. Use canvas_get_my_submission for the raw object.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            include_history: z.boolean().default(false),
        }),
        handler: async (args, { canvas }) => {
            const base = `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}`;
            const [rawAssignment, rawSubmission] = await Promise.all([
                canvas.get<Record<string, unknown>>(base),
                canvas.get<Record<string, unknown>>(`${base}/submissions/self`, {
                    include: [
                        "submission_comments",
                        "rubric_assessment",
                        ...(args.include_history ? ["submission_history"] : []),
                    ],
                }),
            ]);
            const assignment = parseOrThrow(assignmentSchema, rawAssignment, "assignment");
            const submission = parseOrThrow(submissionSchema, rawSubmission, "submission");

            return jsonResult({
                assignment: {
                    id: assignment.id,
                    name: assignment.name,
                    points_possible: assignment.points_possible ?? null,
                    grading_type: assignment.grading_type,
                    due_at: assignment.due_at ?? null,
                },
                submission: {
                    workflow_state: submission.workflow_state,
                    submitted_at: submission.submitted_at ?? null,
                    graded_at: submission.graded_at ?? null,
                    // unposted grades are hidden from students, so null here means not released
                    grade_released: Boolean(submission.posted_at),
                    grade: submission.grade ?? null,
                    score: submission.score ?? null,
                    late: submission.late ?? false,
                    missing: submission.missing ?? false,
                    excused: submission.excused ?? false,
                    seconds_late: submission.seconds_late ?? 0,
                    points_deducted: submission.points_deducted ?? null,
                    files: submission.attachments,
                },
                attempts: attemptStatus(rawAssignment, rawSubmission),
                comments: (submission.submission_comments ?? []).map((comment) => ({
                    author: comment.author_name,
                    comment: comment.comment,
                    created_at: comment.created_at,
                    attempt: comment.attempt ?? null,
                    files: comment.attachments,
                })),
                rubric: rubricFeedback(assignment.rubric, submission.rubric_assessment),
                ...(args.include_history
                    ? {
                        history: (submission.submission_history ?? []).map((attempt) => ({
                            attempt: attempt.attempt ?? null,
                            submitted_at: attempt.submitted_at ?? null,
                            workflow_state: attempt.workflow_state,
                            late: attempt.late ?? false,
                            files: attempt.attachments,
                        })),
                    }
                    : {}),
            });
        },
    },
    {
        name: "canvas_list_my_feedback",
        description:
            "Graded or commented work across the authenticated student's current courses, newest first, with unread comment " +
            "counts and unread grade/rubric flags. unread_only (default true) keeps items with something new to look at. " +
            "released=false means the teacher has not posted grades yet, so its comments stay hidden until they do. " +
            "Listing does not mark anything read; use canvas_mark_submission_read after reviewing, and " +
            "canvas_get_assignment_feedback for the comments and rubric of one item.",
        inputSchema: z.object({
            unread_only: z.boolean().default(true),
            course_ids: z.array(canvasId).optional(),
        }),
        handler: async (args, { canvas }) => {
            const me = parseOrThrow(z.looseObject({ id: idString }), await canvas.get("/api/v1/users/self"), "user");
            const data = parseOrThrow(feedbackQuerySchema, await canvas.graphql(FEEDBACK_QUERY, { userId: me.id }), "feedback");
            const wanted = args.course_ids ? new Set<string>(args.course_ids) : undefined;

            const seen = new Set<string>();
            const truncated: string[] = [];
            const rows = [];
            for (const enrollment of data.user?.enrollments ?? []) {
                const course = enrollment.course;
                if (enrollment.type !== "StudentEnrollment" || !course || seen.has(course._id)) continue;
                if (wanted && !wanted.has(course._id)) continue;
                seen.add(course._id);
                if (course.submissionsConnection?.pageInfo?.hasNextPage) truncated.push(course.name ?? course._id);

                for (const node of course.submissionsConnection?.nodes ?? []) {
                    if (!node?.assignment) continue;
                    const unreadComments = node.unreadCommentCount ?? 0;
                    const unreadRubric = node.hasUnreadRubricAssessment ?? false;
                    const unreadGrade = node.readState === "unread" && Boolean(node.postedAt) && node.score != null;
                    const hasFeedback = node.score != null || node.grade != null || unreadComments > 0 || unreadRubric;
                    if (!hasFeedback) continue;
                    if (args.unread_only && !(unreadComments > 0 || unreadRubric || unreadGrade)) continue;
                    rows.push({
                        course_id: course._id,
                        course: course.name ?? null,
                        assignment_id: node.assignment._id,
                        title: node.assignment.name ?? null,
                        grade: node.grade ?? null,
                        score: node.score ?? null,
                        points_possible: node.assignment.pointsPossible ?? null,
                        graded_at: node.gradedAt ?? null,
                        // comments on unreleased work count as unread but stay hidden until grades are posted
                        released: Boolean(node.postedAt),
                        unread_comments: unreadComments,
                        unread_rubric: unreadRubric,
                        unread_grade: unreadGrade,
                        late: node.late ?? false,
                        excused: node.excused ?? false,
                        html_url: node.assignment.htmlUrl ?? null,
                    });
                }
            }
            rows.sort((a, b) => (b.graded_at ?? "").localeCompare(a.graded_at ?? ""));
            return jsonResult({
                items: rows,
                ...(truncated.length > 0 ? { truncated_courses: truncated } : {}),
            });
        },
    },
    {
        name: "canvas_mark_submission_read",
        description:
            "Mark the authenticated student's submission feedback as read. Without item it marks the whole submission; item " +
            "marks only the grade, the comments or the rubric.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            item: z.enum(["grade", "comment", "rubric"]).optional(),
        }),
        handler: async (args, { canvas }) => {
            const path = `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/self/read`;
            await canvas.put(args.item ? `${path}/${args.item}` : path);
            return jsonResult({ marked_read: args.item ?? "submission" });
        },
    },
];
