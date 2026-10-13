export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Safe error envelope: internal details stay on the server. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  }
  console.error("[api] unhandled error", error);
  return Response.json(
    { ok: false, code: "internal_error", error: "Unexpected server error." },
    { status: 500 },
  );
}

const buckets = new Map<string, number[]>();

/** Simple in-process sliding window limiter (per instance). */
export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t > windowMs)) buckets.delete(k);
  }
  if (hits.length > max) {
    const oldest = hits[0] ?? now;
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - oldest)) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

export function enforceRateLimit(key: string, max: number, windowMs: number) {
  const result = rateLimit(key, max, windowMs);
  if (!result.ok) {
    throw new HttpError(429, "rate_limited", `Too many requests. Retry in ${result.retryAfter}s.`);
  }
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${scope}:${fwd || "local"}`;
}

/** Never parse an unbounded body: protects memory on mobile devices too. */
export async function readJson<T>(req: Request, maxBytes = 512 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) {
    throw new HttpError(413, "payload_too_large", `Request body exceeds ${maxBytes} bytes.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "bad_json", "Request body must be valid JSON.");
  }
}
