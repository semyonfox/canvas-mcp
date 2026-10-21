import { z } from "zod";
import { CanvasError } from "./errors.js";
import { parseNextLink } from "./pagination.js";

export type FetchLike = typeof fetch;

export interface CanvasClientOptions {
    domain: string;
    token: string;
    fetch?: FetchLike;
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const CANVAS_ACCEPT_HEADER = "application/json+canvas-string-ids";
const MAX_READ_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 5_000;

export interface UploadFile {
    name: string;
    bytes: Uint8Array<ArrayBuffer>;
    contentType?: string;
}

export interface UploadOptions {
    parentFolderPath?: string;
    onDuplicate?: "overwrite" | "rename";
}

export interface UploadSlot {
    upload_url: string;
    upload_params: Record<string, string>;
    file_param: string;
}

/** the subset of a Canvas File object the upload flow relies on */
export interface UploadedFile {
    id: string;
    display_name?: string;
    filename?: string;
    size?: number;
    "content-type"?: string;
    upload_status?: string;
}

const uploadSlotSchema = z.object({
    upload_url: z.string().url(),
    upload_params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    file_param: z.string().optional(),
});

const uploadedFileSchema = z.looseObject({
    id: z.union([z.string(), z.number()]).transform(String),
    display_name: z.string().optional(),
    filename: z.string().optional(),
    size: z.number().optional(),
    "content-type": z.string().optional(),
    upload_status: z.string().optional(),
});

type QueryValue = string | number | boolean | undefined | null | Array<string | number | boolean>;
export type Query = Record<string, QueryValue>;

export class CanvasClient {
    private readonly baseUrl: string;
    private readonly baseOrigin: string;
    private readonly token: string;
    private readonly fetchImpl: FetchLike;
    private readonly timeoutMs: number;

    constructor(opts: CanvasClientOptions) {
        this.baseUrl = `https://${opts.domain}`;
        this.baseOrigin = new URL(this.baseUrl).origin;
        this.token = opts.token;
        this.fetchImpl = opts.fetch ?? fetch;
        this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async get<T>(path: string, query?: Query): Promise<T | null> {
        const res = await this.request(path, { method: "GET", ...(query !== undefined ? { query } : {}) });
        return readJsonOrNull<T>(res);
    }

    async post<T>(path: string, body?: unknown): Promise<T | null> {
        const res = await this.request(path, { method: "POST", ...(body !== undefined ? { body } : {}) });
        return readJsonOrNull<T>(res);
    }

    async put<T>(path: string, body?: unknown): Promise<T | null> {
        const res = await this.request(path, { method: "PUT", ...(body !== undefined ? { body } : {}) });
        return readJsonOrNull<T>(res);
    }

    async patch<T>(path: string, body?: unknown): Promise<T | null> {
        const res = await this.request(path, { method: "PATCH", ...(body !== undefined ? { body } : {}) });
        return readJsonOrNull<T>(res);
    }

    async delete<T>(path: string, body?: unknown): Promise<T | null> {
        const res = await this.request(path, { method: "DELETE", ...(body !== undefined ? { body } : {}) });
        return readJsonOrNull<T>(res);
    }

    async getRaw(path: string, query?: Query): Promise<Response> {
        return this.request(path, { method: "GET", ...(query !== undefined ? { query } : {}) });
    }

    /**
     * Step 1 of Canvas's file upload flow. `initPath` picks the context, e.g.
     * /api/v1/users/self/files or a submissions/self/files endpoint. The slot's
     * signature is valid for about 30 minutes.
     */
    async requestUploadSlot(
        initPath: string,
        file: { name: string; size: number; contentType?: string },
        opts: UploadOptions = {},
    ): Promise<UploadSlot> {
        const raw = await this.post(initPath, {
            name: file.name,
            size: file.size,
            ...(file.contentType ? { content_type: file.contentType } : {}),
            ...(opts.parentFolderPath ? { parent_folder_path: opts.parentFolderPath } : {}),
            ...(opts.onDuplicate ? { on_duplicate: opts.onDuplicate } : {}),
        });
        const parsed = uploadSlotSchema.safeParse(raw);
        if (!parsed.success) {
            throw new CanvasError(502, "Canvas did not return a usable upload_url and upload_params.");
        }
        const url = new URL(parsed.data.upload_url);
        if (url.protocol !== "https:") {
            throw new CanvasError(502, "Canvas returned a non-HTTPS upload_url.");
        }
        return {
            upload_url: parsed.data.upload_url,
            upload_params: Object.fromEntries(
                Object.entries(parsed.data.upload_params).map(([k, v]) => [k, String(v)]),
            ),
            file_param: parsed.data.file_param ?? "file",
        };
    }

    /**
     * Runs all three upload steps and returns the confirmed Canvas file.
     * Storage may answer 201 with the file JSON or 3xx to a Canvas confirm URL.
     */
    async uploadFile(initPath: string, file: UploadFile, opts: UploadOptions = {}): Promise<UploadedFile> {
        const slot = await this.requestUploadSlot(
            initPath,
            {
                name: file.name,
                size: file.bytes.byteLength,
                ...(file.contentType ? { contentType: file.contentType } : {}),
            },
            opts,
        );

        // the signed params must be sent unchanged with the file field last
        const form = new FormData();
        for (const [key, value] of Object.entries(slot.upload_params)) form.append(key, value);
        form.append(
            slot.file_param,
            new Blob([file.bytes], file.contentType ? { type: file.contentType } : {}),
            file.name,
        );

        // no bearer token here: upload_url is often a third-party storage host
        const res = await this.fetchImpl(slot.upload_url, {
            method: "POST",
            body: form,
            redirect: "manual",
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });

        const uploaded = await this.confirmUpload(res, slot.upload_url);
        if (uploaded.size !== undefined && uploaded.size !== file.bytes.byteLength) {
            throw new CanvasError(
                502,
                `Canvas recorded file ${uploaded.id} as ${uploaded.size} bytes but ${file.bytes.byteLength} were uploaded.`,
            );
        }
        return uploaded;
    }

    /**
     * Step 3 for a client that posted the bytes itself: GET the Canvas confirm
     * URL from the storage redirect's Location header.
     */
    async confirmUploadLocation(location: string): Promise<UploadedFile> {
        const res = await this.requestAbsolute(location, "upload confirmation");
        return parseUploadedFile(await readJsonOrNull<unknown>(res));
    }

    private async confirmUpload(res: Response, uploadUrl: string): Promise<UploadedFile> {
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400) {
            await res.body?.cancel();
            if (!location) throw new CanvasError(502, "Canvas upload redirect had no Location header.");
            return this.confirmUploadLocation(new URL(location, uploadUrl).toString());
        }
        if (!res.ok) {
            // storage error bodies can echo signed fields, so keep them out of the message
            await res.body?.cancel();
            throw new CanvasError(res.status, `Canvas file upload to storage failed with HTTP ${res.status}.`);
        }
        const body = await readJsonOrNull<unknown>(res).catch(() => null);
        if (body && typeof body === "object" && "id" in body) return parseUploadedFile(body);
        if (location) return this.confirmUploadLocation(new URL(location, uploadUrl).toString());
        throw new CanvasError(502, "Canvas upload succeeded but returned neither file JSON nor a Location.");
    }

    async *getPaginated<T>(path: string, query?: Query): AsyncIterable<T[]> {
        let res = await this.request(path, { method: "GET", ...(query !== undefined ? { query } : {}) });
        const visited = new Set([this.buildUrl(path, query)]);
        while (true) {
            const batch = await readJsonOrNull<T[]>(res);
            if (batch === null) return;
            if (!Array.isArray(batch)) {
                throw new CanvasError(502, "Canvas pagination response must be an array.");
            }
            yield batch;
            const next = parseNextLink(res.headers.get("link"));
            if (!next) return;
            if (visited.has(next)) {
                throw new CanvasError(502, "Canvas pagination link repeats a previous page.");
            }
            visited.add(next);
            res = await this.requestAbsolute(next, "pagination link");
        }
    }

    async collectPaginated<T>(path: string, query?: Query): Promise<T[]> {
        const all: T[] = [];
        for await (const batch of this.getPaginated<T>(path, query)) all.push(...batch);
        return all;
    }

    private async requestAbsolute(url: string, label: string): Promise<Response> {
        this.assertCanvasOrigin(url, label);
        const headers = new Headers({ authorization: `Bearer ${this.token}`, accept: CANVAS_ACCEPT_HEADER });
        const init = (): RequestInit => ({ method: "GET", headers, signal: AbortSignal.timeout(this.timeoutMs) });
        const res = await this.fetchWithReadRetries(url, init);
        if (!res.ok) {
            throw await this.toCanvasError(res, `${label} fetch`);
        }
        return res;
    }

    private async request(path: string, opts: { method: string; query?: Query; body?: unknown }): Promise<Response> {
        const url = this.buildUrl(path, opts.query);
        const headers = new Headers({
            authorization: `Bearer ${this.token}`,
            accept: CANVAS_ACCEPT_HEADER,
        });
        if (opts.body !== undefined) headers.set("content-type", "application/json");

        const init = (): RequestInit => ({
            method: opts.method,
            headers,
            signal: AbortSignal.timeout(this.timeoutMs),
            ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        });

        const res = opts.method === "GET"
            ? await this.fetchWithReadRetries(url, init)
            : await this.fetchImpl(url, init());

        if (!res.ok) {
            throw await this.toCanvasError(res, `${opts.method} ${path}`);
        }
        return res;
    }

    private async fetchWithReadRetries(url: string, init: () => RequestInit): Promise<Response> {
        for (let attempt = 0; ; attempt += 1) {
            const res = await this.fetchImpl(url, init());
            if (!isRetryableReadResponse(res.status) || attempt >= MAX_READ_RETRIES) return res;
            await sleep(retryDelayMs(res, attempt));
        }
    }

    // the bearer token must only ever travel to the configured Canvas origin
    private assertCanvasOrigin(url: string, label: string): void {
        let next: URL;
        try {
            next = new URL(url);
        } catch {
            throw new CanvasError(502, `Canvas ${label} is invalid.`);
        }
        if (next.origin !== this.baseOrigin) {
            throw new CanvasError(502, `Canvas ${label} points outside the configured Canvas origin.`);
        }
    }

    private async toCanvasError(res: Response, operation: string): Promise<CanvasError> {
        const body = await safeBody(res);
        const canvasMessage = extractCanvasMessage(body) ?? (res.statusText || `HTTP ${res.status}`);
        return new CanvasError(res.status, `Canvas ${operation} failed: ${canvasMessage}`, { body });
    }

    private buildUrl(path: string, query?: Query): string {
        const url = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v === undefined || v === null) continue;
                if (Array.isArray(v)) {
                    for (const item of v) url.searchParams.append(`${k}[]`, String(item));
                } else {
                    url.searchParams.set(k, String(v));
                }
            }
        }
        return url.toString();
    }
}

function isRetryableReadResponse(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(res: Response, attempt: number): number {
    const retryAfter = retryAfterMs(res.headers.get("retry-after"));
    if (retryAfter !== undefined) return retryAfter;
    return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function retryAfterMs(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
    }
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return undefined;
    return Math.min(Math.max(timestamp - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

function parseUploadedFile(body: unknown): UploadedFile {
    const parsed = uploadedFileSchema.safeParse(body);
    if (!parsed.success) throw new CanvasError(502, "Canvas upload confirmation did not include a file id.");
    const { id, display_name, filename, size, upload_status } = parsed.data;
    const contentType = parsed.data["content-type"];
    return {
        id,
        ...(display_name !== undefined ? { display_name } : {}),
        ...(filename !== undefined ? { filename } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(contentType !== undefined ? { "content-type": contentType } : {}),
        ...(upload_status !== undefined ? { upload_status } : {}),
    };
}

async function readJsonOrNull<T>(res: Response): Promise<T | null> {
    if (res.status === 204 || res.status === 205) return null;
    const text = await res.text();
    if (text.trim().length === 0) return null;
    return JSON.parse(text) as T;
}

async function safeBody(res: Response): Promise<unknown> {
    try {
        const text = await res.text();
        if (text.trim().length === 0) return undefined;
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    } catch {
        return undefined;
    }
}

function extractCanvasMessage(body: unknown): string | undefined {
    return findCanvasMessage(body);
}

function findCanvasMessage(value: unknown): string | undefined {
    if (typeof value === "string") return value.trim() || undefined;
    if (!value || typeof value !== "object") return undefined;

    if (Array.isArray(value)) {
        for (const item of value) {
            const message = findCanvasMessage(item);
            if (message) return message;
        }
        return undefined;
    }

    const record = value as Record<string, unknown>;
    for (const key of ["message", "error"]) {
        const message = findCanvasMessage(record[key]);
        if (message) return message;
    }
    for (const nested of Object.values(record)) {
        const message = findCanvasMessage(nested);
        if (message) return message;
    }
    return undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
