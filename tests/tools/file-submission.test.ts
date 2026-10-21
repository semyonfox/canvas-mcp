import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasClient } from "../../src/canvas/client.js";
import { fileTools } from "../../src/tools/files.js";
import { submissionTools } from "../../src/tools/submissions.js";
import type { ToolDef } from "../../src/tools/types.js";

const DOMAIN = "x.instructure.com";
const API = `https://${DOMAIN}/api/v1`;
const UPLOAD_URL = "https://inst-fs.example.net/files?token=signed-upload-token";
const PDF = new TextEncoder().encode("%PDF-1.7 tiny test file");
const PDF_BASE64 = Buffer.from(PDF).toString("base64");

interface Call {
    method: string;
    url: string;
    headers: Headers;
    body: RequestInit["body"];
}

type Route = (call: Call) => Response | undefined;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

/** a fake network: each route answers the first matching request, in order */
function fakeNetwork(routes: Route[]) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const call: Call = {
            method: init?.method ?? "GET",
            url: String(input),
            headers: new Headers(init?.headers),
            body: init?.body,
        };
        calls.push(call);
        for (const route of routes) {
            const res = route(call);
            if (res) return res;
        }
        throw new Error(`unexpected request ${call.method} ${call.url}`);
    });
    const canvas = new CanvasClient({ domain: DOMAIN, token: "secret-token", fetch });
    return { canvas, calls };
}

const on = (method: string, url: string, reply: (call: Call) => Response): Route =>
    (call) => (call.method === method && call.url === url ? reply(call) : undefined);

const assignmentOnly = (overrides: Record<string, unknown> = {}) =>
    on("GET", `${API}/courses/5/assignments/10`, () =>
        json(200, { id: "10", submission_types: ["online_upload"], allowed_extensions: ["pdf"], allowed_attempts: -1, ...overrides }));

const currentSubmission = (overrides: Record<string, unknown> = {}) =>
    on("GET", `${API}/courses/5/assignments/10/submissions/self`, () =>
        json(200, { id: "77", workflow_state: "unsubmitted", attempt: null, ...overrides }));

// the preflight reads both before anything is uploaded or submitted
const assignment = (overrides: Record<string, unknown> = {}, submission: Record<string, unknown> = {}): Route => {
    const routes = [assignmentOnly(overrides), currentSubmission(submission)];
    return (call) => routes.reduce<Response | undefined>((found, route) => found ?? route(call), undefined);
};

const callTo = (calls: Call[], method: string, url: string) =>
    calls.find((call) => call.method === method && call.url === url);
const SLOT_PATH = `${API}/courses/5/assignments/10/submissions/self/files`;
const SUBMIT_PATH = `${API}/courses/5/assignments/10/submissions`;

const uploadSlot = on("POST", SLOT_PATH, () =>
    json(200, {
        upload_url: UPLOAD_URL,
        upload_params: { filename: "report.pdf", content_type: "application/pdf", signature: "sig-123" },
    }));

const fileJson = (overrides: Record<string, unknown> = {}) => ({
    id: "900",
    display_name: "report.pdf",
    filename: "report.pdf",
    size: PDF.byteLength,
    "content-type": "application/pdf",
    url: `https://${DOMAIN}/files/900/download?verifier=do-not-leak`,
    ...overrides,
});

const submitted = on("POST", `${API}/courses/5/assignments/10/submissions`, () =>
    json(201, {
        id: "77",
        assignment_id: "10",
        workflow_state: "submitted",
        submission_type: "online_upload",
        submitted_at: "2026-10-21T22:10:00Z",
        attempt: 1,
        late: false,
        missing: false,
        seconds_late: 0,
        preview_url: `https://${DOMAIN}/preview?verifier=do-not-leak`,
        attachments: [fileJson()],
    }));

function tool(tools: ToolDef[], name: string): ToolDef {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`tool ${name} not registered`);
    return found;
}

async function run(tools: ToolDef[], name: string, args: Record<string, unknown>, canvas: CanvasClient, uploadRoots: string[] = []) {
    const t = tool(tools, name);
    return t.handler(t.inputSchema.parse(args), { canvas, uploadRoots });
}

const submitArgs = {
    course_id: "5",
    assignment_id: "10",
    submission_type: "online_upload",
    content_base64: PDF_BASE64,
    filename: "report.pdf",
};

describe("online_upload submission flow", () => {
    it("uploads with a 201 storage response, then submits and summarises the state", async () => {
        const { canvas, calls } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => json(201, fileJson())),
            submitted,
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", submitArgs, canvas);

        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual({
            id: "77",
            assignment_id: "10",
            workflow_state: "submitted",
            submission_type: "online_upload",
            submitted_at: "2026-10-21T22:10:00Z",
            attempt: 1,
            late: false,
            missing: false,
            seconds_late: 0,
            attachments: [{ id: "900", display_name: "report.pdf", size: PDF.byteLength, content_type: "application/pdf" }],
            previous_attempt: 0,
        });
        expect(result.content[0]?.text).not.toContain("verifier");

        const slotRequest = callTo(calls, "POST", SLOT_PATH);
        expect(JSON.parse(String(slotRequest?.body))).toEqual({ name: "report.pdf", size: PDF.byteLength });

        const storage = callTo(calls, "POST", UPLOAD_URL);
        expect(storage?.headers.get("authorization")).toBeNull();
        const form = storage?.body;
        expect(form).toBeInstanceOf(FormData);
        const entries = [...(form as FormData).entries()];
        expect(entries.map(([key]) => key)).toEqual(["filename", "content_type", "signature", "file"]);
        const sent = entries[3]?.[1];
        expect(sent).toBeInstanceOf(File);
        expect(new Uint8Array(await (sent as File).arrayBuffer())).toEqual(PDF);

        const submit = callTo(calls, "POST", SUBMIT_PATH);
        expect(JSON.parse(String(submit?.body))).toEqual({
            submission: { submission_type: "online_upload", file_ids: ["900"] },
        });
    });

    it("follows a 3xx storage redirect with an authenticated confirm GET", async () => {
        const confirm = `${API}/files/900/create_success?uuid=abc`;
        const { canvas, calls } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => new Response(null, { status: 303, headers: { location: confirm } })),
            on("GET", confirm, () => json(200, fileJson())),
            submitted,
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", submitArgs, canvas);

        expect(result.isError).toBeUndefined();
        const confirmCall = calls.find((call) => call.url === confirm);
        expect(confirmCall?.headers.get("authorization")).toBe("Bearer secret-token");
        expect(calls.at(-1)?.url).toBe(SUBMIT_PATH);
    });

    it("fetches the Location when a 201 has no file JSON body", async () => {
        const location = `${API}/files/900`;
        const { canvas } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => new Response("", { status: 201, headers: { location } })),
            on("GET", location, () => json(200, fileJson())),
            submitted,
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", submitArgs, canvas);
        expect(result.isError).toBeUndefined();
    });

    it("refuses to send the token to a redirect outside the Canvas origin", async () => {
        const { canvas, calls } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () =>
                new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })),
        ]);

        await expect(run(submissionTools, "canvas_submit_assignment", submitArgs, canvas))
            .rejects.toThrow(/outside the configured Canvas origin/);
        expect(calls.some((call) => call.url.startsWith("https://evil.example"))).toBe(false);
    });

    it("stops before submitting when Canvas records a different size", async () => {
        const { canvas, calls } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => json(201, fileJson({ size: 3 }))),
        ]);

        await expect(run(submissionTools, "canvas_submit_assignment", submitArgs, canvas))
            .rejects.toThrow(/recorded file 900 as 3 bytes/);
        expect(callTo(calls, "POST", SUBMIT_PATH)).toBeUndefined();
    });

    it("keeps storage error bodies, which may echo signatures, out of the error", async () => {
        const { canvas } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => new Response("<Error><Signature>sig-123</Signature></Error>", { status: 403 })),
        ]);

        const error = await run(submissionTools, "canvas_submit_assignment", submitArgs, canvas).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Canvas file upload to storage failed with HTTP 403.");
    });

    it("rejects a disallowed extension before uploading anything", async () => {
        const { canvas, calls } = fakeNetwork([assignment()]);

        await expect(run(submissionTools, "canvas_submit_assignment", { ...submitArgs, filename: "report.docx" }, canvas))
            .rejects.toThrow(/only accepts pdf/);
        expect(calls.every((call) => call.method === "GET")).toBe(true);
    });

    it("rejects assignments that do not take uploads", async () => {
        const { canvas } = fakeNetwork([assignment({ submission_types: ["online_text_entry"] })]);

        await expect(run(submissionTools, "canvas_submit_assignment", submitArgs, canvas))
            .rejects.toThrow(/does not accept online_upload/);
    });

    it("submits existing file_ids with a comment and re-reads when attachments are absent", async () => {
        const { canvas, calls } = fakeNetwork([
            assignmentOnly(),
            currentSubmission({ attempt: 1, attachments: [fileJson()] }),
            on("POST", SUBMIT_PATH, () => json(201, { id: "77", workflow_state: "submitted", attempt: 2 })),
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", {
            course_id: "5",
            assignment_id: "10",
            submission_type: "online_upload",
            file_ids: ["900"],
            comment: "final version",
        }, canvas);

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(String(callTo(calls, "POST", SUBMIT_PATH)?.body))).toEqual({
            submission: { submission_type: "online_upload", file_ids: ["900"] },
            comment: { text_comment: "final version" },
        });
        expect(calls.filter((call) => call.url === `${SUBMIT_PATH}/self`)).toHaveLength(2);
        expect(result.structuredContent).toMatchObject({ previous_attempt: 1 });
    });

    it("flags a submission that does not carry the uploaded file", async () => {
        const { canvas } = fakeNetwork([
            assignment(),
            on("POST", `${API}/courses/5/assignments/10/submissions`, () =>
                json(201, { id: "77", workflow_state: "submitted", attachments: [fileJson({ id: "111" })] })),
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", {
            course_id: "5",
            assignment_id: "10",
            submission_type: "online_upload",
            file_ids: ["900"],
        }, canvas);

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("900");
    });

    it("needs file_ids or a file source", async () => {
        const { canvas } = fakeNetwork([]);
        await expect(run(submissionTools, "canvas_submit_assignment", {
            course_id: "5",
            assignment_id: "10",
            submission_type: "online_upload",
        }, canvas)).rejects.toThrow(/needs file_ids, file_path or content_base64/);
    });

    it("combines earlier file_ids with a newly uploaded file", async () => {
        const { canvas, calls } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => json(201, fileJson())),
            on("POST", SUBMIT_PATH, () =>
                json(201, { id: "77", workflow_state: "submitted", attachments: [fileJson({ id: "800" }), fileJson()] })),
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", { ...submitArgs, file_ids: ["800"] }, canvas);

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(String(callTo(calls, "POST", SUBMIT_PATH)?.body)).submission.file_ids).toEqual(["800", "900"]);
    });

    it("resubmits as a new attempt while attempts remain", async () => {
        const { canvas } = fakeNetwork([
            assignment({ allowed_attempts: 2 }, { attempt: 1, workflow_state: "submitted" }),
            uploadSlot,
            on("POST", UPLOAD_URL, () => json(201, fileJson())),
            on("POST", SUBMIT_PATH, () =>
                json(201, { id: "77", workflow_state: "submitted", attempt: 2, attachments: [fileJson()] })),
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", submitArgs, canvas);
        expect(result.structuredContent).toMatchObject({ attempt: 2, previous_attempt: 1 });
    });

    it("stops before uploading when every attempt is used", async () => {
        const { canvas, calls } = fakeNetwork([
            assignment({ allowed_attempts: 2 }, { attempt: 2, extra_attempts: 0 }),
        ]);

        await expect(run(submissionTools, "canvas_submit_assignment", submitArgs, canvas))
            .rejects.toThrow("Cannot submit: All 2 allowed attempts are used.");
        expect(calls.every((call) => call.method === "GET")).toBe(true);
    });

    it("counts extra attempts and lets a redo request through", async () => {
        const extra = fakeNetwork([
            assignment({ allowed_attempts: 1 }, { attempt: 1, extra_attempts: 1 }),
            on("POST", SUBMIT_PATH, () => json(201, { id: "77", workflow_state: "submitted", attachments: [fileJson()] })),
        ]);
        const fileIdArgs = { course_id: "5", assignment_id: "10", submission_type: "online_upload", file_ids: ["900"] };
        await expect(run(submissionTools, "canvas_submit_assignment", fileIdArgs, extra.canvas)).resolves.toBeDefined();

        const redo = fakeNetwork([
            assignment({ allowed_attempts: 1 }, { attempt: 1, redo_request: true }),
            on("POST", SUBMIT_PATH, () => json(201, { id: "77", workflow_state: "submitted", attachments: [fileJson()] })),
        ]);
        await expect(run(submissionTools, "canvas_submit_assignment", fileIdArgs, redo.canvas)).resolves.toBeDefined();
    });

    it("refuses a locked assignment with Canvas's explanation", async () => {
        const { canvas } = fakeNetwork([
            assignment({ locked_for_user: true, lock_explanation: "This assignment was locked Oct 20 at 23:59." }),
        ]);
        await expect(run(submissionTools, "canvas_submit_assignment", submitArgs, canvas))
            .rejects.toThrow("Cannot submit: The assignment is locked. This assignment was locked Oct 20 at 23:59.");
    });

    it("preflights text entries too", async () => {
        const { canvas, calls } = fakeNetwork([assignment()]);
        await expect(run(submissionTools, "canvas_submit_assignment", {
            course_id: "5",
            assignment_id: "10",
            submission_type: "online_text_entry",
            body: "<p>answer</p>",
        }, canvas)).rejects.toThrow(/does not accept online_text_entry/);
        expect(callTo(calls, "POST", SUBMIT_PATH)).toBeUndefined();
    });

    it("still refuses media_recording without calling Canvas", async () => {
        const { canvas, calls } = fakeNetwork([]);
        const result = await run(submissionTools, "canvas_submit_assignment", {
            course_id: "5",
            assignment_id: "10",
            submission_type: "media_recording",
        }, canvas);
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("Kaltura");
        expect(calls).toHaveLength(0);
    });
});

describe("file_path uploads", () => {
    let root: string;
    let outside: string;

    beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), "canvas-upload-root-"));
        outside = await mkdtemp(join(tmpdir(), "canvas-upload-outside-"));
        await writeFile(join(root, "report.pdf"), PDF);
        await mkdir(join(root, ".secret"));
        await writeFile(join(root, ".secret", "key.pdf"), PDF);
        await writeFile(join(outside, "other.pdf"), PDF);
        await symlink(join(outside, "other.pdf"), join(root, "escape.pdf"));
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    });

    const pathArgs = (file_path: string) => ({
        course_id: "5",
        assignment_id: "10",
        submission_type: "online_upload",
        file_path,
    });

    it("uploads a file inside an allowed root under its basename", async () => {
        const { canvas, calls } = fakeNetwork([
            assignment(),
            uploadSlot,
            on("POST", UPLOAD_URL, () => json(201, fileJson())),
            submitted,
        ]);

        const result = await run(submissionTools, "canvas_submit_assignment", pathArgs(join(root, "report.pdf")), canvas, [root]);

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(String(callTo(calls, "POST", SLOT_PATH)?.body))).toMatchObject({ name: "report.pdf", size: PDF.byteLength });
    });

    it.each([
        ["outside every root", () => join(outside, "other.pdf")],
        ["inside a hidden directory", () => join(root, ".secret", "key.pdf")],
        ["a symlink that escapes the root", () => join(root, "escape.pdf")],
    ])("rejects a path %s", async (_label, path) => {
        const { canvas, calls } = fakeNetwork([]);
        await expect(run(submissionTools, "canvas_submit_assignment", pathArgs(path()), canvas, [root]))
            .rejects.toThrow(/outside CANVAS_UPLOAD_ROOTS or inside a hidden directory/);
        expect(calls).toHaveLength(0);
    });

    it("is disabled when no upload roots are configured", async () => {
        const { canvas } = fakeNetwork([]);
        await expect(run(submissionTools, "canvas_submit_assignment", pathArgs(join(root, "report.pdf")), canvas, []))
            .rejects.toThrow(/CANVAS_UPLOAD_ROOTS is not set/);
    });
});

describe("canvas_post_submission_comment", () => {
    it("lets a student comment on their own attempt with an uploaded file", async () => {
        const commentFiles = `${API}/courses/5/assignments/10/submissions/self/comments/files`;
        const { canvas, calls } = fakeNetwork([
            on("POST", commentFiles, () => json(200, { upload_url: UPLOAD_URL, upload_params: {} })),
            on("POST", UPLOAD_URL, () => json(201, fileJson({ id: "950" }))),
            on("PUT", `${SUBMIT_PATH}/self`, () => json(200, { id: "77" })),
        ]);

        await run(submissionTools, "canvas_post_submission_comment", {
            course_id: "5",
            assignment_id: "10",
            comment: "corrected appendix attached",
            attempt: 2,
            content_base64: PDF_BASE64,
            filename: "report.pdf",
        }, canvas);

        expect(JSON.parse(String(callTo(calls, "PUT", `${SUBMIT_PATH}/self`)?.body))).toEqual({
            comment: { text_comment: "corrected appendix attached", attempt: 2, file_ids: ["950"] },
        });
    });
});

describe("canvas_upload_file", () => {
    it("uploads to the user's files and renames on duplicate by default", async () => {
        const { canvas, calls } = fakeNetwork([
            on("POST", `${API}/users/self/files`, () => json(200, { upload_url: UPLOAD_URL, upload_params: { key: "k" } })),
            on("POST", UPLOAD_URL, () => json(201, fileJson())),
        ]);

        const result = await run(fileTools, "canvas_upload_file", {
            target: "user",
            content_base64: PDF_BASE64,
            filename: "report.pdf",
            parent_folder_path: "uploads",
        }, canvas);

        expect(JSON.parse(String(calls[0]?.body))).toEqual({
            name: "report.pdf",
            size: PDF.byteLength,
            parent_folder_path: "uploads",
            on_duplicate: "rename",
        });
        expect(result.structuredContent).toMatchObject({ id: "900", size: PDF.byteLength });
        expect(result.content[0]?.text).not.toContain("verifier");
    });

    it("uses the course files endpoint and requires course_id", async () => {
        const { canvas, calls } = fakeNetwork([
            on("POST", `${API}/courses/5/files`, () => json(200, { upload_url: UPLOAD_URL, upload_params: {} })),
            on("POST", UPLOAD_URL, () => json(201, fileJson())),
        ]);

        await run(fileTools, "canvas_upload_file", {
            target: "course",
            course_id: "5",
            content_base64: PDF_BASE64,
            filename: "report.pdf",
        }, canvas);
        expect(calls[0]?.url).toBe(`${API}/courses/5/files`);

        await expect(run(fileTools, "canvas_upload_file", {
            target: "course",
            content_base64: PDF_BASE64,
            filename: "report.pdf",
        }, canvas)).rejects.toThrow(/course_id is required/);
    });

    it("returns an upload slot without sending bytes when only filename and size are given", async () => {
        const { canvas, calls } = fakeNetwork([uploadSlot]);

        const result = await run(fileTools, "canvas_upload_file", {
            target: "submission",
            course_id: "5",
            assignment_id: "10",
            filename: "big.pdf",
            size: 50_000_000,
        }, canvas);

        expect(calls).toHaveLength(1);
        expect(JSON.parse(String(calls[0]?.body))).toEqual({ name: "big.pdf", size: 50_000_000 });
        expect(result.structuredContent).toMatchObject({
            upload_url: UPLOAD_URL,
            upload_params: { signature: "sig-123" },
            file_param: "file",
        });
    });

    it("confirms a client-side upload redirect only on the Canvas origin", async () => {
        const confirm = `${API}/files/900/create_success?uuid=abc`;
        const { canvas } = fakeNetwork([on("GET", confirm, () => json(200, fileJson()))]);

        const ok = await run(fileTools, "canvas_upload_file", { target: "user", confirm_location: confirm }, canvas);
        expect(ok.structuredContent).toMatchObject({ id: "900" });

        await expect(run(fileTools, "canvas_upload_file", {
            target: "user",
            confirm_location: "https://evil.example/api/v1/files/1",
        }, canvas)).rejects.toThrow(/outside the configured Canvas origin/);
    });

    it("rejects malformed base64", async () => {
        const { canvas } = fakeNetwork([]);
        await expect(run(fileTools, "canvas_upload_file", {
            target: "user",
            content_base64: "not base64!",
            filename: "x.pdf",
        }, canvas)).rejects.toThrow(/not valid base64/);
    });
});
