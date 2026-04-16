import { describe, it, expect, vi } from "vitest";
import { pageTools } from "../../src/tools/pages.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = pageTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("page tools", () => {
    it("canvas_list_pages calls collectPaginated for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ url: "syllabus", title: "Syllabus" }]);
        const tool = findTool("canvas_list_pages");
        const result = await tool.handler(
            { course_id: 10 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/pages",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Syllabus");
    });

    it("canvas_list_pages passes optional sort and search_term", async () => {
        const collect = vi.fn().mockResolvedValue([{ url: "intro", title: "Intro" }]);
        const tool = findTool("canvas_list_pages");
        await tool.handler(
            { course_id: 10, sort: "title", search_term: "intro" },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/pages",
            expect.objectContaining({ sort: "title", search_term: "intro" }),
        );
    });

    it("canvas_get_page fetches a single page by url slug", async () => {
        const get = vi.fn().mockResolvedValue({ url: "week-1", title: "Week 1", body: "<p>hello</p>" });
        const tool = findTool("canvas_get_page");
        const result = await tool.handler(
            { course_id: 10, page_url: "week-1" },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/pages/week-1",
            {},
        );
        expect(result.content[0].text).toContain("Week 1");
    });

    it("canvas_get_front_page fetches the course front page", async () => {
        const get = vi.fn().mockResolvedValue({ url: "home", title: "Home", body: "<p>welcome</p>" });
        const tool = findTool("canvas_get_front_page");
        const result = await tool.handler(
            { course_id: 10 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/front_page",
            {},
        );
        expect(result.content[0].text).toContain("Home");
    });

    it("canvas_list_page_revisions calls collectPaginated for a page", async () => {
        const collect = vi.fn().mockResolvedValue([{ revision_id: 3, updated_at: "2024-01-01" }]);
        const tool = findTool("canvas_list_page_revisions");
        const result = await tool.handler(
            { course_id: 10, page_url: "week-1" },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/pages/week-1/revisions",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("revision_id");
    });

    it("canvas_get_page_revision fetches a specific revision", async () => {
        const get = vi.fn().mockResolvedValue({ revision_id: 2, title: "Week 1 v2", body: "<p>updated</p>" });
        const tool = findTool("canvas_get_page_revision");
        const result = await tool.handler(
            { course_id: 10, page_url: "week-1", revision_id: 2 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/pages/week-1/revisions/2",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Week 1 v2");
    });
});
