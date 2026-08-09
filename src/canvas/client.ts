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
const CANVAS_ACCEPT_HEADER = "application/json+canvas-string-ids";
const MAX_READ_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 5_000;

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

    async *getPaginated<T>(path: string, query?: Query): AsyncIterable<T[]> {
        let res = await this.request(path, { method: "GET", ...(query !== undefined ? { query } : {}) });
        while (true) {
            const batch = await readJsonOrNull<T[]>(res);
            if (batch === null) return;
            yield batch;
            const next = parseNextLink(res.headers.get("link"));
            if (!next) return;
            res = await this.requestAbsolute(next);
        }
    }

    async collectPaginated<T>(path: string, query?: Query): Promise<T[]> {
        const all: T[] = [];
        for await (const batch of this.getPaginated<T>(path, query)) all.push(...batch);
        return all;
    }

    private async requestAbsolute(url: string): Promise<Response> {
        this.assertPaginationOrigin(url);
        const headers = new Headers({ authorization: `Bearer ${this.token}`, accept: CANVAS_ACCEPT_HEADER });
        const init = (): RequestInit => ({ method: "GET", headers, signal: AbortSignal.timeout(this.timeoutMs) });
        const res = await this.fetchWithReadRetries(url, init);
        if (!res.ok) {
            throw await this.toCanvasError(res, "pagination fetch");
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

    private assertPaginationOrigin(url: string): void {
        let next: URL;
        try {
            next = new URL(url);
        } catch {
            throw new CanvasError(502, "Canvas pagination link is invalid.");
        }
        if (next.origin !== this.baseOrigin) {
            throw new CanvasError(502, "Canvas pagination link points outside the configured Canvas origin.");
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
