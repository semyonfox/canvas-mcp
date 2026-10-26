# Attribution

Canvas MCP brings together tool designs from twelve open-source Canvas MCP servers. For each Canvas area, the design picked the most complete version across these projects and rewrote it in this codebase's TypeScript structure. Thank you to every author listed here. This project stands on their work.

Licences were checked against each repository on 26 October 2026. Where code here follows an upstream implementation, it is used under that project's licence, and the notices are reproduced below.

## Source repositories

| Repository | Author | Licence | Copyright notice |
| --- | --- | --- | --- |
| [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) | Vishal Sachdev | MIT | Copyright (c) 2025 Vishal Sachdev |
| [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms) | DMontgomery40 | MIT, declared in `package.json` (no licence file) | none given |
| [r-huijts/canvas-mcp](https://github.com/r-huijts/canvas-mcp) | R. Huijts | MIT | Copyright (c) 2024 R.Huijts |
| [mtgibbs/canvas-lms-mcp](https://github.com/mtgibbs/canvas-lms-mcp) | Matt Gibbs (mtgibbs) | MIT | Copyright (c) 2025 mtgibbs |
| [ahnopologetic/canvas-lms-mcp](https://github.com/ahnopologetic/canvas-lms-mcp) | ahnopologetic | MIT | Copyright (c) 2023 Canvas LMS MCP Server Contributors |
| [aryankeluskar/canvas-mcp](https://github.com/aryankeluskar/canvas-mcp) | Aryan Keluskar | ISC | Copyright (c) 2025, Aryan Keluskar |
| [a-ariff/canvas-mcp](https://github.com/a-ariff/canvas-mcp) | a-ariff | MIT | Copyright (c) 2025 a-ariff |
| [sweeden-ttu/canvas-lms-mcp](https://github.com/sweeden-ttu/canvas-lms-mcp) | sweeden-ttu | MIT | Copyright (c) 2025 (no holder named) |
| Jon-Vii/canvas-student-mcp | Jon-Vii | MIT, declared in `pyproject.toml` (no licence file) | none given |
| [Kuria-Mbatia/Canvas-MCP-server](https://github.com/Kuria-Mbatia/Canvas-MCP-server) | Kuria Mbatia (Notioc) | MIT | Copyright (c) 2024 Notioc |
| [enkhbold470/mcp-server-canvas](https://github.com/enkhbold470/mcp-server-canvas) | enkhbold470 | MIT, stated in the README (no licence file) | none given |
| [Shashwatpog/poke-canvas-mcp](https://github.com/Shashwatpog/poke-canvas-mcp) | Shashwat Mishra | MIT | Copyright (c) 2025 Shashwat Mishra |

Jon-Vii/canvas-student-mcp is no longer publicly available on GitHub. Its licence is taken from the copy used during design, last updated in March 2025.

## Per-domain sources

**Courses.** Core list/get shape from `vishalsachdev`, `r-huijts`, and `DMontgomery40`. Section and enrollment handling borrowed from `DMontgomery40` and `mtgibbs`. Favorite-course and dashboard-card conveniences come from `Kuria-Mbatia` and `ahnopologetic`.

**Assignments.** Based primarily on `vishalsachdev`, `r-huijts`, and `DMontgomery40`, which between them cover bucket filtering, `include[]=submission`, and per-course pagination. Student-centric upcoming/missing/due-this-week tools come from `mtgibbs`.

**Submissions.** Student-self submission shape from `ahnopologetic` and `vishalsachdev`. Rich include[] handling and comment/rubric merging patterns from `r-huijts` and `Kuria-Mbatia`. Peer-review surfacing from `vishalsachdev`.

**Grades.** Enrollment-derived grade tools from `DMontgomery40` and `vishalsachdev`. Recent-grades and feedback roll-ups from `mtgibbs`. Grading-standard lookup from `r-huijts`.

**Modules.** List/get shape from `vishalsachdev`, `r-huijts`, and `DMontgomery40`. Student progress endpoints (mark_read, mark_done, item sequence) from `Kuria-Mbatia` and `DMontgomery40`.

**Pages.** Base list/get/front-page from `vishalsachdev` and `DMontgomery40`. Revision browsing and the page-revision payload handling come almost entirely from `r-huijts`.

**Calendar.** `aryankeluskar` and `ahnopologetic` provide the core calendar-event query shape with context-code filtering. Planner and todo surfaces from `ahnopologetic`, `Kuria-Mbatia`, `mtgibbs`, and `vishalsachdev`.

**Announcements.** Institution-wide `/announcements` endpoint from `vishalsachdev`, `DMontgomery40`, and `mtgibbs`. Per-course announcement filtering (via `discussion_topics?only_announcements=true`) from `vishalsachdev`. Account notification banners from `Kuria-Mbatia`.

**Discussions.** Topic list/get from `vishalsachdev`, `r-huijts`, and `DMontgomery40`. Threaded `view` endpoint and replies walk from `ahnopologetic` and `Kuria-Mbatia`. Entry-level tools from `vishalsachdev`.

**Files.** Course file listing and folder traversal from `DMontgomery40`, `ahnopologetic`, and `vishalsachdev`. Pre-authenticated download-URL pattern from `aryankeluskar` and `Kuria-Mbatia`. This is the student-safe way to hand a file to the client without the server streaming bytes.

**Messages.** Conversations/inbox shape from `vishalsachdev`, `mtgibbs`, and `DMontgomery40`. Unread-count tool and workflow_state toggling from `vishalsachdev` and `mtgibbs`.

**Notifications.** Activity stream surface from `DMontgomery40` and `Kuria-Mbatia`. Account notifications and communication-channel listing from `DMontgomery40` and `Kuria-Mbatia`.

**Profile.** Self-profile and user-settings endpoints from `DMontgomery40`, `r-huijts`, and `ahnopologetic`.

**Quizzes.** List/get shape from `r-huijts`, `ahnopologetic`, and `DMontgomery40`. Student-self quiz submission retrieval from `DMontgomery40`. `r-huijts` also contributes the educator surface (question CRUD, question groups).

**Rubrics.** Base list/get and statistics from `vishalsachdev`, `r-huijts`, and `DMontgomery40`. Student-scoped rubric-assessment retrieval (via submissions include[]) from `vishalsachdev`.

## Upstream licence notices

### MIT

Applies to every repository above except aryankeluskar/canvas-mcp, with each project's copyright notice from the table.

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC

Applies to aryankeluskar/canvas-mcp, Copyright (c) 2025, Aryan Keluskar.

```text
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
