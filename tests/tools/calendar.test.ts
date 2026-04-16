import { describe, it, expect, vi } from "vitest";
import { calendarTools } from "../../src/tools/calendar.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = calendarTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("calendar tools", () => {
    it("canvas_list_calendar_events calls collectPaginated", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, title: "Lecture", type: "event" }]);
        const tool = findTool("canvas_list_calendar_events");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/calendar_events",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Lecture");
    });

    it("canvas_list_calendar_events passes context_codes, dates, and type", async () => {
        const collect = vi.fn().mockResolvedValue([]);
        const tool = findTool("canvas_list_calendar_events");
        await tool.handler(
            {
                context_codes: ["course_123", "course_456"],
                start_date: "2024-09-01",
                end_date: "2024-12-31",
                type: "assignment",
            },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/calendar_events",
            expect.objectContaining({
                context_codes: ["course_123", "course_456"],
                start_date: "2024-09-01",
                end_date: "2024-12-31",
                type: "assignment",
            }),
        );
    });

    it("canvas_list_upcoming_events calls get for upcoming events", async () => {
        const get = vi.fn().mockResolvedValue([{ id: 2, title: "Quiz due", workflow_state: "active" }]);
        const tool = findTool("canvas_list_upcoming_events");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/users/self/upcoming_events", {});
        expect(result.content[0].text).toContain("Quiz due");
    });

    it("canvas_list_planner_items calls collectPaginated", async () => {
        const collect = vi.fn().mockResolvedValue([{ plannable_id: 10, plannable_type: "assignment" }]);
        const tool = findTool("canvas_list_planner_items");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/planner/items",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("plannable_id");
    });

    it("canvas_list_planner_items passes start_date, end_date, and context_codes", async () => {
        const collect = vi.fn().mockResolvedValue([]);
        const tool = findTool("canvas_list_planner_items");
        await tool.handler(
            {
                start_date: "2024-09-01",
                end_date: "2024-10-01",
                context_codes: ["course_99"],
            },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/planner/items",
            expect.objectContaining({
                start_date: "2024-09-01",
                end_date: "2024-10-01",
                context_codes: ["course_99"],
            }),
        );
    });

    it("canvas_list_todo_items calls get for todo list", async () => {
        const get = vi.fn().mockResolvedValue([{ type: "submitting", assignment: { name: "Essay" } }]);
        const tool = findTool("canvas_list_todo_items");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/users/self/todo", {});
        expect(result.content[0].text).toContain("Essay");
    });
});
