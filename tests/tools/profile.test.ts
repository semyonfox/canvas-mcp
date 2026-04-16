import { describe, it, expect, vi } from "vitest";
import { profileTools } from "../../src/tools/profile.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
    const tool = profileTools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not registered`);
    return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
    return overrides as unknown as CanvasClient;
}

describe("profile tools", () => {
    it("canvas_get_my_profile calls get for self profile endpoint", async () => {
        const get = vi.fn().mockResolvedValue({ id: 42, name: "Jane Student", login_id: "jane@example.com" });
        const tool = findTool("canvas_get_my_profile");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/users/self/profile", {});
        expect(result.content[0].text).toContain("Jane Student");
    });

    it("canvas_get_user_profile calls get with user_id", async () => {
        const get = vi.fn().mockResolvedValue({ id: 99, name: "Other Student", login_id: "other@example.com" });
        const tool = findTool("canvas_get_user_profile");
        const result = await tool.handler(
            { user_id: 99 },
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/users/99/profile", {});
        expect(result.content[0].text).toContain("Other Student");
    });

    it("canvas_get_my_settings calls get for settings endpoint", async () => {
        const get = vi.fn().mockResolvedValue({ manual_mark_as_read: false, collapse_global_nav: true });
        const tool = findTool("canvas_get_my_settings");
        const result = await tool.handler(
            {},
            { canvas: fakeCanvas({ get }) },
        );
        expect(get).toHaveBeenCalledWith("/api/v1/users/self/settings", {});
        expect(result.content[0].text).toContain("collapse_global_nav");
    });
});
