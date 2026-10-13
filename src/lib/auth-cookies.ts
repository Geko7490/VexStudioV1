import { cookies } from "next/headers";

export const SESSION_COOKIE = "vex_session";
export const CSRF_COOKIE = "vex_csrf";
export const OAUTH_STATE_COOKIE = "vex_oauth_state";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

/** Cookies are only marked Secure when the request actually arrived over HTTPS. */
export function secureCookieOptions(req: Request) {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const secure = proto ? proto === "https" : new URL(req.url).protocol === "https:";
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
}
