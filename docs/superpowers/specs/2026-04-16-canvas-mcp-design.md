# canvas-mcp — Unified TypeScript MCP Server for Canvas LMS

**Date:** 2026-04-16
**Status:** Approved

## Purpose

A single, maintainable TypeScript MCP server that exposes the Canvas LMS API as MCP tools. Consumed by OghmaNotes' AI chat agent as an external MCP service, and intended to be the reference implementation the Canvas-MCP community can converge on. Student-facing tools are active by default; admin/educator tools are present but commented out so forks can selectively re-enable them.

The project merges the best ideas from twelve existing open-source Canvas MCP servers (all MIT/ISC). Original authors are credited in a central `ATTRIBUTION.md`; no per-tool JSDoc citations.

## Non-Goals

- Not a drop-in replacement for any single reference repo — APIs/tool names are normalised.
- Not a Canvas admin console. Admin/educator tools ship disabled.
- No multi-tenant auth, no per-user token management. One token per deployment, pulled from env/Secrets Manager.
- No OghmaNotes-specific logic leaks into this server; it stays a generic Canvas MCP.

## Stack

- **Language:** TypeScript (strict mode), Node 22+
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Transport:** `streamable-http` only (modern MCP spec; localhost for dev, same binary in prod)
- **HTTP client:** native `fetch`
- **Validation:** `zod` for tool input schemas and env config
- **Package manager:** npm
- **Container:** Docker, intended for AWS Fargate or Lambda with function URL
- **Secrets:** Canvas token from env in dev, AWS Secrets Manager in prod (resolved at boot, cached in memory)

## Architecture

```
src/
  index.ts              # server bootstrap, transport wiring, tool registration
  config.ts             # zod-validated env (CANVAS_API_TOKEN, CANVAS_DOMAIN, PORT)
  canvas/
    client.ts           # fetch wrapper: auth, pagination (Link header), retries, error normalisation
    types.ts            # Canvas REST response types
    pagination.ts       # helper: async iterator over paginated endpoints
  tools/
    index.ts            # aggregates per-domain tool arrays, registers with MCP server
    courses.ts
    assignments.ts
    submissions.ts
    grades.ts
    modules.ts
    pages.ts
    calendar.ts
    announcements.ts
    discussions.ts
    files.ts
    messages.ts         # inbox / conversations
    notifications.ts
    profile.ts
    quizzes.ts
    rubrics.ts
  lib/
    formatting.ts       # shared response formatters (e.g. course summary, grade block)
ATTRIBUTION.md          # tool-domain → source-repo mapping
Dockerfile
.env.example
```

### Tool registration pattern

Each domain file exports a typed array of tool definitions:

```ts
export const courseTools: ToolDef[] = [
  {
    name: "canvas_list_courses",
    description: "...",
    inputSchema: z.object({ enrollment_state: z.enum([...]).optional() }),
    handler: async (args, ctx) => { ... },
  },
  // ADMIN: tools here, commented out
];
```

`tools/index.ts` flattens all domain arrays and registers them with the MCP server in one pass. `ctx` carries the Canvas client and logger — no module-level singletons, so tools stay testable.

Tool names are prefixed `canvas_` to avoid collisions when mounted alongside other MCP servers in the same client.

### Canvas client

- Single `CanvasClient` class, constructed once at boot from config
- Methods are thin: `get(path, query)`, `getPaginated(path, query)`, `post`, `put`, `delete`
- Pagination uses Canvas `Link` headers; `getPaginated` returns an async iterator, consumers `toArray()` or early-break
- Errors normalised to a `CanvasError` with status, Canvas error code, and message. Tool handlers surface these cleanly in MCP error responses.
- Rate limit handling: on 403 with Canvas `X-Rate-Limit-Remaining` near zero, back off and retry once.

### Admin/educator gating

Admin/educator tools live inside the relevant domain file, wrapped in a single commented block with a marker:

```ts
// ============================================================
// ADMIN / EDUCATOR TOOLS — commented out for student-only build.
// Uncomment this block to enable course creation, enrollment
// management, quiz authoring, announcement posting, etc.
// ============================================================
/*
  { name: "canvas_create_course", ... },
  { name: "canvas_update_assignment", ... },
*/
```

No build-time feature flag — the user wants the fork point to be a visible, deliberate code change.

## Tool surface

The union of the twelve reference repos, deduped and normalised. Estimated ~60-80 student-facing tools across the domains listed above. For each Canvas endpoint, we pick the **most versatile variant** across repos (best param coverage, pagination support, sane defaults). Duplicate/trivial tools are dropped.

The exact tool list is derived during implementation from a cross-reference sweep of `reference/*/` — locked into `ATTRIBUTION.md` as the source of truth once the sweep is done. Admin/educator equivalents are kept in-file but commented as described above.

## Config

```
CANVAS_API_TOKEN=   # required
CANVAS_DOMAIN=      # required, e.g. universityofgalway.instructure.com (no scheme)
PORT=3001           # optional, default 3001
LOG_LEVEL=info      # optional: debug|info|warn|error
```

`config.ts` validates at boot with zod and exits cleanly with a readable error if anything is missing.

## Error handling

- Canvas 4xx → tool returns a structured MCP error with HTTP status, Canvas code, and message
- Canvas 5xx → one retry with jittered backoff, then surface the error
- Network / timeout → one retry, then surface
- Auth failures (401) never retried — surface immediately

No silent fallbacks. If a tool fails, the LLM sees a real error and can recover.

## Testing

- **Unit:** `vitest`. Cover the Canvas client (pagination, error mapping, retry) and tool handlers (using a stubbed client).
- **Integration:** one smoke test per domain that hits a real Canvas sandbox when `CANVAS_API_TOKEN` is set, skipped otherwise. Not run in CI by default.
- **No end-to-end MCP transport tests** in v1 — the SDK handles transport; we trust it.

## Deployment

- `Dockerfile` — multi-stage build, distroless runtime, non-root user
- Intended targets: AWS Fargate service or Lambda with function URL and streamable-http adapter
- Health endpoint: `GET /health` → `200 {"ok":true}` for load-balancer checks
- Observability: structured JSON logs to stdout (CloudWatch picks them up); no metrics in v1

## Attribution

`ATTRIBUTION.md` at repo root:

- Lists all twelve source repos with author, license, and link
- Per-domain credit: which source repos influenced each domain file
- Thank-you note preserving the spirit of "standing on shoulders"

No per-file JSDoc citations. Source references in code comments only when a specific non-obvious quirk was borrowed (e.g. a Canvas API workaround).

## Out of scope for v1

- Per-user token passthrough / OAuth
- WebSocket transport (streamable-http covers streaming)
- Tool-level feature flags or env-driven gating
- Caching of Canvas responses
- Prompts or resources (MCP primitives other than tools) — can be added later
- CLI / stdio transport

## Build order

Implementation plan (next step) will cover:

1. Scaffold project (package.json, tsconfig, Dockerfile, env config, server bootstrap, health)
2. Canvas client + pagination + error mapping, with unit tests
3. Tool registration plumbing and one reference domain (`courses`) end to end
4. Cross-reference sweep across `reference/*/`, produce the locked tool list and `ATTRIBUTION.md`
5. Implement remaining domains, one at a time, each with its admin/educator block commented in place
6. Integration smoke tests against Canvas sandbox
7. Dockerfile polish, deployment README, release notes
