# canvas-mcp

An MCP server for Canvas LMS, written in TypeScript. One server, the whole
Canvas REST surface — built to be useful for students, teachers, academic
staff, and administrators alike. Default build exposes the read-heavy
student-safe subset. Instructor and admin tools live in the same source
files, one uncomment away, so you pick your surface by uncommenting what
you want rather than installing a different package.

The project started as a union of the twelve existing open-source Canvas
MCP servers — all MIT or ISC licensed — normalised, deduped, and merged
into a single maintainable codebase. `ATTRIBUTION.md` names every repo
the design borrows from; full credit goes to their authors.

## Scope

Canvas has a big API. This server aims to expose the useful parts of it in
a way that makes sense to both a language model and a human. Fifteen Canvas
domains are covered:

courses, assignments, submissions, grades, modules, pages, calendar,
announcements, discussions, files, messages, notifications, profile,
quizzes, rubrics.

Each domain file in `src/tools/` holds the full set of tools for that area
— reads, writes, deletes, everything. By default only the student-safe
reads are registered; the instructor- and admin-level tools (creating
courses, grading submissions, posting announcements, managing enrolments,
authoring quizzes, etc.) sit in a `/* ... */` block at the bottom of each
file marked `ADMIN / EDUCATOR TOOLS`. Uncomment what you need.

There's no feature flag or env toggle for this on purpose. Turning on
write access to someone's institution should be a deliberate, visible code
change — one you can review and commit.

## Current numbers

- 63 tools registered in the default student build.
- ~70 admin/educator tools commented out in-file, ready to enable.
- ~130 tools total across the codebase.

`TOOL_MANIFEST.md` has the full per-tool breakdown: names, endpoints,
inputs, source repos.

## Getting it running

```bash
cp .env.example .env
# fill in CANVAS_API_TOKEN and CANVAS_DOMAIN
npm install
npm run dev     # watch mode
# or
npm run build && npm start
```

Requires Node 22+.

### Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CANVAS_API_TOKEN` | yes | — | Canvas user API token. Generate one under Account → Settings → Approved Integrations. |
| `CANVAS_DOMAIN` | yes | — | Your institution's Canvas host, no scheme. e.g. `universityofgalway.instructure.com`. |
| `PORT` | no | `3001` | HTTP port. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error`. |

## Transport

Streamable-http — the current MCP transport standard. Same code path for
local dev and anything you deploy it behind. `GET /health` returns
`{"ok": true}` for load-balancer probes; MCP traffic is on the same port
at the root path, per the streamable-http spec.

Example client config:

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

Two-stage build, distroless runtime, runs as non-root. The image has no
shell.

## Deployment

Nothing about the server assumes any particular host. It's a node process
listening on a port. Run it wherever you run containers or long-lived
processes — Fargate, Cloud Run, Fly, a bare VM, Lambda with a
streamable-http adapter. Whatever you pick, source the Canvas token from
a proper secret store rather than baking it into the image.

## Enabling instructor and admin tools

Each `src/tools/<domain>.ts` ends with a banner comment followed by a
`/* ... */` block containing the admin and educator tools for that
domain. To enable, for example, announcement posting:

1. Open `src/tools/announcements.ts`.
2. Scroll to the `ADMIN / EDUCATOR TOOLS` banner.
3. Remove the surrounding `/*` and `*/` (or uncomment the specific tools
   you want — each is an object in the array).
4. Rebuild.

The tools are fully implemented — schema, handler, endpoint — they're
just not registered by default. `TOOL_MANIFEST.md` lists every admin/
educator tool per domain so you can see what's available without reading
source.

## Testing

Unit tests run against a mocked fetch:

```bash
npm test
npm run typecheck
```

For live-fire verification against a real Canvas instance,
`scripts/verify-tools.mjs` walks every active tool, discovering IDs as it
goes and logging every call:

```bash
CANVAS_API_TOKEN=... CANVAS_DOMAIN=... node scripts/verify-tools.mjs
```

It skips the three side-effect tools by default
(`mark_module_item_read`, `mark_module_item_done`,
`mark_conversation_read`); edit the `SIDE_EFFECT` set in the script if
you want to exercise them too.

## Contributing

PRs welcome. A tool addition should include:

- A zod input schema.
- A unit test against a mocked `CanvasClient`.
- An entry in `TOOL_MANIFEST.md` with endpoint, inputs, and source notes.
- A `canvas_<verb>_<noun>` name to keep the surface predictable.

If you find a duplicate of something the original sweep missed, open an
issue — I'd rather collapse than proliferate.

## Things deliberately left out for now

- Per-user OAuth / multi-tenant auth (single token per deployment).
- Response caching.
- MCP prompts and resources (only tools are exposed).
- stdio transport — streamable-http handles local and remote use.

All of the above are reasonable future additions; none are blocking for
the current use cases.

## License

MIT. See `LICENSE`.
