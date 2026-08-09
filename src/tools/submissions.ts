import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

const canvasUserId = z.union([z.literal("self"), canvasId]);
const submissionStudentId = z.union([z.literal("self"), z.literal("all"), canvasId]);

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

    // ============================================================
    // EDUCATOR / ADMINISTRATOR TOOLS
    // ============================================================
    {
        name: "canvas_submit_assignment",
        description:
            "Submit an assignment. Supports online_text_entry and online_url directly. online_upload and media_recording require their documented multi-step upload flows. Requires appropriate permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            submission_type: z.enum(["online_text_entry", "online_url", "online_upload", "media_recording"]),
            body: z.string().optional(),
            url: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            if (args.submission_type === "online_upload") {
                return {
                    ...textResult(
                        "online_upload submissions require a multi-step flow: " +
                        "(1) POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions/self/files " +
                        "to request an upload token (provide name and size), " +
                        "(2) upload the file bytes to the returned upload_url, " +
                        "(3) confirm the upload to get a file_id, " +
                        "(4) POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions " +
                        "with submission[submission_type]=online_upload and submission[file_ids][]=[file_id]. " +
                        "This tool does not implement file upload — use the Canvas Files API directly.",
                    ),
                    isError: true,
                };
            }
            if (args.submission_type === "media_recording") {
                return {
                    ...textResult(
                        "media_recording submissions require a multi-step flow: " +
                        "(1) GET /api/v1/services/kaltura_session to obtain a Kaltura upload token, " +
                        "(2) upload the media to the Kaltura endpoint using the session token, " +
                        "(3) POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions " +
                        "with submission[submission_type]=media_recording, " +
                        "submission[media_comment_id]=<kaltura_entry_id>, and " +
                        "submission[media_comment_type]=video|audio. " +
                        "This tool does not implement Kaltura media upload — use the Kaltura API directly.",
                    ),
                    isError: true,
                };
            }
            const result = await canvas.post(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions`,
                {
                    submission: {
                        submission_type: args.submission_type,
                        ...(args.body !== undefined ? { body: args.body } : {}),
                        ...(args.url !== undefined ? { url: args.url } : {}),
                    },
                },
            );
            return jsonResult(result);
        },
    },
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
        name: "canvas_post_submission_comment",
        description: "Post a comment on a student's submission for an assignment. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            user_id: canvasId,
            comment: z.string(),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.put(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/${args.user_id}`,
                {
                    comment: { text_comment: args.comment },
                },
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
