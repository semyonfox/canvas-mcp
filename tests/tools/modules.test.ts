import { describe, it, expect, vi } from "vitest";
import { moduleTools } from "../../src/tools/modules.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = moduleTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("module tools", () => {
    it("canvas_list_modules calls collectPaginated for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, name: "Week 1" }]);
        const tool = findTool("canvas_list_modules");
        const result = await tool.handler(
            { course_id: 10 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/modules",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Week 1");
    });

    it("canvas_get_module fetches a single module", async () => {
        const get = vi.fn().mockResolvedValue({ id: 5, name: "Intro Module" });
        const tool = findTool("canvas_get_module");
        const result = await tool.handler(
            { course_id: 10, module_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/modules/5",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Intro Module");
    });

    it("canvas_list_module_items calls collectPaginated for a module", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 99, title: "Lecture 1" }]);
        const tool = findTool("canvas_list_module_items");
        const result = await tool.handler(
            { course_id: 10, module_id: 5 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/modules/5/items",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Lecture 1");
    });

    it("canvas_get_module_item fetches a single module item", async () => {
        const get = vi.fn().mockResolvedValue({ id: 99, title: "Quiz 1" });
        const tool = findTool("canvas_get_module_item");
        const result = await tool.handler(
            { course_id: 10, module_id: 5, item_id: 99 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/modules/5/items/99",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Quiz 1");
    });

    it("canvas_get_module_item_sequence fetches next/prev navigation", async () => {
        const get = vi.fn().mockResolvedValue({ items: [], modules: [] });
        const tool = findTool("canvas_get_module_item_sequence");
        const result = await tool.handler(
            { course_id: 10, asset_type: "Assignment", asset_id: 7 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/module_item_sequence",
            expect.objectContaining({ asset_type: "Assignment", asset_id: 7 }),
        );
        expect(result.content[0].text).toBeTruthy();
    });

    it("canvas_mark_module_item_read calls post on the mark_read endpoint", async () => {
        const post = vi.fn().mockResolvedValue({});
        const tool = findTool("canvas_mark_module_item_read");
        const result = await tool.handler(
            { course_id: 10, module_id: 5, item_id: 99 },
            { canvas: fakeCanvas({ post }) },
        );
        expect(post).toHaveBeenCalledWith(
            "/api/v1/courses/10/modules/5/items/99/mark_read",
        );
        expect(result.content[0].text).toBeTruthy();
    });

    it("canvas_mark_module_item_done calls put on the done endpoint", async () => {
        const put = vi.fn().mockResolvedValue({});
        const tool = findTool("canvas_mark_module_item_done");
        const result = await tool.handler(
            { course_id: 10, module_id: 5, item_id: 99 },
            { canvas: fakeCanvas({ put }) },
        );
        expect(put).toHaveBeenCalledWith(
            "/api/v1/courses/10/modules/5/items/99/done",
        );
        expect(result.content[0].text).toBeTruthy();
    });
});
