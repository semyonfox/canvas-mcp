# canvas-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified TypeScript MCP server for Canvas LMS that consolidates the best tools from twelve open-source Canvas MCP servers, student-facing by default with admin/educator tools commented out for selective enablement.

**Architecture:** Single Node/TS process exposing MCP tools over streamable-http. One `CanvasClient` (fetch wrapper with pagination and error mapping). Tools grouped by Canvas resource domain, one file each, aggregated and registered from `tools/index.ts`. Strict zod validation at every boundary.

**Tech Stack:** TypeScript 5.5+, Node 22+, `@modelcontextprotocol/sdk`, `zod`, `vitest`, native `fetch`, Docker.

---

## File Structure

**Created:**
- `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `Dockerfile`
- `vitest.config.ts`
- `src/index.ts` — server bootstrap and transport wiring
- `src/config.ts` — zod-validated env loader
- `src/canvas/client.ts` — fetch wrapper with auth + error normalisation
- `src/canvas/pagination.ts` — Link-header paginator (async iterator)
- `src/canvas/types.ts` — Canvas REST response types used by tools
- `src/canvas/errors.ts` — `CanvasError` class
- `src/tools/index.ts` — aggregates tool arrays, registers with MCP server
- `src/tools/types.ts` — `ToolDef`, `ToolContext` types
- `src/tools/courses.ts` — reference domain implementation
- `src/tools/assignments.ts`, `submissions.ts`, `grades.ts`, `modules.ts`, `pages.ts`, `calendar.ts`, `announcements.ts`, `discussions.ts`, `files.ts`, `messages.ts`, `notifications.ts`, `profile.ts`, `quizzes.ts`, `rubrics.ts`
- `src/lib/formatting.ts` — shared response formatters
- `tests/canvas/client.test.ts`, `tests/canvas/pagination.test.ts`
- `tests/tools/courses.test.ts` (pattern for other domains)
- `ATTRIBUTION.md`, `TOOL_MANIFEST.md`

**Modified:**
- `README.md` — add setup/run/deploy sections

---

## Task 1: Scaffold project

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "canvas-mcp",
  "version": "0.1.0",
  "description": "Unified MCP server for Canvas LMS",
  "type": "module",
  "bin": {
    "canvas-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=22" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests", "reference"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
*.log
reference/
```

Note: `reference/` is already gitignored in the repo; keep it excluded here too for safety.

- [ ] **Step 5: Create `.env.example`**

```
CANVAS_API_TOKEN=
CANVAS_DOMAIN=universityofgalway.instructure.com
PORT=3001
LOG_LEVEL=info
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: clean install, `node_modules/` populated, `package-lock.json` created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "scaffold project (package.json, tsconfig, vitest, env template)"
```

---

## Task 2: Config loader with validation

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses valid env", () => {
    const cfg = loadConfig({
      CANVAS_API_TOKEN: "tok",
      CANVAS_DOMAIN: "example.instructure.com",
      PORT: "4000",
      LOG_LEVEL: "debug",
    });
    expect(cfg.canvasApiToken).toBe("tok");
    expect(cfg.canvasDomain).toBe("example.instructure.com");
    expect(cfg.port).toBe(4000);
    expect(cfg.logLevel).toBe("debug");
  });

  it("defaults port and log level", () => {
    const cfg = loadConfig({
      CANVAS_API_TOKEN: "tok",
      CANVAS_DOMAIN: "example.instructure.com",
    });
    expect(cfg.port).toBe(3001);
    expect(cfg.logLevel).toBe("info");
  });

  it("rejects missing token", () => {
    expect(() =>
      loadConfig({ CANVAS_DOMAIN: "example.instructure.com" }),
    ).toThrow(/CANVAS_API_TOKEN/);
  });

  it("strips scheme from domain", () => {
    const cfg = loadConfig({
      CANVAS_API_TOKEN: "tok",
      CANVAS_DOMAIN: "https://example.instructure.com/",
    });
    expect(cfg.canvasDomain).toBe("example.instructure.com");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- config`
Expected: module-not-found for `../src/config.js`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  CANVAS_API_TOKEN: z.string().min(1),
  CANVAS_DOMAIN: z.string().min(1),
  PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : 3001))
    .pipe(z.number().int().positive()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface Config {
  canvasApiToken: string;
  canvasDomain: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  const domain = parsed.CANVAS_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    canvasApiToken: parsed.CANVAS_API_TOKEN,
    canvasDomain: domain,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
  };
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- config`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "add zod-validated config loader"
```

---

## Task 3: CanvasError and client core (GET)

**Files:**
- Create: `src/canvas/errors.ts`, `src/canvas/client.ts`
- Test: `tests/canvas/client.test.ts`

- [ ] **Step 1: Implement `src/canvas/errors.ts`**

```ts
export class CanvasError extends Error {
  readonly status: number;
  readonly canvasCode: string | undefined;
  readonly body: unknown;

  constructor(status: number, message: string, opts: { canvasCode?: string; body?: unknown } = {}) {
    super(message);
    this.name = "CanvasError";
    this.status = status;
    this.canvasCode = opts.canvasCode;
    this.body = opts.body;
  }
}
```

- [ ] **Step 2: Write the failing test for `CanvasClient.get`**

```ts
// tests/canvas/client.test.ts
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

  it("retries once on 5xx", async () => {
    const fetch = mockFetch([
      { status: 502, body: {} },
      { status: 200, body: { ok: true } },
    ]);
    const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
    const result = await client.get<{ ok: boolean }>("/api/v1/x");
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401", async () => {
    const fetch = mockFetch([{ status: 401, body: { errors: [{ message: "bad token" }] } }]);
    const client = new CanvasClient({ domain: "x.instructure.com", token: "tok", fetch });
    await expect(client.get("/api/v1/self")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run: `npm test -- canvas/client`
Expected: module-not-found.

- [ ] **Step 4: Implement `src/canvas/client.ts`**

```ts
import { CanvasError } from "./errors.js";

export type FetchLike = typeof fetch;

export interface CanvasClientOptions {
  domain: string;
  token: string;
  fetch?: FetchLike;
}

type QueryValue = string | number | boolean | undefined | null | Array<string | number | boolean>;
export type Query = Record<string, QueryValue>;

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: CanvasClientOptions) {
    this.baseUrl = `https://${opts.domain}`;
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async get<T>(path: string, query?: Query): Promise<T> {
    const res = await this.request(path, { method: "GET", query });
    return (await res.json()) as T;
  }

  async getRaw(path: string, query?: Query): Promise<Response> {
    return this.request(path, { method: "GET", query });
  }

  private async request(path: string, opts: { method: string; query?: Query; body?: unknown }): Promise<Response> {
    const url = this.buildUrl(path, opts.query);
    const headers = new Headers({
      authorization: `Bearer ${this.token}`,
      accept: "application/json",
    });
    if (opts.body !== undefined) headers.set("content-type", "application/json");

    const init: RequestInit = {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    };

    let res = await this.fetchImpl(url, init);
    if (res.status >= 500) {
      await sleep(200 + Math.random() * 200);
      res = await this.fetchImpl(url, init);
    }

    if (!res.ok) {
      const body = await safeJson(res);
      const canvasMessage = extractCanvasMessage(body) ?? res.statusText;
      throw new CanvasError(res.status, `Canvas ${opts.method} ${path} failed: ${canvasMessage}`, { body });
    }
    return res;
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

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function extractCanvasMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { errors?: unknown; message?: unknown };
  if (Array.isArray(b.errors) && b.errors.length > 0) {
    const first = b.errors[0];
    if (first && typeof first === "object" && "message" in first) {
      return String((first as { message: unknown }).message);
    }
  }
  if (typeof b.message === "string") return b.message;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `npm test -- canvas/client`
Expected: all five tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/errors.ts src/canvas/client.ts tests/canvas/client.test.ts
git commit -m "add CanvasClient.get with error mapping and 5xx retry"
```

---

## Task 4: Canvas pagination

**Files:**
- Create: `src/canvas/pagination.ts`
- Modify: `src/canvas/client.ts` (add `getPaginated`)
- Test: `tests/canvas/pagination.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/canvas/pagination.test.ts
import { describe, it, expect, vi } from "vitest";
import { CanvasClient } from "../../src/canvas/client.js";

function page(items: unknown[], nextUrl?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (nextUrl) {
    headers.link = `<${nextUrl}>; rel="next", <https://x.instructure.com/api/v1/first>; rel="first"`;
  }
  return new Response(JSON.stringify(items), { status: 200, headers });
}

describe("CanvasClient.getPaginated", () => {
  it("follows Link rel=next until exhausted", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([1, 2], "https://x.instructure.com/api/v1/things?page=2"))
      .mockResolvedValueOnce(page([3, 4], "https://x.instructure.com/api/v1/things?page=3"))
      .mockResolvedValueOnce(page([5]));

    const client = new CanvasClient({ domain: "x.instructure.com", token: "t", fetch });
    const out: number[] = [];
    for await (const batch of client.getPaginated<number>("/api/v1/things")) {
      out.push(...batch);
    }
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("collectPaginated returns flat array", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(["a"], "https://x.instructure.com/api/v1/y?page=2"))
      .mockResolvedValueOnce(page(["b"]));
    const client = new CanvasClient({ domain: "x.instructure.com", token: "t", fetch });
    const all = await client.collectPaginated<string>("/api/v1/y");
    expect(all).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- pagination`
Expected: `client.getPaginated is not a function`.

- [ ] **Step 3: Implement `src/canvas/pagination.ts`**

```ts
export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === "next") return match[1] ?? null;
  }
  return null;
}
```

- [ ] **Step 4: Extend `src/canvas/client.ts` with pagination methods**

Add to `CanvasClient`:

```ts
import { parseNextLink } from "./pagination.js";

// ... inside the class, below getRaw:

async *getPaginated<T>(path: string, query?: Query): AsyncIterable<T[]> {
  let res = await this.request(path, { method: "GET", query });
  while (true) {
    const batch = (await res.json()) as T[];
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
  const headers = new Headers({ authorization: `Bearer ${this.token}`, accept: "application/json" });
  let res = await this.fetchImpl(url, { method: "GET", headers });
  if (res.status >= 500) {
    await new Promise((r) => setTimeout(r, 200));
    res = await this.fetchImpl(url, { method: "GET", headers });
  }
  if (!res.ok) {
    const { CanvasError } = await import("./errors.js");
    throw new CanvasError(res.status, `Canvas pagination fetch failed: ${res.statusText}`);
  }
  return res;
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `npm test -- pagination`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/pagination.ts src/canvas/client.ts tests/canvas/pagination.test.ts
git commit -m "add Link-header pagination (async iterator + collect helper)"
```

---

## Task 5: Tool types and registration plumbing

**Files:**
- Create: `src/tools/types.ts`, `src/tools/index.ts`

- [ ] **Step 1: Create `src/tools/types.ts`**

```ts
import type { z, ZodTypeAny } from "zod";
import type { CanvasClient } from "../canvas/client.js";

export interface ToolContext {
  canvas: CanvasClient;
}

export interface ToolDef<Schema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: Schema;
  handler: (args: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}
```

- [ ] **Step 2: Create `src/tools/index.ts` (stub — domains plugged in later)**

```ts
import type { ToolDef } from "./types.js";
import { courseTools } from "./courses.js";

export const allTools: ToolDef[] = [
  ...courseTools,
  // assignments, submissions, grades, modules, pages, calendar,
  // announcements, discussions, files, messages, notifications,
  // profile, quizzes, rubrics — added per-domain in later tasks.
];
```

Note: this will fail to compile until Task 6 creates `courses.ts`. That's intentional — Task 6 is the next commit.

- [ ] **Step 3: Do not commit yet** — combined commit with Task 6.

---

## Task 6: Courses domain (reference implementation)

**Files:**
- Create: `src/tools/courses.ts`
- Test: `tests/tools/courses.test.ts`

This is the pattern every other domain follows. Three tools minimum: list courses, get course, list sections. Admin/educator tools (create/update/delete course) live in the commented block.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tools/courses.test.ts
import { describe, it, expect, vi } from "vitest";
import { courseTools } from "../../src/tools/courses.js";
import type { CanvasClient } from "../../src/canvas/client.js";

function findTool(name: string) {
  const tool = courseTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function fakeCanvas(overrides: Partial<CanvasClient>): CanvasClient {
  return overrides as unknown as CanvasClient;
}

describe("course tools", () => {
  it("canvas_list_courses calls collectPaginated with filters", async () => {
    const collect = vi.fn().mockResolvedValue([{ id: 1, name: "Intro" }]);
    const tool = findTool("canvas_list_courses");
    const result = await tool.handler(
      { enrollment_state: "active" },
      { canvas: fakeCanvas({ collectPaginated: collect }) },
    );
    expect(collect).toHaveBeenCalledWith("/api/v1/courses", expect.objectContaining({
      enrollment_state: "active",
      per_page: 100,
    }));
    expect(result.content[0].text).toContain("Intro");
  });

  it("canvas_get_course hits the single-course endpoint", async () => {
    const get = vi.fn().mockResolvedValue({ id: 42, name: "CT216" });
    const tool = findTool("canvas_get_course");
    const result = await tool.handler({ course_id: 42 }, { canvas: fakeCanvas({ get }) });
    expect(get).toHaveBeenCalledWith("/api/v1/courses/42", expect.any(Object));
    expect(result.content[0].text).toContain("CT216");
  });

  it("canvas_list_sections returns sections for a course", async () => {
    const collect = vi.fn().mockResolvedValue([{ id: 7, name: "Section A" }]);
    const tool = findTool("canvas_list_sections");
    const result = await tool.handler({ course_id: 42 }, { canvas: fakeCanvas({ collectPaginated: collect }) });
    expect(collect).toHaveBeenCalledWith("/api/v1/courses/42/sections", expect.any(Object));
    expect(result.content[0].text).toContain("Section A");
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- tools/courses`
Expected: module-not-found.

- [ ] **Step 3: Implement `src/tools/courses.ts`**

```ts
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult } from "./types.js";

export const courseTools: ToolDef[] = [
  {
    name: "canvas_list_courses",
    description:
      "List courses for the authenticated user. Use enrollment_state to filter (active/completed/invited).",
    inputSchema: z.object({
      enrollment_state: z.enum(["active", "invited_or_pending", "completed"]).optional(),
      include: z.array(z.string()).optional(),
    }),
    handler: async (args, { canvas }) => {
      const courses = await canvas.collectPaginated("/api/v1/courses", {
        per_page: 100,
        ...(args.enrollment_state ? { enrollment_state: args.enrollment_state } : {}),
        ...(args.include ? { include: args.include } : {}),
      });
      return jsonResult(courses);
    },
  },
  {
    name: "canvas_get_course",
    description: "Get full details for a single course by ID.",
    inputSchema: z.object({
      course_id: z.number().int().positive(),
      include: z.array(z.string()).optional(),
    }),
    handler: async (args, { canvas }) => {
      const course = await canvas.get(`/api/v1/courses/${args.course_id}`, {
        ...(args.include ? { include: args.include } : {}),
      });
      return jsonResult(course);
    },
  },
  {
    name: "canvas_list_sections",
    description: "List sections for a course.",
    inputSchema: z.object({
      course_id: z.number().int().positive(),
    }),
    handler: async (args, { canvas }) => {
      const sections = await canvas.collectPaginated(`/api/v1/courses/${args.course_id}/sections`, {
        per_page: 100,
      });
      return jsonResult(sections);
    },
  },

  // ============================================================
  // ADMIN / EDUCATOR TOOLS — commented out for student-only build.
  // Uncomment to enable course creation, updates, and deletion.
  // ============================================================
  /*
  {
    name: "canvas_create_course",
    description: "Create a new course in an account. Requires admin permissions.",
    inputSchema: z.object({
      account_id: z.number().int().positive(),
      name: z.string(),
      course_code: z.string().optional(),
    }),
    handler: async (args, { canvas }) => {
      const course = await canvas.post(`/api/v1/accounts/${args.account_id}/courses`, {
        course: { name: args.name, course_code: args.course_code },
      });
      return jsonResult(course);
    },
  },
  */
];
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- tools/courses`
Expected: three tests pass.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors. `src/tools/index.ts` now compiles since `courses.ts` exists.

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/tools/index.ts src/tools/courses.ts tests/tools/courses.test.ts
git commit -m "add tool plumbing and courses domain (reference implementation)"
```

---

## Task 7: MCP server bootstrap with streamable-http

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Implement `src/index.ts`**

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { zodToJsonSchema } from "zod-to-json-schema";
import { loadConfig } from "./config.js";
import { CanvasClient } from "./canvas/client.js";
import { allTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

const cfg = loadConfig();
const canvas = new CanvasClient({ domain: cfg.canvasDomain, token: cfg.canvasApiToken });
const ctx: ToolContext = { canvas };

const server = new Server(
  { name: "canvas-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema, { target: "openApi3" }) as Record<string, unknown>,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = allTools.find((t) => t.name === req.params.name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
  }
  const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid input: ${parsed.error.message}` }], isError: true };
  }
  try {
    return await tool.handler(parsed.data, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

const http = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  await transport.handleRequest(req, res);
});

http.listen(cfg.port, () => {
  console.log(JSON.stringify({ msg: "canvas-mcp listening", port: cfg.port, domain: cfg.canvasDomain }));
});
```

- [ ] **Step 2: Add `zod-to-json-schema` dependency**

Run: `npm install zod-to-json-schema`
Expected: package added to `package.json` dependencies.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors; `dist/` populated.

- [ ] **Step 4: Smoke-start and hit health endpoint**

Run in one terminal:
```bash
CANVAS_API_TOKEN=dummy CANVAS_DOMAIN=example.instructure.com npm start &
SERVER_PID=$!
sleep 1
curl -s localhost:3001/health
kill $SERVER_PID
```
Expected: `{"ok":true}`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts package.json package-lock.json
git commit -m "add MCP server bootstrap with streamable-http transport and /health"
```

---

## Task 8: Cross-reference sweep and tool manifest

**Files:**
- Create: `TOOL_MANIFEST.md`, `ATTRIBUTION.md`

This task produces the locked list of tools to implement per domain. The manifest is the source of truth for Tasks 9–21.

- [ ] **Step 1: Sweep reference repos**

For each `reference/*/` repo, list every student-facing tool it exposes (grep for tool registrations, e.g. `server.tool(`, `@mcp.tool`, `tools:` config, or similar). For each tool record: source repo, tool name, what Canvas endpoint(s) it calls, a one-line description.

Focus on the five primary sources named in `CLAUDE.md` first; the secondary sources supplement.

- [ ] **Step 2: Build the unified table**

Group by the 15 domains listed in the spec's file structure. For each domain:
1. Dedupe tools that do the same thing.
2. For each unique tool, pick the **most versatile variant** (widest param coverage, supports pagination, handles the Canvas `include[]` param where relevant).
3. Assign a normalised name prefixed with `canvas_` (snake_case).
4. Record which source repo(s) influenced the final version.

Admin/educator tools are included in the table, marked `ADMIN` or `EDUCATOR`, and will live in the commented blocks of each domain file.

- [ ] **Step 3: Write `TOOL_MANIFEST.md`**

Format per domain:

```markdown
## courses

| Tool | Endpoint | Inputs | Sources | Notes |
|------|----------|--------|---------|-------|
| canvas_list_courses | GET /api/v1/courses | enrollment_state?, include? | vishalsachdev, r-huijts, DMontgomery40 | paginated |
| canvas_get_course | GET /api/v1/courses/:id | course_id, include? | r-huijts | |
| canvas_list_sections | GET /api/v1/courses/:id/sections | course_id | DMontgomery40 | paginated |

### Admin / educator (commented out in code)

| Tool | Endpoint | Marker |
|------|----------|--------|
| canvas_create_course | POST /api/v1/accounts/:id/courses | ADMIN |
| canvas_update_course | PUT /api/v1/courses/:id | ADMIN |
| canvas_delete_course | DELETE /api/v1/courses/:id | ADMIN |
```

Repeat for every domain.

- [ ] **Step 4: Write `ATTRIBUTION.md`**

```markdown
# Attribution

canvas-mcp merges ideas and tool designs from the following open-source Canvas MCP servers. All are MIT or ISC licensed. Deep thanks to every author — this project stands on their work.

## Source repositories

| Repo | Author | License | Link |
|------|--------|---------|------|
| canvas-mcp | vishalsachdev | MIT | https://github.com/vishalsachdev/canvas-mcp |
| mcp-canvas-lms | DMontgomery40 | MIT | https://github.com/DMontgomery40/mcp-canvas-lms |
| canvas-mcp | r-huijts | MIT | https://github.com/r-huijts/canvas-mcp |
| canvas-lms-mcp | mtgibbs | MIT | https://github.com/mtgibbs/canvas-lms-mcp |
| canvas-lms-mcp | ahnopologetic | MIT | https://github.com/ahnopologetic/canvas-lms-mcp |
| canvas-mcp | aryankeluskar | ISC | https://github.com/aryankeluskar/canvas-mcp |
| canvas-mcp | a-ariff | MIT | https://github.com/a-ariff/canvas-mcp |
| canvas-lms-mcp | sweeden-ttu | MIT | https://github.com/sweeden-ttu/canvas-lms-mcp |
| canvas-student-mcp | Jon-Vii | MIT | https://github.com/Jon-Vii/canvas-student-mcp |
| Canvas-MCP-server | Kuria-Mbatia | MIT | https://github.com/Kuria-Mbatia/Canvas-MCP-server |
| mcp-server-canvas | enkhbold470 | MIT | https://github.com/enkhbold470/mcp-server-canvas |
| poke-canvas-mcp | Shashwatpog | MIT | https://github.com/Shashwatpog/poke-canvas-mcp |

## Per-domain sources

(Filled in from TOOL_MANIFEST.md after the sweep. Each domain lists which repos contributed the bulk of its tool designs.)
```

- [ ] **Step 5: Commit**

```bash
git add TOOL_MANIFEST.md ATTRIBUTION.md
git commit -m "add tool manifest and attribution after cross-reference sweep"
```

---

## Tasks 9–22: Per-domain implementations

Each of the remaining 14 domains is its own task. The pattern is identical to Task 6. For each domain:

**Files (per domain, substituting `<domain>`):**
- Create: `src/tools/<domain>.ts`
- Test: `tests/tools/<domain>.test.ts`
- Modify: `src/tools/index.ts` — add `...<domain>Tools` to `allTools`

**Domains and their task numbers:**

- Task 9: `assignments` — list, get, list submissions for assignment
- Task 10: `submissions` — get submission, list user submissions, submission history
- Task 11: `grades` — course grades, rubric statistics
- Task 12: `modules` — list modules, list module items, get module item
- Task 13: `pages` — list pages, get page content, list page revisions
- Task 14: `calendar` — list calendar events, list planner items
- Task 15: `announcements` — list announcements (EDUCATOR: post announcement)
- Task 16: `discussions` — list topics, get topic with entries, list entries
- Task 17: `files` — list files, get file metadata/URL, list folders
- Task 18: `messages` — list conversations, get conversation, list unread
- Task 19: `notifications` — list notifications, list account notifications
- Task 20: `profile` — get self profile, get user profile by id
- Task 21: `quizzes` — list quizzes, get quiz (EDUCATOR: create/update/delete)
- Task 22: `rubrics` — list rubrics, get rubric

**Per-domain step template:**

- [ ] **Step 1: Read `TOOL_MANIFEST.md` for the domain** to confirm which tools to implement, their endpoints, and input shapes.

- [ ] **Step 2: Write failing tests** for each active tool in the domain. Pattern from `tests/tools/courses.test.ts`: mock `CanvasClient.get` / `collectPaginated`, assert the tool calls the right endpoint with the right params, assert the text response includes key fields.

- [ ] **Step 3: Run tests — expect failure** (module-not-found).

- [ ] **Step 4: Implement `src/tools/<domain>.ts`** following the exact shape of `src/tools/courses.ts`:
  - Named export `<domain>Tools: ToolDef[]`
  - Each tool: `canvas_<verb>_<noun>` name, zod input schema, handler using `canvas.get` / `canvas.collectPaginated`, return via `jsonResult`.
  - Admin/educator tools in a single commented block at the bottom marked `// ADMIN:` or `// EDUCATOR:` per the manifest.

- [ ] **Step 5: Register in `src/tools/index.ts`**: import `<domain>Tools` and spread into `allTools`.

- [ ] **Step 6: Run tests — expect pass**. Run `npm run typecheck`.

- [ ] **Step 7: Commit**: `git commit -m "add <domain> domain tools"`

Do not batch domains into one commit — one commit per domain keeps history clean and bisectable.

---

## Task 23: Dockerfile

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
dist
.env
.env.*
reference
docs
tests
*.log
.git
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production
EXPOSE 3001
USER nonroot
CMD ["dist/index.js"]
```

- [ ] **Step 3: Build the image locally**

Run: `docker build -t canvas-mcp:dev .`
Expected: image builds without errors.

- [ ] **Step 4: Smoke-run the container**

Run:
```bash
docker run --rm -d -p 3001:3001 \
  -e CANVAS_API_TOKEN=dummy \
  -e CANVAS_DOMAIN=example.instructure.com \
  --name canvas-mcp-smoke canvas-mcp:dev
sleep 2
curl -s localhost:3001/health
docker stop canvas-mcp-smoke
```
Expected: `{"ok":true}`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "add Docker build (distroless runtime, non-root)"
```

---

## Task 24: README and final polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`** to include:
  - What the server does (one paragraph)
  - Full tool list, grouped by domain, pulled from `TOOL_MANIFEST.md`
  - Setup (npm install, .env, npm run dev / npm start)
  - Docker build + run commands
  - Deployment pointers (Fargate / Lambda function URL) — one paragraph each, no code
  - How to enable admin/educator tools: "grep for `// ADMIN:` or `// EDUCATOR:` markers and uncomment the block in the relevant domain file"
  - Link to `ATTRIBUTION.md` with a one-sentence thanks

- [ ] **Step 2: Run full test suite and typecheck**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass, no type errors, build clean.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "document tool surface, setup, and deployment in README"
```

---

## Done

At this point the server has:
- All student-facing tools across 15 Canvas domains
- Admin/educator tools in commented blocks ready to uncomment
- Full unit coverage per domain
- Health endpoint, streamable-http transport, Docker build, deployment docs
- Attribution to all twelve source repos

Next natural step (out of scope for this plan): integration smoke tests against a real Canvas sandbox, CI pipeline, release tagging.
