# Contributing

Canvas MCP is a v2 MCP server. Keep additions small, testable, and faithful to the Canvas REST API.

## Ground rules

- Tool names use `canvas_<verb>_<noun>` snake case, for example `canvas_list_courses` or `canvas_delete_rubric`.
- Keep a Canvas domain's tools together in `src/tools/<domain>.ts`; mirror coverage in `tests/tools/<domain>.test.ts`.
- `src/tools/index.ts` is the runtime registry. Every entry in its `allTools` array is exposed by the MCP server.
- Treat `TOOL_MANIFEST.md` as the checked-in inventory. Update its domain list whenever the registry changes; do not add entries for planned or commented-out tools.
- Every handler needs a mocked-client unit test that asserts the Canvas path, query/body shape, and result.
- Use `jsonResult(value)` for JSON results. It supplies both the MCP text fallback and `structuredContent`.

## Add a tool

For a course-scoped paginated read, add an entry to `src/tools/courses.ts`:

```ts
import { z } from "zod";
import { canvasId } from "./canvas-id.js";
import { jsonResult, type ToolDef } from "./types.js";

export const courseTools: ToolDef[] = [
    // existing entries
    {
        name: "canvas_list_external_tools",
        description: "List LTI external tools available in a course.",
        inputSchema: z.object({
            course_id: canvasId,
            search_term: z.string().optional(),
        }),
        handler: async (args, { canvas }) => {
            const tools = await canvas.collectPaginated(
                `/api/v1/courses/${args.course_id}/external_tools`,
                {
                    per_page: 100,
                    ...(args.search_term ? { search_term: args.search_term } : {}),
                },
            );
            return jsonResult(tools);
        },
    },
];
```

`canvasId` accepts a decimal string and safely normalizes legacy numeric input. Use it for Canvas resource IDs; do not add `z.number().int().positive()` for a Canvas ID, because Canvas IDs can be 64-bit. Do not use it for a genuinely numeric field such as `per_page`, a score, a date offset, or a byte size.

Use `canvas.collectPaginated` for list endpoints that return Canvas pagination links. Use `canvas.get` for a single resource and `canvas.post`, `canvas.put`, or `canvas.delete` for the corresponding mutation. The client deliberately retries only retryable `GET` requests.

Optional values must be conditionally spread because the project enables `exactOptionalPropertyTypes`:

```ts
const body = {
    title: args.title,
    ...(args.description ? { description: args.description } : {}),
    ...(args.position !== undefined ? { position: args.position } : {}),
};
```

## Test and inventory changes

Add a mocked Canvas-client test alongside the domain tests:

```ts
it("canvas_list_external_tools uses the course endpoint", async () => {
    const collect = vi.fn().mockResolvedValue([{ id: "7", name: "Panopto" }]);
    const tool = findTool("canvas_list_external_tools");

    await tool.handler(
        { course_id: "42" },
        { canvas: fakeCanvas({ collectPaginated: collect }) },
    );

    expect(collect).toHaveBeenCalledWith(
        "/api/v1/courses/42/external_tools",
        expect.objectContaining({ per_page: 100 }),
    );
});
```

Then add the exact tool name to the corresponding `TOOL_MANIFEST.md` domain list and run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Tool registration and MCP metadata are centralized in `src/server.ts`; an entry already present in `allTools` needs no per-tool router wiring. If a tool has unusual semantics, add an explicit `title` or MCP annotations to its `ToolDef` and cover them in a server-level test.

## Live verification

`scripts/verify-tools.mjs` is a representative, read-oriented integration smoke test. It discovers IDs from a real Canvas tenant and invokes selected non-mutating handlers; it does not claim to cover every registered tool or perform mutations.

```bash
pnpm build
CANVAS_API_TOKEN=... CANVAS_DOMAIN=... node scripts/verify-tools.mjs
```

Use a disposable least-privilege token. Its output can contain course and user data, so do not publish it.

## Transport changes

Keep HTTP and protocol work in `src/http.ts` and `src/server.ts`. The public endpoint is `POST /mcp`; `GET /health` is the only health route. Modern MCP behavior is owned by the v2 SDK's `createMcpHandler`, including discovery and protocol headers. Preserve the stateless legacy mode unless a deliberate compatibility decision is documented and tested.

Do not weaken the deployment defaults while adding a tool: non-loopback listeners require `MCP_ALLOWED_HOSTS`, browser origins require explicit `MCP_ALLOWED_ORIGINS`, and request-scoped Canvas credentials require both `CANVAS_ALLOW_REQUEST_CREDENTIALS=true` and an allowed Canvas domain.
