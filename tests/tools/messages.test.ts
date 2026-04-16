import { describe, it, expect, vi } from "vitest";
import { messageTools } from "../../src/tools/messages.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = messageTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("message tools", () => {
    it("canvas_list_conversations calls collectPaginated", async () => {
        const collect = vi.fn().mockResolvedValue([{ id: 1, subject: "Hello" }]);
        const tool = findTool("canvas_list_conversations");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/conversations",
            expect.objectContaining({ per_page: 100 }),
        );
        expect(result.content[0].text).toContain("Hello");
    });

    it("canvas_list_conversations passes optional scope and filter", async () => {
        const collect = vi.fn().mockResolvedValue([]);
        const tool = findTool("canvas_list_conversations");
        await tool.handler(
            { scope: "unread", filter: ["course_10"] },
            { canvas: fakeCanvas({ collectPaginated: collect }) },
        );
        expect(collect).toHaveBeenCalledWith(
            "/api/v1/conversations",
            expect.objectContaining({ scope: "unread", filter: ["course_10"] }),
        );
    });

    it("canvas_get_conversation fetches a single conversation", async () => {
        const get = vi.fn().mockResolvedValue({ id: 5, subject: "Assignment question" });
        const tool = findTool("canvas_get_conversation");
        const result = await tool.handler(
            { conversation_id: 5 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/conversations/5",
            expect.any(Object),
        );
        expect(result.content[0].text).toContain("Assignment question");
    });

    it("canvas_get_conversation passes optional include", async () => {
        const get = vi.fn().mockResolvedValue({ id: 5 });
        const tool = findTool("canvas_get_conversation");
        await tool.handler(
            { conversation_id: 5, include: ["participant_avatars"] },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith(
            "/api/v1/conversations/5",
            { include: ["participant_avatars"] },
        );
    });

    it("canvas_get_unread_count calls get for unread_count endpoint", async () => {
        const get = vi.fn().mockResolvedValue({ unread_count: 3 });
        const tool = findTool("canvas_get_unread_count");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/conversations/unread_count", {});
        expect(result.content[0].text).toContain("3");
    });

    it("canvas_mark_conversation_read calls put on the conversation endpoint", async () => {
        const put = vi.fn().mockResolvedValue({ id: 5, workflow_state: "read" });
        const tool = findTool("canvas_mark_conversation_read");
        const result = await tool.handler(
            { conversation_id: 5 },
            { canvas: fakeCanvas({ put }) },
        );
        expect(put).toHaveBeenCalledWith(
            "/api/v1/conversations/5",
            expect.objectContaining({ conversation: { workflow_state: "read" } }),
        );
        expect(result.content[0].text).toBeTruthy();
    });

    it("canvas_mark_conversation_read passes custom workflow_state", async () => {
        const put = vi.fn().mockResolvedValue({ id: 5, workflow_state: "archived" });
        const tool = findTool("canvas_mark_conversation_read");
        await tool.handler(
            { conversation_id: 5, workflow_state: "archived" },
            { canvas: fakeCanvas({ put }) },
        );
        expect(put).toHaveBeenCalledWith(
            "/api/v1/conversations/5",
            { conversation: { workflow_state: "archived" } },
        );
    });
});
