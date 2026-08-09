import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

const pageUrlOrId = z.string().min(1).describe(
    "A page URL slug, or Canvas's page_id:<id> selector. The value is encoded as one path segment.",
);

const pageAddress = {
    page_url_or_id: pageUrlOrId.optional(),
    page_url: pageUrlOrId.optional().describe("Legacy alias for page_url_or_id."),
};

type PageAddress = {
    page_url_or_id?: string | undefined;
    page_url?: string | undefined;
};

function hasPageAddress(address: PageAddress): boolean {
    return address.page_url_or_id !== undefined || address.page_url !== undefined;
}

function pageRoute(courseId: string, address: PageAddress): string {
    const pageIdentifier = address.page_url_or_id ?? address.page_url;
    if (!pageIdentifier) throw new Error("Provide page_url_or_id or the legacy page_url.");
    return `/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageIdentifier)}`;
}

export const pageTools: ToolDef[] = [
    {
        name: "canvas_list_pages",
        description:
            "List pages for a course. Optionally sort by title/created_at/updated_at, filter by search_term, or filter by published state.",
        inputSchema: z.object({
            course_id: canvasId,
            sort: z.enum(["title", "created_at", "updated_at"]).optional(),
            search_term: z.string().optional(),
            published: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const pages = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/pages`,
                {
                    per_page: 100,
                    ...(args.sort ? { sort: args.sort } : {}),
                    ...(args.search_term ? { search_term: args.search_term } : {}),
                    ...(args.published !== undefined ? { published: args.published } : {}),
                },
            );
            return jsonResult(pages);
        },
    },
    {
        name: "canvas_get_page",
        description:
            "Get a single page by URL slug or page_id:<id>. Returns the full page including HTML body content.",
        inputSchema: z.object({
            course_id: canvasId,
            ...pageAddress,
        }).refine(hasPageAddress, { message: "Provide page_url_or_id or the legacy page_url." }),
        handler: async (args, { canvas }) => {
            const page = await canvas.get(
                pageRoute(args.course_id, args),
                {},
            );
            return jsonResult(page);
        },
    },
    {
        name: "canvas_get_front_page",
        description: "Get the front page for a course.",
        inputSchema: z.object({
            course_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const page = await canvas.get(
                `/api/v1/courses/${args.course_id}/front_page`,
                {},
            );
            return jsonResult(page);
        },
    },
    {
        name: "canvas_list_page_revisions",
        description: "List revision history for a page identified by URL slug or page_id:<id>.",
        inputSchema: z.object({
            course_id: canvasId,
            ...pageAddress,
        }).refine(hasPageAddress, { message: "Provide page_url_or_id or the legacy page_url." }),
        handler: async (args, { canvas }) => {
            const revisions = await canvas.collectPaginated(
                `${pageRoute(args.course_id, args)}/revisions`,
                { per_page: 100 },
            );
            return jsonResult(revisions);
        },
    },
    {
        name: "canvas_get_page_revision",
        description:
            "Get a specific revision of a page. Pass summary=true to get a lightweight response without body HTML.",
        inputSchema: z.object({
            course_id: canvasId,
            ...pageAddress,
            revision_id: canvasId,
            summary: z.boolean().optional(),
        }).refine(hasPageAddress, { message: "Provide page_url_or_id or the legacy page_url." }),
        handler: async (args, { canvas }) => {
            const revision = await canvas.get(
                `${pageRoute(args.course_id, args)}/revisions/${args.revision_id}`,
                {
                    ...(args.summary !== undefined ? { summary: args.summary } : {}),
                },
            );
            return jsonResult(revision);
        },
    },

    // ============================================================
    // EDUCATOR / ADMINISTRATOR TOOLS
    // ============================================================
    {
        name: "canvas_create_page",
        description: "Create a new page in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            title: z.string(),
            body: z.string().optional(),
            published: z.boolean().optional(),
            front_page: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const page = await canvas.post(
                `/api/v1/courses/${args.course_id}/pages`,
                {
                    wiki_page: {
                        title: args.title,
                        ...(args.body !== undefined ? { body: args.body } : {}),
                        ...(args.published !== undefined ? { published: args.published } : {}),
                        ...(args.front_page !== undefined ? { front_page: args.front_page } : {}),
                    },
                },
            );
            return jsonResult(page);
        },
    },
    {
        name: "canvas_update_page",
        description: "Update an existing page by URL slug or page_id:<id>. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            ...pageAddress,
            title: z.string().optional(),
            body: z.string().optional(),
            published: z.boolean().optional(),
            front_page: z.boolean().optional(),
        }).refine(hasPageAddress, { message: "Provide page_url_or_id or the legacy page_url." }),
        handler: async (args, { canvas }) => {
            const page = await canvas.put(
                pageRoute(args.course_id, args),
                {
                    wiki_page: {
                        ...(args.title !== undefined ? { title: args.title } : {}),
                        ...(args.body !== undefined ? { body: args.body } : {}),
                        ...(args.published !== undefined ? { published: args.published } : {}),
                        ...(args.front_page !== undefined ? { front_page: args.front_page } : {}),
                    },
                },
            );
            return jsonResult(page);
        },
    },
    {
        name: "canvas_delete_page",
        description: "Delete a page by URL slug or page_id:<id>. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            ...pageAddress,
        }).refine(hasPageAddress, { message: "Provide page_url_or_id or the legacy page_url." }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(
                pageRoute(args.course_id, args),
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_revert_page_revision",
        description: "Revert a page to a specific revision. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            ...pageAddress,
            revision_id: canvasId,
        }).refine(hasPageAddress, { message: "Provide page_url_or_id or the legacy page_url." }),
        handler: async (args, { canvas }) => {
            const revision = await canvas.post(
                `${pageRoute(args.course_id, args)}/revisions/${args.revision_id}`,
            );
            return jsonResult(revision);
        },
    },
];
