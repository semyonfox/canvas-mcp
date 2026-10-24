import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import type { CanvasClient } from "../canvas/client.js";
import { jsonResult, textResult } from "./types.js";
import { hasUploadSource, readUploadSource, uploadSourceFields } from "./upload-source.js";

const canvasUserId = z.union([z.literal("self"), canvasId]);
const submissionStudentId = z.union([z.literal("self"), z.literal("all"), canvasId]);

export interface SubmissionSummary {
    id: string | undefined;
    assignment_id: string | undefined;
    workflow_state: string | undefined;
    submission_type: string | undefined;
    submitted_at: string | null | undefined;
    attempt: number | null | undefined;
    late: boolean | undefined;
    missing: boolean | undefined;
    seconds_late: number | undefined;
    attachments: Array<{ id: string; display_name?: string; size?: number; content_type?: string }>;
}

function field<T>(record: Record<string, unknown>, key: string, guard: (value: unknown) => value is T): T | undefined {
    const value = record[key];
    return guard(value) ? value : undefined;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isIdLike = (value: unknown): value is string | number => isString(value) || isNumber(value);

/** compact submission state without preview or download URLs, which carry verifiers */
export function summariseSubmission(submission: Record<string, unknown> | null): SubmissionSummary {
    const record = submission ?? {};
    const id = field(record, "id", isIdLike);
    const assignmentId = field(record, "assignment_id", isIdLike);
    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
    return {
        id: id === undefined ? undefined : String(id),
        assignment_id: assignmentId === undefined ? undefined : String(assignmentId),
        workflow_state: field(record, "workflow_state", isString),
        submission_type: field(record, "submission_type", isString),
        submitted_at: record.submitted_at === null ? null : field(record, "submitted_at", isString),
        attempt: record.attempt === null ? null : field(record, "attempt", isNumber),
        late: field(record, "late", isBoolean),
        missing: field(record, "missing", isBoolean),
        seconds_late: field(record, "seconds_late", isNumber),
        attachments: attachments.flatMap((raw: unknown) => {
            if (!raw || typeof raw !== "object") return [];
            const file = raw as Record<string, unknown>;
            const fileId = field(file, "id", isIdLike);
            if (fileId === undefined) return [];
            const displayName = field(file, "display_name", isString);
            const size = field(file, "size", isNumber);
            const contentType = field(file, "content-type", isString);
            return [{
                id: String(fileId),
                ...(displayName !== undefined ? { display_name: displayName } : {}),
                ...(size !== undefined ? { size } : {}),
                ...(contentType !== undefined ? { content_type: contentType } : {}),
            }];
        }),
    };
}

export interface AttemptStatus {
    /** null when the assignment allows unlimited attempts */
    allowed: number | null;
    extra: number;
    used: number;
    remaining: number | null;
    redo_requested: boolean;
    graded_attempt_is_current: boolean | undefined;
    can_submit: boolean;
    blocked_reason: string | undefined;
}

export function attemptStatus(
    assignment: Record<string, unknown> | null,
    submission: Record<string, unknown> | null,
): AttemptStatus {
    const record = submission ?? {};
    const allowedRaw = field(assignment ?? {}, "allowed_attempts", isNumber);
    const allowed = allowedRaw === undefined || allowedRaw < 0 ? null : allowedRaw;
    const extra = field(record, "extra_attempts", isNumber) ?? 0;
    const used = field(record, "attempt", isNumber) ?? 0;
    const remaining = allowed === null ? null : Math.max(allowed + extra - used, 0);
    const redoRequested = record.redo_request === true;

    let blockedReason: string | undefined;
    if (assignment?.locked_for_user === true) {
        const explanation = field(assignment, "lock_explanation", isString);
        blockedReason = `The assignment is locked.${explanation ? ` ${explanation}` : ""}`;
    } else if (allowed !== null && remaining === 0 && !redoRequested) {
        // a redo request reopens the assignment, so leave that call to Canvas
        blockedReason = `All ${allowed + extra} allowed attempts are used.`;
    }
    return {
        allowed,
        extra,
        used,
        remaining,
        redo_requested: redoRequested,
        graded_attempt_is_current: field(record, "grade_matches_current_submission", isBoolean),
        can_submit: blockedReason === undefined,
        blocked_reason: blockedReason,
    };
}

function extensionOf(filename: string): string {
    return filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
}

// fail before uploading or submitting anything Canvas would refuse
async function preflightSubmission(
    canvas: CanvasClient,
    assignmentPath: string,
    submissionType: string,
    filenames: readonly string[],
): Promise<AttemptStatus> {
    const [assignment, submission] = await Promise.all([
        canvas.get<Record<string, unknown>>(assignmentPath),
        canvas.get<Record<string, unknown>>(`${assignmentPath}/submissions/self`),
    ]);
    const types = Array.isArray(assignment?.submission_types) ? assignment.submission_types : [];
    if (!types.includes(submissionType)) {
        throw new Error(
            `This assignment does not accept ${submissionType} (submission_types: ${types.join(", ") || "none"}).`,
        );
    }
    const attempts = attemptStatus(assignment, submission);
    if (attempts.blocked_reason) throw new Error(`Cannot submit: ${attempts.blocked_reason}`);

    const allowed = Array.isArray(assignment?.allowed_extensions)
        ? assignment.allowed_extensions.filter(isString).map((ext) => ext.toLowerCase().replace(/^\./, ""))
        : [];
    const rejected = filenames.find((name) => allowed.length > 0 && !allowed.includes(extensionOf(name)));
    if (rejected) throw new Error(`This assignment only accepts ${allowed.join(", ")} files; got "${rejected}".`);
    return attempts;
}

export const submissionTools: ToolDef[] = [
    {
        name: "canvas_get_my_submission",
        description:
            "Get the authenticated student's own submission for a specific assignment. Supports include[] for submission_comments, rubric_assessment, and submission_history.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const submission = await canvas.get(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/self`,
                {
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(submission);
        },
    },
    {
        name: "canvas_list_my_submissions",
        title: "Canvas: List Course Submissions",
        description:
            "List the authenticated student's submissions for a course. Canvas returns the caller's submissions when student_ids is omitted; use student_ids only when the token is permitted to view another student or all students.",
        inputSchema: z.object({
            course_id: canvasId,
            student_ids: z.array(submissionStudentId).optional(),
            workflow_state: z.enum(["submitted", "unsubmitted", "graded", "pending_review"]).optional(),
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const submissions = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/students/submissions`,
                {
                    per_page: 100,
                    ...(args.student_ids ? { student_ids: args.student_ids } : {}),
                    ...(args.workflow_state ? { workflow_state: args.workflow_state } : {}),
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(submissions);
        },
    },
    {
        name: "canvas_get_submission_comments",
        description:
            "Get submission comments for a specific assignment submission. Defaults to the authenticated student's own submission (user_id=self).",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            user_id: canvasUserId.optional(),
        }),
        handler: async (args, { canvas }) => {
            const userId = args.user_id ?? "self";
            const submission = await canvas.get(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/${userId}`,
                {
                    include: ["submission_comments"],
                },
            );
            return jsonResult(submission);
        },
    },
    {
        name: "canvas_list_peer_reviews_todo",
        description:
            "List peer-review to-do items for the authenticated student by filtering the user's Canvas to-do list for reviewing items.",
        inputSchema: z.object({}),
        handler: async (_args, { canvas }) => {
            const todo = await canvas.collectPaginated<Record<string, unknown>>(
                "/api/v1/users/self/todo",
                { per_page: 100 },
            );
            const items = Array.isArray(todo)
                ? todo.filter((item: Record<string, unknown>) => item.type === "reviewing")
                : todo;
            return jsonResult(items);
        },
    },
    {
        name: "canvas_list_peer_reviews_for_assignment",
        description:
            "List peer reviews for a specific assignment. Supports include[] for submission comments and user details.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            include: z.array(z.enum(["submission_comments", "user"])).optional(),
        }),
        handler: async (args, { canvas }) => {
            const reviews = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/peer_reviews`,
                {
                    per_page: 100,
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(reviews);
        },
    },

    {
        name: "canvas_submit_assignment",
        description:
            "Submit the authenticated student's work for an assignment. online_text_entry takes body, online_url takes url. " +
            "online_upload takes file_ids from earlier uploads (canvas_upload_file target=submission), one file to upload in " +
            "the same call, or both for a multi-file submission. A file comes from file_path (read on the MCP server host, " +
            "only inside CANVAS_UPLOAD_ROOTS) or content_base64 with filename (sent by the client). " +
            "Submitting again is a resubmission: Canvas records a new attempt that replaces the current one for grading and " +
            "keeps earlier attempts in the submission history. There is no way to edit or delete a submitted file, so " +
            "replacing a file means resubmitting. The submission type, lock state, attempts left and allowed extensions are " +
            "checked first. The result reports workflow_state, submitted_at, late, attempt and attached files. " +
            "media_recording is not supported.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            submission_type: z.enum(["online_text_entry", "online_url", "online_upload", "media_recording"]),
            body: z.string().optional(),
            url: z.string().optional(),
            file_ids: z.array(canvasId).min(1).optional(),
            ...uploadSourceFields,
            comment: z.string().optional().describe("Optional comment posted with the submission."),
        }),
        handler: async (args, { canvas, uploadRoots }) => {
            if (args.submission_type === "media_recording") {
                return {
                    ...textResult(
                        "media_recording submissions need a Kaltura upload (GET /api/v1/services/kaltura_session, " +
                        "upload to Kaltura, then submit media_comment_id), which this server does not implement.",
                    ),
                    isError: true,
                };
            }
            const base = `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}`;
            const comment = args.comment !== undefined ? { comment: { text_comment: args.comment } } : {};

            if (args.submission_type !== "online_upload") {
                const before = await preflightSubmission(canvas, base, args.submission_type, []);
                const result = await canvas.post<Record<string, unknown>>(`${base}/submissions`, {
                    submission: {
                        submission_type: args.submission_type,
                        ...(args.body !== undefined ? { body: args.body } : {}),
                        ...(args.url !== undefined ? { url: args.url } : {}),
                    },
                    ...comment,
                });
                return jsonResult({ ...summariseSubmission(result), previous_attempt: before.used });
            }

            if (args.file_ids === undefined && !hasUploadSource(args)) {
                throw new Error("online_upload needs file_ids, file_path or content_base64.");
            }

            const file = hasUploadSource(args) ? await readUploadSource(args, uploadRoots ?? []) : undefined;
            const before = await preflightSubmission(canvas, base, "online_upload", file ? [file.name] : []);
            const fileIds: string[] = [...(args.file_ids ?? [])];
            if (file) {
                const uploaded = await canvas.uploadFile(`${base}/submissions/self/files`, file);
                fileIds.push(uploaded.id);
            }

            let submission = await canvas.post<Record<string, unknown>>(`${base}/submissions`, {
                submission: { submission_type: "online_upload", file_ids: fileIds },
                ...comment,
            });
            // the create response normally lists attachments; re-read once if it does not
            if (!Array.isArray(submission?.attachments)) {
                submission = await canvas.get<Record<string, unknown>>(`${base}/submissions/self`);
            }
            const summary = { ...summariseSubmission(submission), previous_attempt: before.used };
            const attachedIds = new Set(summary.attachments.map((attached) => attached.id));
            const missing = fileIds.filter((id) => !attachedIds.has(id));
            if (missing.length > 0) {
                return {
                    ...jsonResult({
                        error: `Canvas accepted the submission but file(s) ${missing.join(", ")} are not attached to it. Check the submission in Canvas.`,
                        submission: summary,
                    }),
                    isError: true,
                };
            }
            return jsonResult(summary);
        },
    },
    {
        name: "canvas_post_submission_comment",
        description:
            "Comment on a submission, optionally with files. user_id defaults to self, so a student can comment on their " +
            "own submission; other user_ids need grading permission. Attach files with file_ids (from canvas_upload_file " +
            "target=submission_comment) or one file to upload in the same call via file_path or content_base64 + filename. " +
            "attempt ties the comment to a specific submission attempt.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            user_id: canvasUserId.optional(),
            comment: z.string(),
            attempt: z.number().int().positive().optional(),
            group_comment: z.boolean().optional(),
            file_ids: z.array(canvasId).optional(),
            ...uploadSourceFields,
        }),
        handler: async (args, { canvas, uploadRoots }) => {
            const userId = args.user_id ?? "self";
            const submissionPath = `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/${userId}`;
            const fileIds: string[] = [...(args.file_ids ?? [])];
            if (hasUploadSource(args)) {
                const file = await readUploadSource(args, uploadRoots ?? []);
                const uploaded = await canvas.uploadFile(`${submissionPath}/comments/files`, file);
                fileIds.push(uploaded.id);
            }
            const result = await canvas.put(submissionPath, {
                comment: {
                    text_comment: args.comment,
                    ...(args.attempt !== undefined ? { attempt: args.attempt } : {}),
                    ...(args.group_comment !== undefined ? { group_comment: args.group_comment } : {}),
                    ...(fileIds.length > 0 ? { file_ids: fileIds } : {}),
                },
            });
            return jsonResult(result);
        },
    },
    // ============================================================
    // EDUCATOR / ADMINISTRATOR TOOLS
    // ============================================================
    {
        name: "canvas_grade_submission",
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
        name: "canvas_bulk_grade_submissions",
        description: "Bulk update grades for multiple submissions on an assignment. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            grade_data: z.record(z.string(), z.object({ posted_grade: z.string() })),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.post(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/update_grades`,
                { grade_data: args.grade_data },
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_list_section_submissions",
        description: "List all submissions for a section across assignments. Requires educator permissions.",
        inputSchema: z.object({
            section_id: canvasId,
            assignment_ids: z.array(canvasId).optional(),
            workflow_state: z.enum(["submitted", "unsubmitted", "graded", "pending_review"]).optional(),
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const submissions = await canvas.collectPaginated(
                `/api/v1/sections/${args.section_id}/students/submissions`,
                {
                    per_page: 100,
                    ...(args.assignment_ids ? { assignment_ids: args.assignment_ids } : {}),
                    ...(args.workflow_state ? { workflow_state: args.workflow_state } : {}),
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(submissions);
        },
    },
];
