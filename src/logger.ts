/**
 * Minimal leveled logger that writes to stderr (preserves stdout for the
 * stdio MCP transport) and redacts known-secret values.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

const SECRET_KEYS = /password|token|cookie|authorization|secret|key/i;

function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v);
  }
  return out;
}

let threshold: number = LEVELS.info;

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level] ?? LEVELS.info;
}

function emit(level: LogLevel, msg: string, meta?: unknown): void {
  if (LEVELS[level] > threshold) return;
  const line =
    meta === undefined
      ? `[${level}] ${msg}`
      : `[${level}] ${msg} ${JSON.stringify(redact(meta))}`;
  process.stderr.write(line + "\n");
}

export const logger = {
  error: (msg: string, meta?: unknown) => emit("error", msg, meta),
  warn: (msg: string, meta?: unknown) => emit("warn", msg, meta),
  info: (msg: string, meta?: unknown) => emit("info", msg, meta),
  debug: (msg: string, meta?: unknown) => emit("debug", msg, meta),
};
