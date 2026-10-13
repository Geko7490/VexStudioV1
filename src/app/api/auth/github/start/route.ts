import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { OAUTH_STATE_COOKIE, secureCookieOptions } from "@/lib/auth-cookies";
import { buildAuthorizeUrl, resolveRedirectUri } from "@/lib/github";
import { isGithubOAuthConfigured } from "@/lib/config";
import { HttpError, clientKey, enforceRateLimit, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    enforceRateLimit(clientKey(req, "oauth-start"), 20, 60_000);

    if (!isGithubOAuthConfigured()) {
      throw new HttpError(
        503,
        "oauth_not_configured",
        "GitHub OAuth is not configured on this deployment (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing).",
      );
    }

    const state = randomBytes(24).toString("base64url");
    const redirectUri = resolveRedirectUri(req);
    const store = await cookies();
    store.set(OAUTH_STATE_COOKIE, state, {
      ...secureCookieOptions(req),
      maxAge: 600,
    });

    return Response.redirect(buildAuthorizeUrl(redirectUri, state), 302);
  } catch (error) {
    if (error instanceof HttpError && error.status === 503) {
      return Response.redirect(new URL("/login?error=oauth_not_configured", req.url), 302);
    }
    return toErrorResponse(error);
  }
}
