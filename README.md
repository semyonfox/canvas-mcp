# canvas-mcp

An MCP server for Canvas LMS, written in TypeScript. One server, the whole
Canvas REST surface — built to be useful for students, teachers, academic
staff, and administrators alike. Everything's on by default; trim what
you don't want rather than flip flags to turn things on.

The project started as a union of the twelve existing open-source Canvas
MCP servers — all MIT or ISC licensed — normalised, deduped, and merged
into a single maintainable codebase. `ATTRIBUTION.md` names every repo
the design borrows from; full credit goes to their authors.

## Scope

Canvas has a big API. This server aims to expose the useful parts of it in
a way that makes sense to both a language model and a human. Fifteen
Canvas domains are covered:

courses, assignments, submissions, grades, modules, pages, calendar,
announcements, discussions, files, messages, notifications, profile,
quizzes, rubrics.

129 tools registered out of the box — reads, writes, creates, deletes,
the full surface. Every tool has a unit test against a mocked Canvas
client. `TOOL_MANIFEST.md` lists them all with endpoints, inputs, and the
source repos each one is cribbed from.

Canvas enforces its own permission model on every call, so a student token
will only be able to do student things regardless of what's registered —
the server doesn't try to gate anything it doesn't need to. If you want a
narrower tool surface for a specific deployment (a student agent, say,
that should never see `canvas_delete_course`), delete or comment the tools
you don't want from `src/tools/<domain>.ts` and rebuild. No feature flags,
no env toggle — the fork point is a visible code change.

Two tools are honest stubs because Canvas requires multi-step client-side
flows the server can't transparently wrap: `canvas_upload_file` (three-step
upload handshake) and the `online_upload`/`media_recording` paths of
`canvas_submit_assignment`. Text and URL submissions work end-to-end.
`canvas_download_file_to_disk` returns a pre-authenticated URL rather than
writing to disk — callers can fetch it directly.

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

## Trimming the tool surface

To narrow the set of tools exposed to a particular client, open the
relevant `src/tools/<domain>.ts` file and delete or comment out the tool
objects you don't want. Each tool is a standalone object in the domain's
array — no cross-tool coupling, no shared state, no feature flag — so
removing one is a local change. Rebuild and that tool is gone from the
`tools/list` response.

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

## Disclaimer

This server exposes Canvas LMS to a language model. Any MCP client connected
to it can call any of the 129 registered tools, and most of those tools can
create, modify, or delete real data in a real Canvas account. The AI on the
other end will do whatever its prompting steers it to do; there is no
confirmation step between "model decides to call a tool" and "the call
happens." Canvas logs every API call but does not undo them.

If you hand this server an instructor token, an AI assistant can post
announcements, grade submissions, and delete assignments on your behalf. If
you hand it an admin token, the blast radius is the entire institution
account the token can reach. Scope the token down to the least privilege
that does the job, trim tools you don't need before building, and don't
point an open-ended chat agent at a privileged token without understanding
the consequences.

This is provided as-is under the MIT licence. It's not affiliated with or
endorsed by Instructure. I make no warranty that it's safe, correct, or fit
for any purpose, and accept no liability for anything that happens when you
or an AI running through this server interact with Canvas. You are
responsible for how you deploy it, what token you give it, and what any
connected model does with that access.

## License

MIT. See `LICENSE`.
