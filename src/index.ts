import { loadConfig } from "./config.js";
import { createCanvasHttpServer } from "./http.js";
import { SERVER_NAME, SERVER_VERSION } from "./server.js";

const cfg = loadConfig();
const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const;

function log(level: keyof typeof levels, event: Record<string, unknown>): void {
    if (levels[level] < levels[cfg.logLevel]) return;
    console.log(JSON.stringify({ level, ...event }));
}

const http = createCanvasHttpServer(cfg, {
    onError: (error) => log("error", { msg: "MCP request failed", error: error.message }),
});

http.listen(cfg.port, cfg.host, () => {
    log("info", {
        msg: "canvas-mcp listening",
        name: SERVER_NAME,
        version: SERVER_VERSION,
        host: cfg.host,
        port: cfg.port,
        mcpEndpoint: "/mcp",
        credentials: cfg.canvasDomain ? "server-default" : "none",
    });
});

let shuttingDown = false;

function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", { msg: "shutting down", signal });
    void http.closeMcpHandler()
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            log("error", { msg: "failed to close MCP handler", error: message });
        })
        .finally(() => http.close(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
