import { describe, it, expect, vi } from "vitest";
import { assignmentTools } from "../../src/tools/assignments.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = assignmentTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("assignment tools", () => {
    it("canvas_list_assignments calls collectPaginated with course and bucket filter", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 10, name: "Essay 1" }]);
        const tool = findTool("canvas_list_assignments");
        const result = await tool.handler(
            { course_id: 5, bucket: "upcoming" },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/5/assignments",
            expect.objectContaining({ per_page: 100, bucket: "upcoming" }),
        );
        expect(result.content[0].text).toContain("Essay 1");
    });

    it("canvas_get_assignment hits the single-assignment endpoint", async () => {
        const get = vi.fn().mockResolvedValue({ id: 20, name: "Midterm" });
        const tool = findTool("canvas_get_assignment");
        const result = await tool.handler(
            { course_id: 5, assignment_id: 20 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/5/assignments/20",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Midterm");
    });

    it("canvas_list_assignment_groups calls collectPaginated for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 3, name: "Homework" }]);
        const tool = findTool("canvas_list_assignment_groups");
        const result = await tool.handler(
            { course_id: 5 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/5/assignment_groups",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Homework");
    });

    it("canvas_list_missing_assignments calls get on missing_submissions", async () => {
        const get = vi.fn().mockResolvedValue([{ id: 55, name: "Lab Report" }]);
        const tool = findTool("canvas_list_missing_assignments");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/users/self/missing_submissions",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Lab Report");
    });

});
