import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

const recurringEventScope = z.enum(["one", "all", "following"]);

export const calendarTools: ToolDef[] = [
    {
        name: "canvas_list_calendar_events",
        description:
            "List the authenticated user's calendar events (the default type) or assignments. Set type=assignment or type=sub_assignment to retrieve assignment-backed entries; all_events ignores date and undated filters.",
        inputSchema: z.object({
            context_codes: z.array(z.string()).max(10).optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            type: z.enum(["event", "assignment", "sub_assignment"]).optional(),
            undated: z.boolean().optional(),
            all_events: z.boolean().optional(),
            excludes: z.array(z.enum(["description", "child_events", "assignment"])).optional(),
            includes: z.array(z.enum(["web_conference", "series_natural_language"])).optional(),
            important_dates: z.boolean().optional(),
            blackout_date: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const events = await canvas.collectPaginated("/api/v1/calendar_events", {
                per_page: 100,
                ...(args.context_codes ? { context_codes: args.context_codes } : {}),
                ...(args.start_date ? { start_date: args.start_date } : {}),
                ...(args.end_date ? { end_date: args.end_date } : {}),
                ...(args.type ? { type: args.type } : {}),
                ...(args.undated !== undefined ? { undated: args.undated } : {}),
                ...(args.all_events !== undefined ? { all_events: args.all_events } : {}),
                ...(args.excludes ? { excludes: args.excludes } : {}),
                ...(args.includes ? { includes: args.includes } : {}),
                ...(args.important_dates !== undefined ? { important_dates: args.important_dates } : {}),
                ...(args.blackout_date !== undefined ? { blackout_date: args.blackout_date } : {}),
            });
            return jsonResult(events);
        },
    },
    {
        name: "canvas_list_upcoming_events",
        description:
            "List Canvas-selected upcoming assignments and calendar events for the authenticated user. Optional type, days, and limit filters are applied locally after Canvas returns its upcoming list.",
        inputSchema: z.object({
            type: z.enum(["assignment", "event"]).optional(),
            days: z.number().int().positive().optional(),
            limit: z.number().int().positive().optional(),
        }),
        handler: async (args, { canvas }) => {
            const events = await canvas.collectPaginated<Record<string, unknown>>(
                "/api/v1/users/self/upcoming_events",
                { per_page: 100 },
            );
            let filtered = events;
            if (args.type) {
                filtered = filtered.filter((event) => event["type"] === args.type);
            }
            if (args.days !== undefined) {
                const cutoff = Date.now() + args.days * 86_400_000;
                filtered = filtered.filter((event) => {
                    const when = (event["end_at"] ?? event["start_at"] ?? event["due_at"]) as string | undefined;
                    if (!when) return true;
                    const timestamp = Date.parse(when);
                    return Number.isNaN(timestamp) ? true : timestamp <= cutoff;
                });
            }
            if (args.limit !== undefined) {
                filtered = filtered.slice(0, args.limit);
            }
            return jsonResult(filtered);
        },
    },
    {
        name: "canvas_list_planner_items",
        description:
            "List planner items for the authenticated student. Optionally filter by date range or context_codes (for example course_123).",
        inputSchema: z.object({
            start_date: z.string().optional(),
            end_date: z.string().optional(),
            context_codes: z.array(z.string()).optional(),
        }),
        handler: async (args, { canvas }) => {
            const items = await canvas.collectPaginated("/api/v1/planner/items", {
                per_page: 100,
                ...(args.start_date ? { start_date: args.start_date } : {}),
                ...(args.end_date ? { end_date: args.end_date } : {}),
                ...(args.context_codes ? { context_codes: args.context_codes } : {}),
            });
            return jsonResult(items);
        },
    },
    {
        name: "canvas_list_todo_items",
        description:
            "List the authenticated user's to-do items, including assignments to submit and items to review.",
        inputSchema: z.object({}),
        handler: async (_args, { canvas }) => {
            const todos = await canvas.collectPaginated("/api/v1/users/self/todo", { per_page: 100 });
            return jsonResult(todos);
        },
    },

    // ============================================================
    // EDUCATOR / ADMINISTRATOR TOOLS
    // ============================================================
    {
        name: "canvas_create_calendar_event",
        description: "Create a calendar event. Requires educator permissions.",
        inputSchema: z.object({
            context_code: z.string(),
            title: z.string(),
            start_at: z.string().optional(),
            end_at: z.string().optional(),
            description: z.string().optional(),
            location_name: z.string().optional(),
            location_address: z.string().optional(),
            time_zone_edited: z.string().optional(),
            all_day: z.boolean().optional(),
            rrule: z.string().optional(),
            blackout_date: z.boolean().optional(),
        }),
        handler: async (args, { canvas }) => {
            const event = await canvas.post("/api/v1/calendar_events", {
                calendar_event: {
                    context_code: args.context_code,
                    title: args.title,
                    ...(args.start_at ? { start_at: args.start_at } : {}),
                    ...(args.end_at ? { end_at: args.end_at } : {}),
                    ...(args.description ? { description: args.description } : {}),
                    ...(args.location_name ? { location_name: args.location_name } : {}),
                    ...(args.location_address ? { location_address: args.location_address } : {}),
                    ...(args.time_zone_edited ? { time_zone_edited: args.time_zone_edited } : {}),
                    ...(args.all_day !== undefined ? { all_day: args.all_day } : {}),
                    ...(args.rrule ? { rrule: args.rrule } : {}),
                    ...(args.blackout_date !== undefined ? { blackout_date: args.blackout_date } : {}),
                },
            });
            return jsonResult(event);
        },
    },
    {
        name: "canvas_update_calendar_event",
        description:
            "Update a calendar event. For a recurring event, which controls whether one occurrence, all occurrences, or this and following occurrences are changed. Requires educator permissions.",
        inputSchema: z.object({
            event_id: canvasId,
            context_code: z.string().optional(),
            title: z.string().optional(),
            start_at: z.string().optional(),
            end_at: z.string().optional(),
            description: z.string().optional(),
            location_name: z.string().optional(),
            location_address: z.string().optional(),
            time_zone_edited: z.string().optional(),
            all_day: z.boolean().optional(),
            rrule: z.string().optional(),
            blackout_date: z.boolean().optional(),
            which: recurringEventScope.optional(),
        }),
        handler: async (args, { canvas }) => {
            const event = await canvas.put(`/api/v1/calendar_events/${args.event_id}`, {
                calendar_event: {
                    ...(args.context_code !== undefined ? { context_code: args.context_code } : {}),
                    ...(args.title !== undefined ? { title: args.title } : {}),
                    ...(args.start_at !== undefined ? { start_at: args.start_at } : {}),
                    ...(args.end_at !== undefined ? { end_at: args.end_at } : {}),
                    ...(args.description !== undefined ? { description: args.description } : {}),
                    ...(args.location_name !== undefined ? { location_name: args.location_name } : {}),
                    ...(args.location_address !== undefined ? { location_address: args.location_address } : {}),
                    ...(args.time_zone_edited !== undefined ? { time_zone_edited: args.time_zone_edited } : {}),
                    ...(args.all_day !== undefined ? { all_day: args.all_day } : {}),
                    ...(args.rrule !== undefined ? { rrule: args.rrule } : {}),
                    ...(args.blackout_date !== undefined ? { blackout_date: args.blackout_date } : {}),
                },
                ...(args.which !== undefined ? { which: args.which } : {}),
            });
            return jsonResult(event);
        },
    },
    {
        name: "canvas_delete_calendar_event",
        description:
            "Delete a calendar event. For a recurring event, which controls whether one occurrence, all occurrences, or this and following occurrences are deleted. Requires educator permissions.",
        inputSchema: z.object({
            event_id: canvasId,
            cancel_reason: z.string().optional(),
            which: recurringEventScope.optional(),
        }),
        handler: async (args, { canvas }) => {
            const options = {
                ...(args.cancel_reason !== undefined ? { cancel_reason: args.cancel_reason } : {}),
                ...(args.which !== undefined ? { which: args.which } : {}),
            };
            const result = Object.keys(options).length > 0
                ? await canvas.delete(`/api/v1/calendar_events/${args.event_id}`, options)
                : await canvas.delete(`/api/v1/calendar_events/${args.event_id}`);
            return jsonResult(result);
        },
    },
    {
        name: "canvas_create_planner_note",
        description: "Create a planner note. Requires educator permissions.",
        inputSchema: z.object({
            title: z.string(),
            details: z.string().optional(),
            todo_date: z.string().optional(),
            course_id: canvasId.optional(),
        }),
        handler: async (args, { canvas }) => {
            const note = await canvas.post("/api/v1/planner_notes", {
                title: args.title,
                ...(args.details ? { details: args.details } : {}),
                ...(args.todo_date ? { todo_date: args.todo_date } : {}),
                ...(args.course_id !== undefined ? { course_id: args.course_id } : {}),
            });
            return jsonResult(note);
        },
    },
    {
        name: "canvas_update_planner_note",
        description: "Update a planner note. Requires educator permissions.",
        inputSchema: z.object({
            note_id: canvasId,
            title: z.string().optional(),
            details: z.string().optional(),
            todo_date: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            const note = await canvas.put(`/api/v1/planner_notes/${args.note_id}`, {
                ...(args.title ? { title: args.title } : {}),
                ...(args.details ? { details: args.details } : {}),
                ...(args.todo_date ? { todo_date: args.todo_date } : {}),
            });
            return jsonResult(note);
        },
    },
    {
        name: "canvas_delete_planner_note",
        description: "Delete a planner note. Requires educator permissions.",
        inputSchema: z.object({
            note_id: canvasId,
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.delete(`/api/v1/planner_notes/${args.note_id}`);
            return jsonResult(result);
        },
    },
    {
        name: "canvas_mark_planner_item_complete",
        description: "Mark a planner override item as complete. Requires educator permissions.",
        inputSchema: z.object({
            override_id: canvasId,
            marked_complete: z.boolean(),
        }),
        handler: async (args, { canvas }) => {
            const result = await canvas.put(`/api/v1/planner/overrides/${args.override_id}`, {
                marked_complete: args.marked_complete,
            });
            return jsonResult(result);
        },
    },
];
