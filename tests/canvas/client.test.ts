import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanvasClient } from "../../src/canvas/client.js";
import { CanvasError } from "../../src/canvas/errors.js";

function mockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const fn = vi.fn();
    for (const r of responses) {
        fn.mockResolvedValueOnce(
            new Response(JSON.stringify(r.body), {
                status: r.status,
                headers: { "content-type": "application/json", ...(r.headers ?? {}) },
            }),
        );
    }
    return fn;
}

describe("CanvasClient.get", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("sends bearer auth and returns parsed JSON", async () => {
        const fetch = mockFetch([{ status: 200, body: { id: 1, name: "c1" } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        const result = await client.get<{ id: number; name: string }>("/api/v1/courses/1");
        expect(result).toEqual({ id: 1, name: "c1" });
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe("https://x.instructure.com/api/v1/courses/1");
        expect((init.headers as Headers).get("authorization")).toBe("Bearer tok");
        expect((init.headers as Headers).get("accept")).toBe("application/json+canvas-string-ids");
    });

    it("serializes query params", async () => {
        const fetch = mockFetch([{ status: 200, body: [] }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        await client.get("/api/v1/courses", { enrollment_state: "active", per_page: 50 });
        const [url] = fetch.mock.calls[0];
        expect(url).toContain("enrollment_state=active");
        expect(url).toContain("per_page=50");
    });

    it("throws CanvasError on 4xx without retry", async () => {
        const fetch = mockFetch([{ status: 404, body: { errors: [{ message: "not found" }] } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        await expect(client.get("/api/v1/courses/999")).rejects.toBeInstanceOf(CanvasError);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries retryable 5xx GET responses", async () => {
        const fetch = mockFetch([
            { status: 502, body: {}, headers: { "retry-after": "0" } },
            { status: 200, body: { ok: true } },
        ]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        const result = await client.get<{ ok: boolean }>("/api/v1/x");
        expect(result).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("retries 429 GET responses", async () => {
        const fetch = mockFetch([
            { status: 429, body: { error: "slow down" }, headers: { "retry-after": "0" } },
            { status: 200, body: { ok: true } },
        ]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        await expect(client.get<{ ok: boolean }>("/api/v1/x")).resolves.toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 401", async () => {
        const fetch = mockFetch([{ status: 401, body: { errors: [{ message: "bad token" }] } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        await expect(client.get("/api/v1/self")).rejects.toMatchObject({ status: 401 });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("returns null for 204 and empty successful responses", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        await expect(client.delete<{ deleted: boolean }>("/api/v1/files/1")).resolves.toBeNull();
        await expect(client.post<{ ok: boolean }>("/api/v1/x", { value: true })).resolves.toBeNull();
    });
});

describe("CanvasClient.post", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("sends POST with JSON body and returns parsed response", async () => {
        const fetch = mockFetch([{ status: 200, body: { marked: true } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        const result = await client.post<{ marked: boolean }>("/api/v1/courses/1/modules/2/items/3/mark_read");
        expect(result).toEqual({ marked: true });
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe("https://x.instructure.com/api/v1/courses/1/modules/2/items/3/mark_read");
        expect(init.method).toBe("POST");
        expect((init.headers as Headers).get("authorization")).toBe("Bearer tok");
    });

    it("does not retry failed mutations", async () => {
        const fetch = mockFetch([{ status: 503, body: { error: "maintenance" } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        await expect(client.post("/api/v1/x", { value: true })).rejects.toMatchObject({
            status: 503,
            message: expect.stringContaining("maintenance"),
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("preserves nested Canvas error messages and the response body", async () => {
        const body = { errors: { name: [{ message: "must not be blank" }] } };
        const fetch = mockFetch([{ status: 422, body }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        const error = await client.post("/api/v1/courses", { name: "" }).catch((cause: unknown) => cause);
        expect(error).toMatchObject({
            status: 422,
            body,
        });
        expect(error).toBeInstanceOf(CanvasError);
        expect((error as Error).message).toContain("must not be blank");
    });
});

describe("CanvasClient.patch", () => {
    it("sends PATCH without automatically retrying a mutation", async () => {
        const fetch = mockFetch([{ status: 200, body: { updated: true } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        await expect(client.patch("/api/quiz/v1/courses/1/quizzes/2/items/3", { title: "Updated" }))
            .resolves.toEqual({ updated: true });
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    });
});

describe("CanvasClient.delete", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("sends DELETE and returns parsed response", async () => {
        const fetch = mockFetch([{ status: 200, body: { id: 1, deleted: true } }]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
        const result = await client.delete<{ id: number; deleted: boolean }>("/api/v1/courses/1");
        expect(result).toEqual({ id: 1, deleted: true });
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe("https://x.instructure.com/api/v1/courses/1");
        expect(init.method).toBe("DELETE");
    });
});

describe("CanvasClient pagination", () => {
    it("retries rate-limited pagination requests", async () => {
        const fetch = mockFetch([
            {
                status: 200,
                body: ["first"],
                headers: { link: '<https://x.instructure.com/api/v1/x?page=2>; rel="next"' },
            },
            { status: 429, body: { error: "slow down" }, headers: { "retry-after": "0" } },
            { status: 200, body: ["second"] },
        ]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        await expect(client.collectPaginated<string>("/api/v1/x")).resolves.toEqual(["first", "second"]);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("rejects pagination links that leave the configured Canvas origin", async () => {
        const fetch = mockFetch([
            {
                status: 200,
                body: ["first"],
                headers: { link: '<https://attacker.example/api/v1/x?page=2>; rel="next"' },
            },
        ]);
        const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });

        await expect(client.collectPaginated<string>("/api/v1/x")).rejects.toMatchObject({
            status: 502,
            message: expect.stringContaining("outside the configured Canvas origin"),
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
