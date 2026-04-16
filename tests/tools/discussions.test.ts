import { describe, it, expect, vi } from "vitest";
import { discussionTools } from "../../src/tools/discussions.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = discussionTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("discussion tools", () => {
    it("canvas_list_discussion_topics calls collectPaginated for a course", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, title: "Week 1 Discussion" }]);
        const tool = findTool("canvas_list_discussion_topics");
        const result = await tool.handler(
            { course_id: 10 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/discussion_topics",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Week 1 Discussion");
    });

    it("canvas_list_discussion_topics passes optional filters", async () => {
        const collect = vi.fn().mockResolvedValue([]);
        const tool = findTool("canvas_list_discussion_topics");
        await tool.handler(
            { course_id: 10, search_term: "ethics", include: ["sections"] },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/discussion_topics",
            expect.objectContaining({
                per_page: 100,
                search_term: "ethics",
                include: ["sections"],
            }),
        );
    });

    it("canvas_get_discussion_topic calls get for a topic", async () => {
        const get = vi.fn().mockResolvedValue({ id: 5, title: "Group project" });
        const tool = findTool("canvas_get_discussion_topic");
        const result = await tool.handler(
            { course_id: 10, topic_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/discussion_topics/5",
            {},
        );
        expect(result.content[0].text).toContain("Group project");
    });

    it("canvas_get_discussion_view calls get for the threaded view", async () => {
        const get = vi.fn().mockResolvedValue({ participants: [], view: [] });
        const tool = findTool("canvas_get_discussion_view");
        const result = await tool.handler(
            { course_id: 10, topic_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/discussion_topics/5/view",
            {},
        );
        expect(result.content[0].text).toContain("participants");
    });

    it("canvas_list_discussion_entries calls collectPaginated for entries", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 100, message: "Great point!" }]);
        const tool = findTool("canvas_list_discussion_entries");
        const result = await tool.handler(
            { course_id: 10, topic_id: 5 },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/courses/10/discussion_topics/5/entries",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Great point!");
    });

    it("canvas_get_discussion_entry calls get for a single entry", async () => {
        const get = vi.fn().mockResolvedValue({ id: 100, message: "Hello world" });
        const tool = findTool("canvas_get_discussion_entry");
        const result = await tool.handler(
            { course_id: 10, topic_id: 5, entry_id: 100 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/courses/10/discussion_topics/5/entries/100",
            {},
        );
        expect(result.content[0].text).toContain("Hello world");
    });
});
