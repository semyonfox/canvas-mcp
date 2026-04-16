import { z } from "zod";

const envSchema = z.object({
  CANVAS_API_TOKEN: z.string().min(1),
  CANVAS_DOMAIN: z.string().min(1),
  PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number.parseInt(v, 10) : 3001))
    .pipe(z.number().int().positive()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface Config {
  canvasApiToken: string;
  canvasDomain: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  const domain = parsed.CANVAS_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return {
    canvasApiToken: parsed.CANVAS_API_TOKEN,
    canvasDomain: domain,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
  };
}
