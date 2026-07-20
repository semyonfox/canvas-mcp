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

Canvas credentials may be supplied per request with `X-Canvas-Token` and `X-Canvas-Domain`, or configured as environment fallbacks for a deliberately private deployment.

## Important security boundary

This server registers both read and mutating operations by default. Canvas and institution configuration determine whether a supplied token may perform a downstream action, but this project does **not** add server-side RBAC, confirmation prompts or role-based tool filtering.

Deployers should:

- use least-privilege Canvas tokens;
- remove tools they do not intend to expose and rebuild the server;
- protect the endpoint with TLS and network or reverse-proxy access controls;
- avoid publicly exposing a deployment that uses fallback environment credentials;
- ensure credentials never enter application, proxy or observability logs.

Tool removal is a source-level deployment choice, not runtime authorization.

## Run locally

Requirements: Node.js 22+ and pnpm 10+.

```bash
cp .env.example .env
# Set CANVAS_API_TOKEN and CANVAS_DOMAIN only for a private development deployment.
pnpm install
pnpm dev
```

The package is configured with a `canvas-mcp` executable after installation.

## Validate

```bash
pnpm check
```

The repository also includes an optional credentialed verification script. It is intentionally separate from mocked tests because it can reach a real Canvas environment.

## Scope and limitations

- This is a selected Canvas workflow surface, not a claim to wrap every Canvas API endpoint.
- File upload and some multi-step assignment flows remain incomplete; see the tool manifest for the exact surface.
- It does not acquire or refresh Canvas OAuth credentials.
- Canvas is a trademark of Instructure, Inc. This project is not affiliated with or endorsed by Instructure.

See [TOOL_MANIFEST.md](./TOOL_MANIFEST.md) for the exact tool catalog and [ATTRIBUTION.md](./ATTRIBUTION.md) for upstream references.
