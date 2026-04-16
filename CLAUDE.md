# canvas-mcp

## what this is

unified TypeScript MCP server for Canvas LMS, built by merging the best tools from 12 open-source Canvas MCP servers (all MIT/ISC licensed). student-focused — admin and educator tools are commented out, not deleted, so they can be re-enabled later.

this server is consumed by OghmaNotes (oghmanotes.ie) — specifically the AI chat agent calls this as an external MCP service to give students full Canvas API access through natural language.

## why it exists

OghmaNotes already has 5 internal Canvas MCP tools (list courses, modules, assignments, module items, get file) but they only cover basic course structure browsing. this external server adds the full Canvas surface: announcements, grades, discussions, inbox, calendar events, submissions, notifications, page content, quizzes, and more.

the internal tools in OghmaNotes stay as a lightweight fallback. this server is the extended Canvas brain.

## reference repos

all source repos are cloned into `reference/` (gitignored). these are the raw materials:

**primary sources (mine first):**
- `vishalsachdev/canvas-mcp` — Python, 87 tools, broadest coverage, AI-oriented
- `DMontgomery40/mcp-canvas-lms` — TypeScript, 54 tools, Docker + streamable-http
- `r-huijts/canvas-mcp` — TypeScript, 30+ tools, page revisions, rubrics, quiz CRUD
- `mtgibbs/canvas-lms-mcp` — Node.js, ~20 tools, grades focus, active releases
- `ahnopologetic/canvas-lms-mcp` — Python, ~15 tools, lean student-data surface, planner

**secondary sources:**
- `aryankeluskar/canvas-mcp` — calendar events, natural language queries
- `a-ariff/canvas-mcp` — courses, assignments, grades, modules
- `sweeden-ttu/canvas-lms-mcp` — student-facing ops
- `Jon-Vii/canvas-student-mcp` — student-oriented LLM client exploration
- `Kuria-Mbatia/Canvas-MCP-server` — comprehensive Canvas MCP
- `enkhbold470/mcp-server-canvas` — small, Cursor-oriented
- `Shashwatpog/poke-canvas-mcp` — read-only student-oriented

## student tools to implement

**active (student-facing):**
- courses: list courses, get course details, list sections, list enrollments
- assignments: list assignments, get assignment, list submissions, get submission status
- grades: get grades, get rubric statistics
- modules: list modules, list module items
- pages: list pages, get page content, list page revisions
- calendar: get calendar events
- announcements: list announcements
- discussions: list discussions, get discussion posts
- files: list files, get file metadata/URL
- messages: list conversations/inbox
- notifications: list notifications
- profile: get user profile
- quizzes: list quizzes, get quiz details (read-only)

**commented out (admin/educator):**
- course creation/updates/deletion
- enrollment management
- quiz authoring (create/update/delete)
- page content editing (update/revert)
- module publish toggling
- posting announcements/submission comments
- account admin tools (user creation, sub-accounts, reporting)

## deployment

- containerized via Docker (Fargate or Lambda with function URL)
- transport: streamable-http
- Canvas API token from AWS Secrets Manager
- target institution: universityofgalway.instructure.com

## stack

- TypeScript
- @modelcontextprotocol/sdk
- streamable-http transport
- Docker for deployment

## package manager

use npm, not pnpm or yarn.
