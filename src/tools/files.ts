import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

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

    // ============================================================
    // ADMIN / EDUCATOR TOOLS
    // ============================================================
    {
        name: "canvas_upload_file",
        // stub — Canvas file upload is a 3-step flow that cannot be driven
        // through a single API call; full implementation requires the caller
        // to handle the multipart upload outside this server.
        //
        // Canvas upload procedure (https://canvas.instructure.com/doc/api/file.file_uploads.html):
        //   Step 1 — POST /api/v1/courses/:id/files  → receive upload_url + upload_params
        //   Step 2 — POST upload_url with upload_params + file bytes (multipart/form-data)
        //   Step 3 — follow the redirect (or confirm via POST) to finalize the file object
        description:
            "[STUB] Upload a file to a course. " +
            "Canvas requires a 3-step upload flow that this tool cannot fully execute server-side: " +
            "(1) POST /api/v1/courses/:id/files to get upload_url + upload_params, " +
            "(2) POST the file bytes to upload_url with upload_params as multipart/form-data, " +
            "(3) confirm the upload by following the redirect or POSTing to the confirmation URL. " +
            "See https://canvas.instructure.com/doc/api/file.file_uploads.html for the full spec. " +
            "Requires educator/admin permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            name: z.string(),
            size: z.number().int().positive(),
            content_type: z.string().optional(),
            parent_folder_path: z.string().optional(),
        }),
        handler: async (args) => {
            const result = jsonResult({
                error:
                    "canvas_upload_file is not implemented because Canvas uploads require file bytes and a multipart 3-step exchange.",
                requested_params: {
                    course_id: args.course_id,
                    name: args.name,
                    size: args.size,
                    content_type: args.content_type,
                    parent_folder_path: args.parent_folder_path,
                },
                guidance:
                    "Use a Canvas client that can supply file bytes and complete the upload_url multipart request returned by Canvas.",
            });
            return { ...result, isError: true };
        },
    },
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
    {
        name: "canvas_download_file_to_disk",
        // thin wrapper — server-side filesystem write is not safe in this
        // deployment; returns the pre-authenticated download URL instead,
        // which is identical to what canvas_get_file_download_url provides
        description:
            "[DEPRECATED] This server cannot write to a caller-selected disk path. " +
            "Use canvas_get_file_download_url and save the returned URL client-side instead.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.object({
            file_id: canvasId,
            destination_path: z.string(),
        }),
        handler: async (args, { canvas }) => {
            const file = await canvas.get(`/api/v1/files/${args.file_id}`, {});
            const urlResult = downloadUrlResult(file, args.file_id);
            const result = jsonResult({
                error: "Server-side filesystem downloads are not supported.",
                destination_path_ignored: args.destination_path,
                ...(urlResult.structuredContent && typeof urlResult.structuredContent === "object"
                    ? urlResult.structuredContent
                    : {}),
            });
            return { ...result, isError: true };
        },
    },
];
