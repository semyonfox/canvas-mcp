# Canvas MCP

Canvas MCP exposes a curated Canvas LMS REST surface through the Model Context Protocol (MCP). It is a TypeScript server built for the current **MCP 2026-07-28** core revision, using the v2 MCP TypeScript packages.

The server serves modern MCP clients at `/mcp` and retains a stateless compatibility path for legacy clients. It does not create or depend on MCP sessions.

## Highlights

- A registered Canvas tool catalog across courses, assignments, submissions, grades, modules, pages, calendar, announcements, discussions, files, messages, notifications, profile, quizzes, rubrics, and asynchronous progress jobs. See [TOOL_MANIFEST.md](./TOOL_MANIFEST.md) for the exact live inventory.
- Modern MCP discovery and tool metadata: `server/discover`, cache hints, tool titles, safety annotations, and structured tool results with a text fallback.
- Canvas-aware HTTP behavior: validated inputs, pagination, string-safe Canvas identifiers, request timeouts, and bounded retries for retryable reads.
- Safer deployment defaults: loopback binding, host-header validation, an explicit browser-origin allowlist, and opt-in request-scoped credentials.
- `pnpm check` runs the test suite, TypeScript check, and production build.

## Protocol and endpoint

Use an MCP client with v2 transport support and point it to:

```text
http://127.0.0.1:3001/mcp
```

`POST /mcp` is the MCP endpoint. `GET /health` returns a simple readiness response. The root path is intentionally not an MCP endpoint.

The server negotiates the 2026-07-28 protocol automatically with modern clients. Its SDK handler also supports the safe stateless legacy exchange for existing clients; no `Mcp-Session-Id` is issued or required. Let the MCP client construct protocol envelopes and headers rather than hand-crafting a `tools/list` HTTP request.

Discovery and tool-listing do not require Canvas credentials. A tool call resolves credentials only when it needs to contact Canvas.

## Prerequisites

- Node.js 22+
- pnpm 11.22.0, as pinned in `package.json`
- A Canvas access token and tenant domain for real Canvas calls

## Run locally

Install and start the server:

```bash
pnpm install --frozen-lockfile
CANVAS_API_TOKEN='…' \
CANVAS_DOMAIN='your-school.instructure.com' \
pnpm dev
```

Check readiness:

```bash
curl --fail-with-body http://127.0.0.1:3001/health
# {"ok":true}
```

The server does not load `.env` itself. To use the provided template as a private local file:

```bash
cp .env.example .env
# Fill in only credentials you control; do not commit this file.
set -a
. ./.env
set +a
pnpm dev
```

## Configuration and credential modes

Set `CANVAS_API_TOKEN` and `CANVAS_DOMAIN` together for a private, server-default Canvas connection. `CANVAS_DOMAIN` is an HTTPS hostname such as `your-school.instructure.com`, not a URL path.

For a multi-tenant or brokered deployment, request-scoped credentials are deliberately disabled by default. Enable them only with an explicit Canvas-domain allowlist:

```bash
CANVAS_ALLOW_REQUEST_CREDENTIALS=true
CANVAS_ALLOWED_DOMAINS=school-a.instructure.com,school-b.instructure.com
```

Then a client must send both `X-Canvas-Token` and `X-Canvas-Domain` on every Canvas tool call. Partial headers fail, and a request domain outside `CANVAS_ALLOWED_DOMAINS` is rejected. Header credentials are never combined with an environment token.

When a server-default `CANVAS_DOMAIN` is configured, that exact tenant is also allowlisted for a complete request-scoped credential pair; it never supplies its default token to a header-selected request.

Other deployment controls:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Network interface to listen on. |
| `PORT` | `3001` | HTTP port. |
| `MCP_ALLOWED_HOSTS` | required for non-loopback `HOST` | Comma-separated hostnames accepted in the `Host` header. |
| `MCP_ALLOWED_ORIGINS` | none | Comma-separated exact HTTP(S) browser origins allowed by CORS. Wildcards are not supported. |
| `LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, or `error`. |
| `CANVAS_UPLOAD_ROOTS` | none | Comma-separated absolute directories that `file_path` uploads may read from. Unset disables server-side paths. |

`MCP_ALLOWED_ORIGINS` controls browser CORS only; it is not authentication. Put any non-local deployment behind TLS and an authenticated reverse proxy or private network boundary.

## Canvas identifiers and results

Canvas identifiers may exceed JavaScript's safe integer range. Pass IDs as decimal strings, such as `"9223372036854775807"`; legacy safe numeric IDs are accepted where a tool supports an ID. The Canvas client requests Canvas's string-ID response format so IDs can round-trip without precision loss.

Successful JSON tool responses include both MCP `structuredContent` and a JSON text fallback. Tool metadata labels read-only and destructive operations, but these annotations do not replace Canvas permissions or a deployer's authorization controls.

## Docker

The image is self-contained; no Compose setup is required. A container needs an explicit non-loopback bind plus an allowed host value:

```bash
docker build -t canvas-mcp:latest .
docker run --rm \
  --name canvas-mcp \
  -p 127.0.0.1:3001:3001 \
  -e HOST=0.0.0.0 \
  -e MCP_ALLOWED_HOSTS=127.0.0.1,localhost \
  -e CANVAS_API_TOKEN='…' \
  -e CANVAS_DOMAIN='your-school.instructure.com' \
  -e LOG_LEVEL=info \
  canvas-mcp:latest
```

For a reverse proxy, set `MCP_ALLOWED_HOSTS` to the public hostname it sends and set `MCP_ALLOWED_ORIGINS` only when browser access is intended.

## Validate

```bash
pnpm check
```

For a representative, read-oriented verification against a real Canvas tenant:

```bash
pnpm build
CANVAS_API_TOKEN='…' \
CANVAS_DOMAIN='your-school.instructure.com' \
node scripts/verify-tools.mjs
```

Use a least-privilege test token and treat the verifier output as sensitive. It samples supported read paths; it intentionally does not exercise every tool or mutating operation.

## Security and scope

This server exposes both read and mutating Canvas operations. Canvas permissions govern downstream actions, but the server does not provide per-user RBAC, client authentication, confirmation prompts, or OAuth token acquisition/refresh. Deployers should use least-privilege revocable Canvas tokens, remove tools they do not intend to expose, and keep credentials out of source, image layers, logs, and shell history.

This release adopts the 2026-07-28 MCP core protocol, but does not advertise an MCP Apps UI extension. The official `@modelcontextprotocol/ext-apps` helper currently peers with the legacy v1 SDK, which is incompatible with this server's v2 core SDK; claiming UI support here would be misleading.

## File uploads and submissions

`canvas_submit_assignment` with `submission_type=online_upload` runs Canvas's whole upload flow and submits in one call, and `canvas_upload_file` uploads to a user's files, course files, or an assignment's submission files. Both take the bytes in one of two ways:

- `file_path` is read on the machine running this server. It only works when the server and the file share a host, and only inside `CANVAS_UPLOAD_ROOTS`. Paths are resolved through symlinks, and hidden directories below a root (`.ssh`, `.config`) are refused, so a prompt cannot turn the server into a way to send arbitrary local files to Canvas.
- `content_base64` with `filename` is sent by the client, so it works for a remote server. It is practical for small files and scripted clients. An LLM has to emit every byte as tokens.

For a large file on a remote server, call `canvas_upload_file` with `filename` and `size` and no bytes. You get Canvas's signed `upload_url` and `upload_params`. The client posts the file there itself, then passes the resulting file id to `canvas_submit_assignment` as `file_ids`. The signed parameters expire after about 30 minutes and will appear in the client transcript.

Submitting again is a resubmission. Canvas records a new attempt that replaces the current one for grading and keeps earlier attempts in the history; there is no API to edit or delete a submitted file. `canvas_submit_assignment` checks the submission type, lock state, attempts left (including extra attempts and redo requests) and allowed extensions before uploading anything. `canvas_post_submission_comment` defaults to your own submission and can attach files, for example a corrected appendix on a specific attempt.

`media_recording` submissions (Kaltura) are not supported.

Canvas is a trademark of Instructure, Inc. This project is not affiliated with or endorsed by Instructure. [ATTRIBUTION.md](./ATTRIBUTION.md) records upstream project provenance.
