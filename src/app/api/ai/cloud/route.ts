import { HttpError, clientKey, enforceRateLimit, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Explicitly separate *cloud* inference route. It is never used by the local
 * (WebLLM) path. It stays disabled unless the operator configures their own proxy.
 */
export async function POST(req: Request) {
  try {
    enforceRateLimit(clientKey(req, "ai-cloud"), 20, 60_000);
    const proxyUrl = process.env.AI_PROXY_URL?.trim();
    const proxyKey = process.env.AI_PROXY_KEY?.trim();

    if (!proxyUrl || !proxyKey) {
      throw new HttpError(
        503,
        "cloud_ai_not_configured",
        "Cloud inference is not configured on this deployment. Vex Studio does not fall back to a cloud model silently: local models keep working without it.",
      );
    }

    const body = (await req.json().catch(() => null)) as { messages?: unknown } | null;
    if (!body?.messages) throw new HttpError(400, "bad_request", "messages array is required.");

    const upstream = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${proxyKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok) {
      throw new HttpError(502, "cloud_ai_upstream_error", `Upstream responded with ${upstream.status}.`);
    }
    return new Response(upstream.body, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
