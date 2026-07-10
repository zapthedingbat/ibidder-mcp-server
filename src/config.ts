import { z } from "zod";
import type { LogLevel } from "./logger.js";

const boolFromEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return def;
      return /^(1|true|yes|on)$/i.test(v.trim());
    });

const envSchema = z.object({
  CAMOFOX_URL: z.string().url().default("http://camofox.internal:9377"),
  CAMOFOX_ACCESS_KEY: z.string().min(1).optional(),
  CAMOFOX_USER_ID: z.string().min(1).default("ibidder"),
  IBIDDER_POSTCODE: z.string().min(1).optional(),
  MCP_TRANSPORT: z.enum(["http", "stdio"]).default("http"),
  PORT: z.coerce.number().int().positive().default(3000),
  MCP_AUTH_TOKEN: z.string().optional(),
  MCP_ALLOWED_HOSTS: z.string().optional(),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
});

export interface Config {
  camofoxUrl: string;
  camofoxAccessKey?: string;
  camofoxUserId: string;
  postcode?: string;
  transport: "http" | "stdio";
  port: number;
  authToken?: string;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  logLevel: LogLevel;
}

const splitList = (v?: string): string[] | undefined =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

export function loadConfig(argv: string[] = process.argv.slice(2)): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const env = parsed.data;

  let transport = env.MCP_TRANSPORT;
  const flagIdx = argv.indexOf("--transport");
  if (flagIdx !== -1 && argv[flagIdx + 1]) {
    const v = argv[flagIdx + 1];
    if (v !== "http" && v !== "stdio") {
      throw new Error(`--transport must be "http" or "stdio", got "${v}"`);
    }
    transport = v;
  }

  const config: Config = {
    camofoxUrl: env.CAMOFOX_URL.replace(/\/+$/, ""),
    camofoxAccessKey: env.CAMOFOX_ACCESS_KEY,
    camofoxUserId: env.CAMOFOX_USER_ID,
    postcode: env.IBIDDER_POSTCODE,
    transport,
    port: env.PORT,
    authToken: env.MCP_AUTH_TOKEN,
    allowedHosts: splitList(env.MCP_ALLOWED_HOSTS),
    allowedOrigins: splitList(env.MCP_ALLOWED_ORIGINS),
    logLevel: env.LOG_LEVEL,
  };

  if (transport === "http" && !config.authToken) {
    throw new Error(
      "MCP_AUTH_TOKEN is required when MCP_TRANSPORT=http (the HTTP endpoint must be authenticated).",
    );
  }

  return config;
}
