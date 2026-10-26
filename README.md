# Canvas MCP

An MCP server that lets Claude or Codex read your Canvas LMS courses, deadlines, grades and feedback using your own access token.

It is for students who want to ask an assistant things like "what do I still need to hand in?" or "what feedback did I get on Lab 4?" without copying pages out of Canvas. It runs on your own machine, talks only to your institution's Canvas, and is **read-only by default**.

> **Check your institution's policy first.** This is an unofficial, community-built tool, not affiliated with or endorsed by Instructure or any university. Some institutions restrict personal access tokens or third-party tools that use them. If yours does, don't use this.

## What it looks like

Claude Code, run against fixture data rather than a real Canvas account:

```text
> What do I still need to hand in? Keep it to a short list.

  canvas_list_todo_items, canvas_list_missing_assignments, canvas_list_upcoming_events

Three things are outstanding on Canvas:

- Technical Writing: Reading reflection 2 (5 pts). It's overdue: it was due 20 Oct.
  Check whether the course still accepts late work.
- Databases: Lab 5, Indexes (10 pts), due Wed 28 Oct, 23:59.
- Computer Networks: Week 7 quiz (5 pts), due Fri 30 Oct, 17:00.
```

## Quick start

You need Node.js 22 or newer. Nothing needs cloning or building.

**1. Create a Canvas token.** In Canvas, open Account, then Settings, then New Access Token under Approved Integrations. Give it a purpose such as "Canvas MCP" and an expiry date a few months out. Copy the token, because Canvas shows it once.

**2. Add the server to your client.** Replace the token and `your-school.instructure.com` with your own Canvas hostname, the part before `/courses` in your browser.

Claude Code:

```bash
claude mcp add canvas \
  -e CANVAS_API_TOKEN=your-token \
  -e CANVAS_DOMAIN=your-school.instructure.com \
  -- npx -y --allow-remote=all --package=https://github.com/semyonfox/canvas-mcp/releases/download/v0.3.0/semyonfox-canvas-mcp-0.3.0.tgz canvas-mcp
```

Claude Desktop, in `claude_desktop_config.json` (Settings, then Developer, then Edit Config):

```json
{
  "mcpServers": {
    "canvas": {
      "command": "npx",
      "args": [
        "-y",
        "--allow-remote=all",
        "--package=https://github.com/semyonfox/canvas-mcp/releases/download/v0.3.0/semyonfox-canvas-mcp-0.3.0.tgz",
        "canvas-mcp"
      ],
      "env": {
        "CANVAS_API_TOKEN": "your-token",
        "CANVAS_DOMAIN": "your-school.instructure.com"
      }
    }
  }
}
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.canvas]
command = "npx"
args = ["-y", "--allow-remote=all", "--package=https://github.com/semyonfox/canvas-mcp/releases/download/v0.3.0/semyonfox-canvas-mcp-0.3.0.tgz", "canvas-mcp"]

[mcp_servers.canvas.env]
CANVAS_API_TOKEN = "your-token"
CANVAS_DOMAIN = "your-school.instructure.com"
```

`--allow-remote=all` lets npm 12 and later install a package from a URL, which they refuse by default. Older npm versions accept it too. The command-line forms (`claude mcp add`, `codex mcp add`) put the token in your shell history. Editing the config file directly avoids that.

**3. Ask something.** Restart the client and try "what's due this week?" or "show me my grades".

Newer versions appear on the [releases page](https://github.com/semyonfox/canvas-mcp/releases). The URL above pins one version, so nothing changes until you update it.

## Your token and what it can do

A Canvas personal access token is not scoped. It can do anything your account can do in Canvas, including submitting work, posting in discussions and sending messages. If you are a TA or teacher on any course, it carries those permissions too.

That is why this server only registers its 70 read tools by default. Treat the token like a password:

- give it an expiry date, and revoke it under Approved Integrations when you stop using it
- keep it in your client's config, never in a repository, screenshot or chat
- use one token per tool, so revoking one doesn't break the others

The server sends the token only to the `CANVAS_DOMAIN` you set. It never forwards it to another host, including pagination links or file-upload storage.

## Turning on writes

Set `CANVAS_ENABLE_WRITES=true` in the server's environment to also register the 64 tools that change Canvas. These include submitting assignments, posting comments and discussion replies, sending messages, planner notes, marking items read, and course-staff tools for grading and editing course content. Every one of them acts as you.

Leave writes off unless you need them. With writes on, tool annotations mark which tools are destructive so your client can ask before running them, but your client's approval prompt is the only check. Canvas permissions still apply, so a student token cannot grade.

## Being polite to Canvas

The server is built to stay well inside Canvas's rate limits:

- at most four requests in flight at once
- it pauses when Canvas reports the token's rate-limit budget is running low
- when Canvas throttles a request (403 "Rate Limit Exceeded" or 429), it backs off and retries up to three times, honouring `Retry-After`
- reads that hit a 5xx retry twice with backoff. Writes are never resent after a 5xx, because Canvas may already have applied them
- list tools follow Canvas pagination, and refuse a page link that repeats or points away from your Canvas host

## Credits

Canvas MCP pulls together tool designs from community Canvas MCP servers. It would not exist without the work of Vishal Sachdev ([vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp)), DMontgomery40 ([mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms)), R. Huijts ([r-huijts/canvas-mcp](https://github.com/r-huijts/canvas-mcp)), mtgibbs ([canvas-lms-mcp](https://github.com/mtgibbs/canvas-lms-mcp)), ahnopologetic ([canvas-lms-mcp](https://github.com/ahnopologetic/canvas-lms-mcp)), Aryan Keluskar ([aryankeluskar/canvas-mcp](https://github.com/aryankeluskar/canvas-mcp)), a-ariff ([a-ariff/canvas-mcp](https://github.com/a-ariff/canvas-mcp)), sweeden-ttu ([canvas-lms-mcp](https://github.com/sweeden-ttu/canvas-lms-mcp)), Jon-Vii (canvas-student-mcp), Kuria Mbatia ([Canvas-MCP-server](https://github.com/Kuria-Mbatia/Canvas-MCP-server)), enkhbold470 ([mcp-server-canvas](https://github.com/enkhbold470/mcp-server-canvas)) and Shashwat Mishra ([poke-canvas-mcp](https://github.com/Shashwatpog/poke-canvas-mcp)).

[ATTRIBUTION.md](./ATTRIBUTION.md) records which ideas came from where, along with each project's licence and copyright notice.

---

## Tools

[TOOL_MANIFEST.md](./TOOL_MANIFEST.md) lists all 134 tools. Read tools are the ones named `canvas_get_*` and `canvas_list_*`. They cover courses, assignments, a merged "my coursework" status view, submissions, grades and a grade breakdown, feedback, modules, pages, calendar and planner, announcements, discussions, files, inbox, notifications, profile, quizzes and rubrics.

Canvas identifiers can exceed JavaScript's safe integer range, so pass IDs as decimal strings such as `"9223372036854775807"`. Safe numeric IDs are still accepted. Results come back as MCP `structuredContent` with a JSON text fallback.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CANVAS_API_TOKEN` | none | Your Canvas access token. Set together with `CANVAS_DOMAIN`. |
| `CANVAS_DOMAIN` | none | Canvas HTTPS hostname, such as `your-school.instructure.com`. Not a URL path. |
| `CANVAS_ENABLE_WRITES` | `false` | `true` registers the tools that change Canvas. |
| `CANVAS_UPLOAD_ROOTS` | none | Comma-separated absolute directories that `file_path` uploads may read from. Unset disables server-side paths. Only matters with writes on. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs go to stderr. |

Discovery and tool listing work without credentials. A tool call fails with a clear message if they are missing.

## Running over HTTP

`canvas-mcp` speaks stdio by default, which is what desktop and CLI clients expect. `canvas-mcp --http` serves MCP at `http://127.0.0.1:3001/mcp` instead, for clients that connect by URL or for a shared deployment. `GET /health` returns `{"ok":true}`.

The HTTP server targets the MCP 2026-07-28 revision and keeps a stateless compatibility path for older clients. It issues no `Mcp-Session-Id`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Network interface to listen on. |
| `PORT` | `3001` | HTTP port. |
| `MCP_ALLOWED_HOSTS` | required for non-loopback `HOST` | Comma-separated hostnames accepted in the `Host` header. |
| `MCP_ALLOWED_ORIGINS` | none | Comma-separated exact HTTP(S) browser origins allowed by CORS. No wildcards. |
| `CANVAS_ALLOW_REQUEST_CREDENTIALS` | `false` | `true` accepts `X-Canvas-Token` and `X-Canvas-Domain` headers per request. |
| `CANVAS_ALLOWED_DOMAINS` | none | Required with request credentials. Comma-separated Canvas hostnames the headers may select. |

With request credentials on, a client must send both headers on every Canvas tool call. Partial headers fail, a domain outside `CANVAS_ALLOWED_DOMAINS` is rejected, and header credentials are never mixed with an environment token. A configured `CANVAS_DOMAIN` is also allowlisted for a complete header pair, but its token is never used for a header-selected request.

`MCP_ALLOWED_ORIGINS` controls browser CORS only and is not authentication. The HTTP server has no client authentication of its own, so put any non-local deployment behind TLS and an authenticated reverse proxy or a private network.

### Docker

```bash
docker build -t canvas-mcp:latest .
docker run --rm \
  --name canvas-mcp \
  -p 127.0.0.1:3001:3001 \
  -e HOST=0.0.0.0 \
  -e MCP_ALLOWED_HOSTS=127.0.0.1,localhost \
  -e CANVAS_API_TOKEN='…' \
  -e CANVAS_DOMAIN='your-school.instructure.com' \
  canvas-mcp:latest
```

The image runs `canvas-mcp --http`. For a reverse proxy, set `MCP_ALLOWED_HOSTS` to the public hostname it sends, and set `MCP_ALLOWED_ORIGINS` only when browser access is intended.

## File uploads and submissions

These need `CANVAS_ENABLE_WRITES=true`.

`canvas_submit_assignment` with `submission_type=online_upload` runs Canvas's whole upload flow and submits in one call. `canvas_upload_file` uploads to your files, course files, or an assignment's submission files. Both take the bytes in one of two ways:

- `file_path` is read on the machine running this server, and only inside `CANVAS_UPLOAD_ROOTS`. Paths are resolved through symlinks, and hidden directories below a root (`.ssh`, `.config`) are refused, so a prompt cannot turn the server into a way to send arbitrary local files to Canvas.
- `content_base64` with `filename` is sent by the client, so it works for a remote server. It suits small files, because an LLM has to emit every byte as tokens.

For a large file on a remote server, call `canvas_upload_file` with `filename` and `size` and no bytes. You get Canvas's signed `upload_url` and `upload_params`. The client posts the file there itself, then passes the resulting file id to `canvas_submit_assignment` as `file_ids`. The signed parameters expire after about 30 minutes and will appear in the client transcript.

Submitting again is a resubmission. Canvas records a new attempt that replaces the current one for grading and keeps earlier attempts in the history. There is no API to edit or delete a submitted file. `canvas_submit_assignment` checks the submission type, lock state, attempts left (including extra attempts and redo requests) and allowed extensions before uploading anything. `canvas_post_submission_comment` defaults to your own submission and can attach files.

`media_recording` submissions (Kaltura) are not supported.

## Developing

```bash
pnpm install --frozen-lockfile
pnpm check          # tests, typecheck and build
pnpm dev            # HTTP server with reload
```

pnpm is pinned in `package.json`. For a representative read-only check against a real Canvas tenant, build and run `node scripts/verify-tools.mjs` with `CANVAS_API_TOKEN` and `CANVAS_DOMAIN` set. Use a test token and treat its output as sensitive.

To build the release tarball the quick start uses, run `pnpm pack`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions.

## Licence

MIT. See [LICENSE](./LICENSE), and [ATTRIBUTION.md](./ATTRIBUTION.md) for upstream notices.

Canvas is a trademark of Instructure, Inc. This project is not affiliated with or endorsed by Instructure.
