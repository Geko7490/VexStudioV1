import { db } from "@/db";
import { auditLogs, serverLogs } from "@/db/schema";

const SECRET_KEY = /(token|secret|password|passwd|authorization|cookie|api[-_]?key|private[-_]?key)/i;

/** Removes anything that looks like a credential before it can reach the log table. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > 2000 ? `${value.slice(0, 2000)}…[+${value.length - 2000}]` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

type Level = "debug" | "info" | "warn" | "error";

export async function logEvent(
  level: Level,
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  try {
    await db.insert(serverLogs).values({
      level,
      scope,
      message: message.slice(0, 1000),
      meta: (redact(meta ?? {}) as Record<string, unknown>) ?? {},
    });
  } catch {
    // Logging must never break the request path; console only, no secrets.
    if (level === "error") console.error(`[${scope}] ${message}`);
  }
}

export async function audit(entry: {
  actorUserId?: string | null;
  actorLogin?: string | null;
  action: string;
  target?: string;
  outcome?: "ok" | "denied" | "error";
  details?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      actorUserId: entry.actorUserId ?? null,
      actorLogin: entry.actorLogin ?? null,
      action: entry.action,
      target: entry.target ?? "",
      outcome: entry.outcome ?? "ok",
      details: (redact(entry.details ?? {}) as Record<string, unknown>) ?? {},
    });
  } catch {
    if (entry.outcome === "denied") console.warn(`audit denied: ${entry.action}`);
  }
}
