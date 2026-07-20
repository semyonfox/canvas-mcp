# Canvas MCP

A TypeScript MCP server that translates validated Model Context Protocol tool calls into Canvas LMS REST requests over streamable HTTP.

It provides broad, explicit coverage of common Canvas workflows while keeping the transport, request validation and deployment path inspectable.

## Engineering highlights

- **129 registered tools across 15 Canvas domains** including courses, assignments, submissions, grades, modules, pages, calendar, discussions, files, messages, notifications, profile, quizzes and rubrics.
- **Typed boundary:** every tool uses Zod schemas before it reaches a request-scoped Canvas REST client.
- **HTTP operations:** streamable HTTP MCP transport, `GET /health`, signal handling, pagination, a 30-second request timeout and one retry for 5xx responses.
- **Quality gates:** 182 mocked-client tests, TypeScript checks and production build are run through `pnpm check`.
- **Container delivery:** a multi-stage image produces a non-root distroless runtime with pinned base images.
- **Open-source provenance:** [ATTRIBUTION.md](./ATTRIBUTION.md) documents 12 upstream Canvas MCP projects whose patterns and tool designs informed this implementation.

## Request flow

```text
MCP HTTP request
  │
  ▼
Tool schema validation (Zod)
  │
  ▼
Request-scoped Canvas client
  │
  ▼
Canvas LMS REST API
```

## Prerequisites

- Node.js 22+
- pnpm 10+
- A Canvas token and domain only when making a real Canvas request

## Run locally

Install and start the HTTP server:

```bash
pnpm install --frozen-lockfile
PORT=3001 pnpm dev
```

The health endpoint needs no Canvas credentials:

```bash
curl --fail-with-body http://127.0.0.1:3001/health
# {"ok":true}
```

The MCP endpoint is `POST /`. A `tools/list` request validates the transport and tool registration without calling Canvas; placeholder credentials are enough:

```bash
curl --fail-with-body --silent --show-error \
  -X POST http://127.0.0.1:3001/ \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'X-Canvas-Token: smoke-test-token' \
  -H 'X-Canvas-Domain: example.instructure.com' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

For actual Canvas calls, supply a valid token/domain through the two request headers above, or configure private server defaults:

```bash
CANVAS_API_TOKEN='…' \
CANVAS_DOMAIN='your-school.instructure.com' \
PORT=3001 \
pnpm start
```

The server does **not** load `.env` itself. To use `.env.example` as a private local file, source it explicitly in a POSIX shell:

```bash
cp .env.example .env
# Fill in only credentials you control; do not commit this file.
set -a
. ./.env
set +a
pnpm dev
```

Per-request `X-Canvas-Token` and `X-Canvas-Domain` values take precedence over environment defaults. `PORT` defaults to `3001`; `LOG_LEVEL` accepts `debug`, `info`, `warn` or `error`.

## Docker

There is no Compose dependency for this service.

```bash
docker build -t canvas-mcp:latest .
docker run --rm \
  --name canvas-mcp \
  -p 127.0.0.1:3001:3001 \
  -e CANVAS_API_TOKEN='…' \
  -e CANVAS_DOMAIN='your-school.instructure.com' \
  -e LOG_LEVEL=info \
  canvas-mcp:latest
```

Omit the `CANVAS_*` environment variables for a request-scoped-credential deployment, then send both headers with every MCP request.

## Validate

```bash
pnpm check
```

This runs tests, typechecking and the production build. For credentialed manual verification against a real Canvas environment:

```bash
pnpm build
CANVAS_API_TOKEN='…' \
CANVAS_DOMAIN='your-school.instructure.com' \
node scripts/verify-tools.mjs
```

The live verifier writes request/result information to stdout; use an isolated, least-privilege test token and treat its output as sensitive.

## Important security boundary

This server registers both read and mutating operations by default. Canvas and institution configuration determine whether a supplied token may perform a downstream action, but this project does **not** add server-side RBAC, client authentication, confirmation prompts or runtime tool filtering.

Deployers should:

- use least-privilege, revocable Canvas tokens;
- remove tools they do not intend to expose and rebuild the server;
- place the service behind TLS plus network/reverse-proxy access controls;
- avoid public fallback-token deployments;
- restrict access to approved Canvas domains and trusted clients;
- ensure credentials never enter source, image layers, shell history, proxies or observability logs.

Tool removal is a source-level deployment choice, not runtime authorization. The endpoint currently permits broad browser origins and accepts credential headers, so it is unsuitable for direct public exposure.

## Scope and limitations

- This is a selected Canvas workflow surface, not a claim to wrap every Canvas API endpoint.
- File upload and some multi-step assignment flows remain incomplete; see the tool manifest for the exact surface.
- It does not acquire or refresh Canvas OAuth credentials.
- Canvas is a trademark of Instructure, Inc. This project is not affiliated with or endorsed by Instructure.

See [TOOL_MANIFEST.md](./TOOL_MANIFEST.md) for the exact tool catalog and [ATTRIBUTION.md](./ATTRIBUTION.md) for upstream references.
