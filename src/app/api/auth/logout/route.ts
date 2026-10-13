import { cookies } from "next/headers";
import { CSRF_COOKIE, SESSION_COOKIE } from "@/lib/auth-cookies";
import { destroySession, getSessionUser } from "@/lib/auth";
import { HttpError, enforceRateLimit, readJson, toErrorResponse } from "@/lib/http";
import { audit } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    enforceRateLimit("logout", 30, 60_000);
    await readJson(req, 1024).catch(() => ({}));
    const session = await getSessionUser();
    if (session) {
      const store = await cookies();
      const provided = req.headers.get("x-csrf-token");
      if (!provided || provided !== store.get(CSRF_COOKIE)?.value) {
        throw new HttpError(403, "csrf_failed", "CSRF token missing or invalid.");
      }
      await destroySession(req);
      await audit({ actorUserId: session.user.id, actorLogin: session.user.login, action: "auth.logout" });
    }
    void SESSION_COOKIE;
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
