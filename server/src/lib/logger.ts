type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

const SECRET_KEYS = /token|secret|password|authorization|verifier|cookie/i;

function redact(meta?: Record<string, unknown>) {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v instanceof Error ? v.message : v;
  }
  return out;
}

/** Log estruturado em JSON (uma linha por evento), pronto para agregadores. Segredos são mascarados. */
function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (order[level] < min || process.env.SILENT_LOGS) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...redact(meta) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => log("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
};
