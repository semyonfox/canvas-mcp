import { z } from "zod";

const envSchema = z.object({
    CANVAS_API_TOKEN: z.string().optional(),
    CANVAS_DOMAIN: z.string().optional(),
    CANVAS_ALLOWED_DOMAINS: z.string().optional(),
    CANVAS_ALLOW_REQUEST_CREDENTIALS: z.enum(["true", "false"]).optional(),
    HOST: z.string().optional(),
    MCP_ALLOWED_HOSTS: z.string().optional(),
    MCP_ALLOWED_ORIGINS: z.string().optional(),
    PORT: z
        .string()
        .optional()
        .transform((value) => (value ? Number(value) : 3001))
        .pipe(z.number().int().positive().max(65535)),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface Config {
    canvasApiToken: string | undefined;
    canvasDomain: string | undefined;
    allowedCanvasDomains: readonly string[];
    allowRequestCredentials: boolean;
    host: string;
    allowedHosts: readonly string[];
    allowedOrigins: readonly string[];
    port: number;
    logLevel: "debug" | "info" | "warn" | "error";
}

export interface CanvasCredentials {
    domain: string;
    token: string;
}

export class CanvasCredentialsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CanvasCredentialsError";
    }
}

function optionalText(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function splitList(value: string | undefined): string[] {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * Canonicalises a Canvas tenant without accepting paths, credentials, or a
 * non-HTTPS scheme. The returned value is safe to interpolate as a URL host.
 */
export function normaliseCanvasDomain(raw: string): string {
    const value = raw.trim();
    if (!value) throw new Error("Canvas domain must not be empty.");

    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:") {
        throw new Error("Canvas domain must use HTTPS.");
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Canvas domain must be a hostname only, without credentials, path, query, or fragment.");
    }

    const host = url.host.toLowerCase().replace(/\.$/, "");
    if (!host) throw new Error("Canvas domain must include a hostname.");
    return host;
}

function normaliseOrigin(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("MCP_ALLOWED_ORIGINS entries must be HTTP(S) origins.");
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("MCP_ALLOWED_ORIGINS entries must be origins only, without credentials, path, query, or fragment.");
    }
    return url.origin;
}

function normaliseHost(raw: string): string {
    const value = raw.trim().toLowerCase();
    if (!value || value.includes("://") || value.includes("/") || value.includes("@")) {
        throw new Error("MCP_ALLOWED_HOSTS entries must be hostnames without a scheme, path, port, or credentials.");
    }
    let url: URL;
    try {
        url = new URL(`http://${value}`);
    } catch {
        throw new Error("MCP_ALLOWED_HOSTS entries must be valid hostnames without a scheme, path, port, or credentials.");
    }
    if (url.port || url.hostname !== value || url.search || url.hash) {
        throw new Error("MCP_ALLOWED_HOSTS entries must be hostnames without a scheme, path, port, or credentials.");
    }
    return url.hostname;
}

function isLoopbackHost(host: string): boolean {
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const parsed = envSchema.parse(env);
    const canvasApiToken = optionalText(parsed.CANVAS_API_TOKEN);
    const rawCanvasDomain = optionalText(parsed.CANVAS_DOMAIN);
    const canvasDomain = rawCanvasDomain ? normaliseCanvasDomain(rawCanvasDomain) : undefined;

    if (Boolean(canvasApiToken) !== Boolean(canvasDomain)) {
        throw new Error("CANVAS_API_TOKEN and CANVAS_DOMAIN must be configured together.");
    }

    const allowedCanvasDomains = new Set(
        splitList(parsed.CANVAS_ALLOWED_DOMAINS).map(normaliseCanvasDomain),
    );
    if (canvasDomain) allowedCanvasDomains.add(canvasDomain);

    const allowRequestCredentials = parsed.CANVAS_ALLOW_REQUEST_CREDENTIALS === "true";
    if (allowRequestCredentials && allowedCanvasDomains.size === 0) {
        throw new Error(
            "CANVAS_ALLOW_REQUEST_CREDENTIALS=true requires CANVAS_ALLOWED_DOMAINS to prevent arbitrary outbound requests.",
        );
    }

    const host = optionalText(parsed.HOST) ?? "127.0.0.1";
    const allowedHosts = splitList(parsed.MCP_ALLOWED_HOSTS).map(normaliseHost);
    if (!isLoopbackHost(host) && allowedHosts.length === 0) {
        throw new Error("MCP_ALLOWED_HOSTS is required when HOST is not a loopback address.");
    }

    const allowedOrigins = splitList(parsed.MCP_ALLOWED_ORIGINS).map(normaliseOrigin);

    return {
        canvasApiToken,
        canvasDomain,
        allowedCanvasDomains: [...allowedCanvasDomains],
        allowRequestCredentials,
        host,
        allowedHosts,
        allowedOrigins,
        port: parsed.PORT,
        logLevel: parsed.LOG_LEVEL,
    };
}

/**
 * Resolves one complete credential pair. Header values are never mixed with
 * environment defaults, preventing a caller from redirecting a fallback token
 * to an arbitrary host.
 */
export function resolveCanvasCredentials(headers: Headers | undefined, cfg: Config): CanvasCredentials {
    const requestToken = optionalText(headers?.get("x-canvas-token") ?? undefined);
    const requestDomainRaw = optionalText(headers?.get("x-canvas-domain") ?? undefined);

    if (requestToken || requestDomainRaw) {
        if (!cfg.allowRequestCredentials) {
            throw new CanvasCredentialsError(
                "Request-scoped Canvas credentials are disabled. Configure CANVAS_API_TOKEN and CANVAS_DOMAIN, or explicitly enable a domain allowlist.",
            );
        }
        if (!requestToken || !requestDomainRaw) {
            throw new CanvasCredentialsError(
                "Send X-Canvas-Token and X-Canvas-Domain together when using request-scoped Canvas credentials.",
            );
        }

        let domain: string;
        try {
            domain = normaliseCanvasDomain(requestDomainRaw);
        } catch (error) {
            const detail = error instanceof Error ? error.message : "Invalid domain.";
            throw new CanvasCredentialsError(detail);
        }
        if (!cfg.allowedCanvasDomains.includes(domain)) {
            throw new CanvasCredentialsError("X-Canvas-Domain is not in CANVAS_ALLOWED_DOMAINS.");
        }
        return { domain, token: requestToken };
    }

    if (cfg.canvasApiToken && cfg.canvasDomain) {
        return { domain: cfg.canvasDomain, token: cfg.canvasApiToken };
    }

    throw new CanvasCredentialsError(
        "Canvas credentials missing. Configure CANVAS_API_TOKEN and CANVAS_DOMAIN, or explicitly enable request-scoped credentials.",
    );
}
