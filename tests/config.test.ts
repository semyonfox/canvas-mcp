import { describe, expect, it } from "vitest";
import {
    CanvasCredentialsError,
    loadConfig,
    normaliseCanvasDomain,
    resolveCanvasCredentials,
} from "../src/config.js";

describe("loadConfig", () => {
    it("parses and normalises an explicit Canvas deployment", () => {
        const cfg = loadConfig({
            CANVAS_API_TOKEN: "tok",
            CANVAS_DOMAIN: "https://Example.Instructure.com/",
            CANVAS_ALLOWED_DOMAINS: "school.example.edu, https://second.example.edu/",
            MCP_ALLOWED_ORIGINS: "https://app.example.test, http://localhost:5173",
            PORT: "4000",
            LOG_LEVEL: "debug",
        });

        expect(cfg).toMatchObject({
            canvasApiToken: "tok",
            canvasDomain: "example.instructure.com",
            port: 4000,
            logLevel: "debug",
            host: "127.0.0.1",
            allowRequestCredentials: false,
        });
        expect(cfg.allowedCanvasDomains).toEqual([
            "school.example.edu",
            "second.example.edu",
            "example.instructure.com",
        ]);
        expect(cfg.allowedOrigins).toEqual(["https://app.example.test", "http://localhost:5173"]);
    });

    it("defaults to a loopback listener with no Canvas credentials", () => {
        const cfg = loadConfig({});

        expect(cfg).toMatchObject({
            canvasApiToken: undefined,
            canvasDomain: undefined,
            allowedCanvasDomains: [],
            allowRequestCredentials: false,
            host: "127.0.0.1",
            allowedHosts: [],
            allowedOrigins: [],
            port: 3001,
            logLevel: "info",
        });
    });

    it("requires the default Canvas token and domain as one credential pair", () => {
        expect(() => loadConfig({ CANVAS_API_TOKEN: "tok" })).toThrow(
            "CANVAS_API_TOKEN and CANVAS_DOMAIN must be configured together",
        );
        expect(() => loadConfig({ CANVAS_DOMAIN: "school.example.edu" })).toThrow(
            "CANVAS_API_TOKEN and CANVAS_DOMAIN must be configured together",
        );
    });

    it("requires an explicit host allowlist for a non-loopback listener", () => {
        expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow("MCP_ALLOWED_HOSTS is required");

        expect(
            loadConfig({ HOST: "0.0.0.0", MCP_ALLOWED_HOSTS: "mcp.example.test, localhost" }).allowedHosts,
        ).toEqual(["mcp.example.test", "localhost"]);

        for (const malformedHost of [
            "mcp.example.test:3001",
            "https://mcp.example.test",
            "mcp.example.test/path",
            "user@mcp.example.test",
            "mcp.example.test?query=value",
        ]) {
            expect(() => loadConfig({ MCP_ALLOWED_HOSTS: malformedHost })).toThrow(
                "MCP_ALLOWED_HOSTS entries must be",
            );
        }
    });

    it("requires a Canvas tenant allowlist before accepting request credentials", () => {
        expect(() => loadConfig({ CANVAS_ALLOW_REQUEST_CREDENTIALS: "true" })).toThrow(
            "CANVAS_ALLOW_REQUEST_CREDENTIALS=true requires CANVAS_ALLOWED_DOMAINS",
        );
    });
});

describe("normaliseCanvasDomain", () => {
    it("canonicalises an HTTPS hostname without accepting a URL path", () => {
        expect(normaliseCanvasDomain("https://Example.Instructure.com./")).toBe("example.instructure.com");
        expect(normaliseCanvasDomain("school.example.edu:8443")).toBe("school.example.edu:8443");
    });

    it.each([
        "http://school.example.edu",
        "https://school.example.edu/api/v1",
        "https://user:pass@school.example.edu",
        "https://school.example.edu?tenant=other",
    ])("rejects unsafe tenant input: %s", (value) => {
        expect(() => normaliseCanvasDomain(value)).toThrow();
    });
});

describe("resolveCanvasCredentials", () => {
    const defaultConfig = () =>
        loadConfig({
            CANVAS_API_TOKEN: "default-token",
            CANVAS_DOMAIN: "default.example.edu",
        });

    it("uses the configured default pair when no request credentials are supplied", () => {
        expect(resolveCanvasCredentials(undefined, defaultConfig())).toEqual({
            domain: "default.example.edu",
            token: "default-token",
        });
    });

    it("does not allow a request header to redirect a fallback token", () => {
        const headers = new Headers({ "x-canvas-domain": "attacker.example" });

        expect(() => resolveCanvasCredentials(headers, defaultConfig())).toThrow(CanvasCredentialsError);
        expect(() => resolveCanvasCredentials(headers, defaultConfig())).toThrow(
            "Request-scoped Canvas credentials are disabled",
        );
    });

    it("requires a complete request credential pair even when a default pair exists", () => {
        const cfg = loadConfig({
            CANVAS_API_TOKEN: "default-token",
            CANVAS_DOMAIN: "default.example.edu",
            CANVAS_ALLOW_REQUEST_CREDENTIALS: "true",
        });

        expect(() =>
            resolveCanvasCredentials(new Headers({ "x-canvas-token": "other-token" }), cfg),
        ).toThrow("Send X-Canvas-Token and X-Canvas-Domain together");
    });

    it("accepts a complete request pair only for an explicitly allowlisted tenant", () => {
        const cfg = loadConfig({
            CANVAS_ALLOW_REQUEST_CREDENTIALS: "true",
            CANVAS_ALLOWED_DOMAINS: "school.example.edu",
        });

        expect(
            resolveCanvasCredentials(
                new Headers({
                    "x-canvas-token": "request-token",
                    "x-canvas-domain": "https://SCHOOL.example.edu/",
                }),
                cfg,
            ),
        ).toEqual({ domain: "school.example.edu", token: "request-token" });

        expect(() =>
            resolveCanvasCredentials(
                new Headers({
                    "x-canvas-token": "request-token",
                    "x-canvas-domain": "attacker.example",
                }),
                cfg,
            ),
        ).toThrow("X-Canvas-Domain is not in CANVAS_ALLOWED_DOMAINS");
    });
});
