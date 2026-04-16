# canvas-mcp

Unified TypeScript MCP server for Canvas LMS. Student-focused tool set for use with OghmaNotes AI chat agent.

Deployed on AWS Fargate/Lambda with streamable-http transport.

## Attribution

This project draws from the following open-source Canvas MCP servers:

- [vishalsachdev/canvas-mcp](https://github.com/vishalsachdev/canvas-mcp) (MIT)
- [DMontgomery40/mcp-canvas-lms](https://github.com/DMontgomery40/mcp-canvas-lms) (MIT)
- [r-huijts/canvas-mcp](https://github.com/r-huijts/canvas-mcp) (MIT)
- [mtgibbs/canvas-lms-mcp](https://github.com/mtgibbs/canvas-lms-mcp) (MIT)
- [ahnopologetic/canvas-lms-mcp](https://github.com/ahnopologetic/canvas-lms-mcp) (MIT)
- [aryankeluskar/canvas-mcp](https://github.com/aryankeluskar/canvas-mcp) (ISC)
- [a-ariff/canvas-mcp](https://github.com/a-ariff/canvas-mcp) (MIT)
- [sweeden-ttu/canvas-lms-mcp](https://github.com/sweeden-ttu/canvas-lms-mcp) (MIT)
- [Jon-Vii/canvas-student-mcp](https://github.com/Jon-Vii/canvas-student-mcp) (MIT)
- [Kuria-Mbatia/Canvas-MCP-server](https://github.com/Kuria-Mbatia/Canvas-MCP-server) (MIT)
- [enkhbold470/mcp-server-canvas](https://github.com/enkhbold470/mcp-server-canvas) (MIT)
- [Shashwatpog/poke-canvas-mcp](https://github.com/Shashwatpog/poke-canvas-mcp) (MIT)

## Setup

```bash
cp .env.example .env
# set CANVAS_API_TOKEN and CANVAS_DOMAIN
npm install
npm run build
npm start
```

## Environment

```
CANVAS_API_TOKEN=   # Canvas LMS API token
CANVAS_DOMAIN=      # e.g. universityofgalway.instructure.com
PORT=3001           # server port (default 3001)
```
