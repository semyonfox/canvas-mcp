# canvas-mcp

Unified TypeScript MCP server for Canvas LMS, exposing student-facing Canvas API tools over streamable-http.

## Why

This server merges the best tools from 12 open-source Canvas MCP servers (all MIT/ISC licensed) into a single, consistent implementation. The tool set is student-focused by default — admin and educator tools are present in source but commented out, so they can be enabled without another merge pass. It is consumed by [OghmaNotes](https://oghmanotes.ie) as an external MCP service, giving the AI chat agent full Canvas API coverage beyond the five built-in tools. It is also intended as a reference implementation the community can converge on.

## Tool surface

68 active student-facing tools across 15 Canvas domains. Admin and educator tools are kept in source (commented out) for selective enablement — see below. See [`TOOL_MANIFEST.md`](./TOOL_MANIFEST.md) for the full per-tool list with endpoints and notes.

- **courses** — list courses, get course details, syllabus, sections, enrollments, tabs, favorites, dashboard cards
- **assignments** — list and get assignments, list assignment groups
- **submissions** — get own submission status and details per assignment
- **grades** — get course grades and enrollment grade summaries
- **modules** — list modules and module items
- **pages** — list pages, get page content, list page revisions
- **calendar** — list calendar events with date and context filters
- **announcements** — list announcements across courses
- **discussions** — list discussion topics, get discussion entries/posts
- **files** — list course files, get file metadata and download URL
- **messages** — list inbox conversations, get conversation detail
- **notifications** — list unread and recent notifications
- **profile** — get own user profile and activity stream
- **quizzes** — list quizzes, get quiz details (read-only)
- **rubrics** — list rubrics for a course, get rubric detail

## Setup

```bash
cp .env.example .env
# fill in CANVAS_API_TOKEN and CANVAS_DOMAIN
npm install
npm run dev    # watch mode
# or
npm run build && npm start
```

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CANVAS_API_TOKEN` | yes | — | Canvas LMS user API token |
| `CANVAS_DOMAIN` | yes | — | no scheme, e.g. `universityofgalway.instructure.com` |
| `PORT` | no | `3001` | HTTP port the server listens on |
| `LOG_LEVEL` | no | `info` | log verbosity (`debug`, `info`, `warn`, `error`) |

## Docker

```bash
docker build -t canvas-mcp .
docker run --rm -p 3001:3001 \
  -e CANVAS_API_TOKEN=... \
  -e CANVAS_DOMAIN=... \
  canvas-mcp
curl localhost:3001/health
```

## MCP client config

This server uses the streamable-http transport. Clients connect to `http://HOST:3001` locally or the deployed URL in production. Any MCP client that supports streamable-http URLs can connect — example config:

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

## Deployment

**AWS Fargate** — run the container as a long-lived service behind an ALB or direct ECS service discovery. Pass `CANVAS_API_TOKEN` via an ECS secret sourced from AWS Secrets Manager. Set the container port to `3001` and configure a health check against `/health`.

**AWS Lambda with function URL** — use the streamable-http adapter to wrap the server for Lambda invocation. Enable a function URL with `AWS_IAM` or `NONE` auth. Retrieve the token from Secrets Manager in the Lambda init phase and set it as an environment variable. Cold-start latency is acceptable for infrequent MCP calls; keep the function warm if sub-second response is needed.

## Enabling admin/educator tools

Admin and educator tools are commented out in the relevant `src/tools/<domain>.ts` file. Each block is marked with a banner comment (`ADMIN / EDUCATOR TOOLS`) and wrapped in a `/* ... */` block comment. To enable a tool, uncomment the block in the appropriate file and rebuild. There is no feature flag — the fork-point is a visible code change.

## Attribution

This server merges work from 12 open-source Canvas MCP servers, all MIT/ISC licensed — see [`ATTRIBUTION.md`](./ATTRIBUTION.md) for the full list and links.

## License

See [`LICENSE`](./LICENSE).
