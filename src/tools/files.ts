import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";
import { hasUploadSource, readUploadSource, uploadSourceFields } from "./upload-source.js";

function uploadInitPath(
    target: "user" | "course" | "submission" | "submission_comment",
    courseId: string | undefined,
    assignmentId: string | undefined,
): string {
    if (target === "user") return "/api/v1/users/self/files";
    if (!courseId) throw new Error(`course_id is required for target=${target}.`);
    if (target === "course") return `/api/v1/courses/${courseId}/files`;
    if (!assignmentId) throw new Error(`assignment_id is required for target=${target}.`);
    const submission = `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/self`;
    return target === "submission" ? `${submission}/files` : `${submission}/comments/files`;
}

function downloadUrlResult(file: unknown, fileId: string | number) {
    const url = file && typeof file === "object" && "url" in file && typeof file.url === "string"
        ? file.url
        : undefined;
    if (url) return jsonResult({ url });

    const result = jsonResult({
        error: `Canvas did not return a download URL for file ${fileId}.`,
    });
    return { ...result, isError: true };
}

export const fileTools: ToolDef[] = [
    {
        name: "canvas_list_course_files",
        description:
            "List files in a course. Optionally filter by search_term, content_types, or sort order.",
        inputSchema: z.object({
            course_id: canvasId,
            search_term: z.string().optional(),
            content_types: z.array(z.string()).optional(),
            sort: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            const files = await canvas.collectPaginated(`/api/v1/courses/${args.course_id}/files`, {
                per_page: 100,
                ...(args.search_term ? { search_term: args.search_term } : {}),
                ...(args.content_types ? { content_types: args.content_types } : {}),
                ...(args.sort ? { sort: args.sort } : {}),
            });
            return jsonResult(files);
        },
    },
    {
        name: "canvas_list_folders",
        description: "List all folders in a course.",
        inputSchema: z.object({
            course_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const folders = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/folders`,
                { per_page: 100 },
            );
            return jsonResult(folders);
        },
    },
    {
        name: "canvas_list_folder_files",
        description: "List files inside a specific folder by folder ID.",
        inputSchema: z.object({
            folder_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const files = await canvas.collectPaginated(`/api/v1/folders/${args.folder_id}/files`, {
                per_page: 100,
            });
            return jsonResult(files);
        },
    },
    {
        name: "canvas_get_file",
        description:
            "Get metadata for a single file by ID. Optionally include user and usage_rights.",
        inputSchema: z.object({
            file_id: canvasId,
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const file = await canvas.get(`/api/v1/files/${args.file_id}`, {
                ...(args.include ? { include: args.include } : {}),
            });
            return jsonResult(file);
        },
    },
    {
        name: "canvas_get_file_download_url",
        description:
            "Get the pre-authenticated download URL for a file. Returns the url field from the file metadata.",
        inputSchema: z.object({
            file_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const file = await canvas.get(`/api/v1/files/${args.file_id}`, {});
            return downloadUrlResult(file, args.file_id);
        },
    },
    {
        name: "canvas_upload_file",
        description:
            "Upload a file to Canvas. target=user puts it in the authenticated user's files, target=course in course files " +
            "(needs file-management permission), target=submission stages it for an assignment and returns a file id for " +
            "canvas_submit_assignment file_ids, and target=submission_comment does the same for canvas_post_submission_comment. " +
            "Send the bytes with file_path (on the MCP server host, inside CANVAS_UPLOAD_ROOTS) or content_base64 + filename. " +
            "For a large file the server cannot read, pass filename + size without bytes to get " +
            "an upload slot instead: POST multipart to upload_url with every upload_params field and the file field last. " +
            "A 201 response is the file JSON (done); for a 3xx, call this tool again with confirm_location set to the Location header.",
        inputSchema: z.object({
            target: z.enum(["user", "course", "submission", "submission_comment"]),
            course_id: canvasId.optional(),
            assignment_id: canvasId.optional(),
            ...uploadSourceFields,
            size: z.number().int().positive().optional().describe("Byte size, only for requesting an upload slot."),
            parent_folder_path: z.string().optional(),
            on_duplicate: z.enum(["rename", "overwrite"]).default("rename"),
            confirm_location: z.string().optional().describe("Location header from a 3xx upload-slot response."),
        }),
        handler: async (args, { canvas, uploadRoots }) => {
            if (args.confirm_location !== undefined) {
                return jsonResult(await canvas.confirmUploadLocation(args.confirm_location));
            }

            const initPath = uploadInitPath(args.target, args.course_id, args.assignment_id);
            // submission and comment files live outside the folder tree
            const opts = args.target === "submission" || args.target === "submission_comment"
                ? {}
                : {
                    onDuplicate: args.on_duplicate,
                    ...(args.parent_folder_path ? { parentFolderPath: args.parent_folder_path } : {}),
                };

            if (!hasUploadSource(args)) {
                if (!args.filename || args.size === undefined) {
                    throw new Error("Provide file_path or content_base64 to upload, or filename + size to request an upload slot.");
                }
                const slot = await canvas.requestUploadSlot(
                    initPath,
                    {
                        name: args.filename,
                        size: args.size,
                        ...(args.content_type ? { contentType: args.content_type } : {}),
                    },
                    opts,
                );
                return jsonResult({
                    ...slot,
                    expires_in_minutes: 30,
                    next_step:
                        `POST multipart/form-data to upload_url with every upload_params field unchanged, then the bytes as "${slot.file_param}" last. ` +
                        "Do not send the Canvas token there. A 201 body is the finished file; for a 3xx call canvas_upload_file with confirm_location.",
                });
            }

            const file = await readUploadSource(args, uploadRoots ?? []);
            return jsonResult(await canvas.uploadFile(initPath, file, opts));
        },
    },

    // ============================================================
    // ADMIN / EDUCATOR TOOLS
    // ============================================================
    {
        name: "canvas_delete_file",
        description: "Delete a file by ID. Requires educator permissions.",
        inputSchema: z.object({
            file_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(`/api/v1/files/${args.file_id}`);
            return jsonResult(result);
        },
    },
];
