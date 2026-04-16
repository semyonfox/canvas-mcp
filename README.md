# canvas-mcp

An MCP server for Canvas LMS, written in TypeScript. Gives any MCP-speaking
client (Claude Desktop, an in-house agent, whatever you've wired up) read
access to a student's Canvas account: courses, assignments, grades, modules,
pages, discussions, calendar, inbox, the lot.

I wrote it while building [OghmaNotes](https://oghmanotes.ie) because the
twelve existing open-source Canvas MCP servers were all half-overlapping,
half-abandoned, and none of them were the one I wanted to bet on. This is the
union of their good ideas, normalised, deduped, and shipped as a single
maintainable server. `ATTRIBUTION.md` lists every repo I borrowed from — all
MIT or ISC, full credit where it's due.

## What's in it

63 active student-facing tools across 15 Canvas domains. Each tool is a thin
wrapper over a Canvas REST endpoint with a zod-validated input schema. All the
admin/educator tools (creating courses, grading submissions, posting
announcements) are present in source but commented out — if you want to run
this as an instructor tool, grep for `ADMIN / EDUCATOR` and uncomment the
blocks you need. No feature flag, no env toggle; the fork point is a visible
code change on purpose.

Domains: courses, assignments, submissions, grades, modules, pages, calendar,
announcements, discussions, files, messages, notifications, profile, quizzes,
rubrics. `TOOL_MANIFEST.md` has the full per-tool list with endpoints, inputs,
and sources.

## Setup

```bash
cp .env.example .env
# fill in CANVAS_API_TOKEN and CANVAS_DOMAIN
npm install
npm run dev     # watch mode
# or
npm run build && npm start
```

Requires Node 22+.

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CANVAS_API_TOKEN` | yes | — | Canvas user API token. Generate one under Account → Settings → Approved Integrations. |
| `CANVAS_DOMAIN` | yes | — | Your institution's Canvas host, no scheme. e.g. `universityofgalway.instructure.com`. |
| `PORT` | no | `3001` | HTTP port. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`. |

## Transport

Streamable-http, the current MCP transport standard. One code path for local
dev and deployed prod — you hit the same HTTP server in both cases.

`GET /health` returns `{"ok": true}` for load balancers.

MCP traffic is on the same port, at the root path, per the streamable-http
spec. Typical client config:

```json
{
  "mcpServers": {
    "canvas": {
      "type": "http",
      "url": "http://localhost:3001"
    }
  }
}
```

## Docker

```bash
docker build -t canvas-mcp .
docker run --rm -p 3001:3001 \
  -e CANVAS_API_TOKEN=... \
  -e CANVAS_DOMAIN=... \
  canvas-mcp
```

Two-stage build, distroless runtime, non-root. Image is small and has no
shell.

## Deployment

On AWS I run it on Fargate as a long-lived service behind an ALB, token
sourced from Secrets Manager via an ECS secret, container health check
against `/health`. Lambda with a function URL works too if you wrap the
handler with a streamable-http adapter and don't mind cold-start latency on
the occasional call.

Nothing about the server assumes AWS — it's just a node process listening on
a port.

## Tests

```bash
npm test           # vitest, unit tests against a mocked fetch
npm run typecheck  # strict TS, exactOptionalPropertyTypes
```

There's also `scripts/verify-tools.mjs` — a live-fire verification driver that
iterates over every active tool with real Canvas data. It discovers IDs as it
goes (first course, first assignment, etc.), logs every call, and skips the
three side-effect tools (`mark_module_item_read`, `mark_module_item_done`,
`mark_conversation_read`) unless you edit the script. Useful after upgrading
the SDK or pointing at a new institution:

```bash
CANVAS_API_TOKEN=... CANVAS_DOMAIN=... node scripts/verify-tools.mjs
```

## Scope

Student-facing by default, read-heavy, no auth flow beyond a personal access
token. This is not trying to be a full Canvas admin console. If a tool you
want isn't in the active list, check the commented admin/educator blocks in
`src/tools/<domain>.ts` — it's probably there, waiting to be uncommented.

Things deliberately left out for v1: per-user OAuth, response caching, MCP
prompts/resources (only tools are exposed), CLI/stdio transport.

## Contributing

PRs welcome. Tool additions should include a zod schema, a unit test against
a mocked `CanvasClient`, and an entry in `TOOL_MANIFEST.md`. Keep tool names
in the `canvas_<verb>_<noun>` shape so the tool surface stays predictable.

If you find a duplicate of something I missed during the original sweep,
file an issue — I'd rather collapse than proliferate.

## License

MIT. See `LICENSE`.
