import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { CSRF_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE, secureCookieOptions } from "@/lib/auth-cookies";
import { createSession, deriveRole } from "@/lib/auth";
import { getAppConfig, isGithubOAuthConfigured } from "@/lib/config";
import { exchangeCodeForToken, fetchGithubIdentity, resolveRedirectUri } from "@/lib/github";
import { audit, logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

function failRedirect(req: Request, code: string) {
  return Response.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, req.url), 302);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    if (!isGithubOAuthConfigured()) return failRedirect(req, "oauth_not_configured");

    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      await logEvent("warn", "oauth", `GitHub returned an OAuth error`, { code: oauthError });
      return failRedirect(req, oauthError);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return failRedirect(req, "missing_code_or_state");

    const store = await cookies();
    const expectedState = store.get(OAUTH_STATE_COOKIE)?.value;
    // Single use: clear the state cookie before comparing use.
    store.delete(OAUTH_STATE_COOKIE);
    if (!expectedState || expectedState !== state) {
      await audit({ action: "oauth.state.mismatch", outcome: "denied" });
      return failRedirect(req, "state_mismatch");
    }

    const accessToken = await exchangeCodeForToken(code, resolveRedirectUri(req));
    const identity = await fetchGithubIdentity(accessToken);

    const config = await getAppConfig();
    const role = deriveRole(identity.id, { githubId: config.owner.githubId, adminDisabled: config.adminDisabled });

    const [user] = await db
      .insert(users)
      .values({
        githubId: identity.id,
        login: identity.login,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
      })
      .onConflictDoUpdate({
        target: users.githubId,
        set: { login: identity.login, name: identity.name, avatarUrl: identity.avatarUrl, lastSeenAt: new Date() },
      })
      .returning({ id: users.id });

    await createSession(req, user.id);

    await audit({
      actorUserId: user.id,
      actorLogin: identity.login,
      action: "auth.login",
      outcome: "ok",
      details: { role, ownerMatch: role === "owner" },
    });
    await logEvent("info", "oauth", "Session created", { role, githubIdDigits: String(identity.id).length });

    // Never persist or log the GitHub access token: it is used once and discarded.
    void accessToken;

    return Response.redirect(new URL("/?signedIn=1", req.url), 302);
  } catch (error) {
    await logEvent("error", "oauth", `Callback failed: ${error instanceof Error ? error.message : "unknown"}`);
    const message = error instanceof Error ? error.message : "oauth_failed";
    const safeCode = /rate limit/i.test(message)
      ? "github_rate_limited"
      : /network error/i.test(message)
        ? "github_unreachable"
        : "oauth_failed";
    void SESSION_COOKIE;
    void CSRF_COOKIE;
    return failRedirect(req, safeCode);
  }
}


