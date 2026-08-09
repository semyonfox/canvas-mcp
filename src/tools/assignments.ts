import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

const assignmentDate = z.object({
    base: z.boolean().optional(),
    due_at: z.string().nullable().optional(),
    lock_at: z.string().nullable().optional(),
    unlock_at: z.string().nullable().optional(),
    title: z.string().optional(),
    id: canvasId.optional(),
}).refine(
    (date) => (date.base === true) !== (date.id !== undefined),
    "Each assignment date must be either the base date (base: true) or an override date (id), not both.",
);

export const assignmentTools: ToolDef[] = [
    {
        name: "canvas_list_assignments",
        description:
            "List assignments for a course, with optional bucket filter (upcoming, overdue, past, etc.) and search.",
        inputSchema: z.object({
            course_id: canvasId,
            bucket: z
                .enum(["past", "overdue", "undated", "ungraded", "unsubmitted", "upcoming", "future"])
                .optional(),
            include: z.array(z.string()).optional(),
            search_term: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            const assignments = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/assignments`,
                {
                    per_page: 100,
                    ...(args.bucket ? { bucket: args.bucket } : {}),
                    ...(args.include ? { include: args.include } : {}),
                    ...(args.search_term ? { search_term: args.search_term } : {}),
                },
            );
            return jsonResult(assignments);
        },
    },
    {
        name: "canvas_get_assignment",
        description: "Get full details for a single assignment by course and assignment ID.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const assignment = await canvas.get(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}`,
                {
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(assignment);
        },
    },
    {
        name: "canvas_list_assignment_groups",
        description: "List assignment groups for a course, optionally including assignments and submissions.",
        inputSchema: z.object({
            course_id: canvasId,
            include: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const groups = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/assignment_groups`,
                {
                    per_page: 100,
                    ...(args.include ? { include: args.include } : {}),
                },
            );
            return jsonResult(groups);
        },
    },
    {
        name: "canvas_list_missing_assignments",
        description:
            "List missing submissions for the authenticated student, with optional course and filter constraints.",
        inputSchema: z.object({
            course_ids: z.array(canvasId).optional(),
            include: z.array(z.string()).optional(),
            filter: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const missing = await canvas.collectPaginated("/api/v1/users/self/missing_submissions", {
                per_page: 100,
                ...(args.course_ids ? { course_ids: args.course_ids } : {}),
                ...(args.include ? { include: args.include } : {}),
                ...(args.filter ? { filter: args.filter } : {}),
            });
            return jsonResult(missing);
        },
    },

    // ============================================================
    // EDUCATOR / ADMINISTRATOR TOOLS
    // ============================================================
    {
        name: "canvas_create_assignment",
        description: "Create a new assignment in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            name: z.string(),
            submission_types: z.array(z.string()).optional(),
            due_at: z.string().optional(),
            points_possible: z.number().optional(),
        }),
        handler: async (args, { canvas }) => {
            const assignment = await canvas.post(
                `/api/v1/courses/${args.course_id}/assignments`,
                {
                    assignment: {
                        name: args.name,
                        ...(args.submission_types ? { submission_types: args.submission_types } : {}),
                        ...(args.due_at ? { due_at: args.due_at } : {}),
                        ...(args.points_possible !== undefined ? { points_possible: args.points_possible } : {}),
                    },
                },
            );
            return jsonResult(assignment);
        },
    },
    {
        name: "canvas_update_assignment",
        description: "Update an existing assignment in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            name: z.string().optional(),
            due_at: z.string().optional(),
            points_possible: z.number().optional(),
        }),
        handler: async (args, { canvas }) => {
            const assignment = await canvas.put(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}`,
                {
                    assignment: {
                        ...(args.name ? { name: args.name } : {}),
                        ...(args.due_at ? { due_at: args.due_at } : {}),
                        ...(args.points_possible !== undefined ? { points_possible: args.points_possible } : {}),
                    },
                },
            );
            return jsonResult(assignment);
        },
    },
    {
        name: "canvas_delete_assignment",
        description: "Delete an assignment from a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}`,
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_create_assignment_group",
        description: "Create an assignment group in a course. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            name: z.string(),
            group_weight: z.number().optional(),
        }),
        handler: async (args, { canvas }) => {
            const group = await canvas.post(
                `/api/v1/courses/${args.course_id}/assignment_groups`,
                {
                    name: args.name,
                    ...(args.group_weight !== undefined ? { group_weight: args.group_weight } : {}),
                },
            );
            return jsonResult(group);
        },
    },
    {
        name: "canvas_bulk_update_assignment_dates",
        description:
            "Bulk-update assignment dates using each assignment's all_dates data. Returns an asynchronous Canvas Progress object; call canvas_get_progress with its id to monitor completion. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_dates: z.array(z.object({
                id: canvasId,
                all_dates: z.array(assignmentDate).min(1),
            })).min(1),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.put(
                `/api/v1/courses/${args.course_id}/assignments/bulk_update`,
                args.assignment_dates,
            );
            return jsonResult(result);
        },
    },
    {
        name: "canvas_assign_peer_review",
        description:
            "Assign a user as the peer reviewer for a specific assignment submission. Requires educator permissions.",
        inputSchema: z.object({
            course_id: canvasId,
            assignment_id: canvasId,
            submission_id: canvasId,
            user_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const review = await canvas.post(
                `/api/v1/courses/${args.course_id}/assignments/${args.assignment_id}/submissions/${args.submission_id}/peer_reviews`,
                { user_id: args.user_id },
            );
            return jsonResult(review);
        },
    },
];
