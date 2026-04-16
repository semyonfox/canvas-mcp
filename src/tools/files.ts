import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

export const fileTools: ToolDef[] = [
    {
        name: "canvas_list_course_files",
        description:
            "List files in a course. Optionally filter by search_term, content_types, or sort order.",
        inputSchema: z.object({
            course_id: z.number().int().positive(),
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
            course_id: z.number().int().positive(),
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
            folder_id: z.number().int().positive(),
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
            file_id: z.number().int().positive(),
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
            file_id: z.number().int().positive(),
        }),
        handler: async (args, { canvas }) => {
            const file = await canvas.get(`/api/v1/files/${args.file_id}`, {});
            return jsonResult({ url: (file as { url: string }).url });
        },
    },

    // ============================================================
    // ADMIN / EDUCATOR TOOLS — commented out for student-only build.
    // Uncomment to enable file upload, deletion, and server-side download.
    // ============================================================
    /*
    {
        name: "canvas_upload_file",
        description: "Upload a file to a course (3-step Canvas upload flow). Requires admin permissions.",
        inputSchema: z.object({
            course_id: z.number().int().positive(),
            name: z.string(),
            size: z.number().int().positive(),
            content_type: z.string().optional(),
            parent_folder_path: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.post(`/api/v1/courses/${args.course_id}/files`, {
                name: args.name,
                size: args.size,
                ...(args.content_type ? { content_type: args.content_type } : {}),
                ...(args.parent_folder_path ? { parent_folder_path: args.parent_folder_path } : {}),
            });
            return jsonResult(result);
        },
    },
    {
        name: "canvas_delete_file",
        description: "Delete a file by ID. Requires educator permissions.",
        inputSchema: z.object({
            file_id: z.number().int().positive(),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(`/api/v1/files/${args.file_id}`);
            return jsonResult(result);
        },
    },
    {
        name: "canvas_download_file_to_disk",
        description: "Download a file to the server filesystem. Not student-safe; requires admin permissions.",
        inputSchema: z.object({
            file_id: z.number().int().positive(),
            destination_path: z.string(),
        }),
        handler: async (_args, { canvas: _canvas }) => {
            throw new Error("server-side download not implemented");
        },
    },
    */
];
