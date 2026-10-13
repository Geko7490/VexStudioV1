import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { getAppConfig, isGithubOAuthConfigured, type AppConfig } from "./config";
import { HttpError } from "./http";
import { audit } from "./log";
import { CSRF_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, secureCookieOptions } from "./auth-cookies";

export { CSRF_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE, SESSION_TTL_MS } from "./auth-cookies";

export type Role = import("./roles").Role;

export type SessionUser = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type SessionView = {
  authenticated: boolean;
  role: Role;
  user: SessionUser | null;
  csrfToken: string | null;
  deployment: {
    oauthConfigured: boolean;
    ownerConfigured: boolean;
    adminDisabled: boolean;
    ownerLogin: string | null;
    ownerSource: "env" | "database" | "none";
  };
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

import { deriveRole } from "./roles";

export { deriveRole } from "./roles";

/** Role is derived on every request from trusted configuration, never from the client. */

export async function createSession(req: Request, userId: string): Promise<{ csrfToken: string }> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    csrfToken,
    userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
    expiresAt,
  });

  const store = await cookies();
  const base = secureCookieOptions(req);
  store.set(SESSION_COOKIE, token, { ...base, expires: expiresAt });
  // Readable by the app so it can echo the token back in a header (double submit).
  store.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: base.sameSite,
    secure: base.secure,
    path: "/",
    expires: expiresAt,
  });
  store.delete(OAUTH_STATE_COOKIE);
  return { csrfToken };
}

export async function destroySession(req: Request): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
  void req;
}

export async function getSessionUser(): Promise<{ user: SessionUser; role: Role; csrfToken: string } | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      userId: users.id,
      githubId: users.githubId,
      login: users.login,
      name: users.name,
      avatarUrl: users.avatarUrl,
      csrfToken: sessions.csrfToken,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const config = await getAppConfig();
  return {
    user: {
      id: row.userId,
      githubId: Number(row.githubId),
      login: row.login,
      name: row.name,
      avatarUrl: row.avatarUrl,
    },
    role: deriveRole(Number(row.githubId), { githubId: config.owner.githubId, adminDisabled: config.adminDisabled }),
    csrfToken: row.csrfToken,
  };
}

export async function getSessionView(): Promise<SessionView> {
  const session = await getSessionUser();
  const config = await getAppConfig();
  return {
    authenticated: session !== null,
    role: session?.role ?? "guest",
    user: session?.user ?? null,
    csrfToken: session?.csrfToken ?? null,
    deployment: {
      oauthConfigured: isGithubOAuthConfigured(),
      ownerConfigured: config.owner.githubId !== null,
      adminDisabled: config.adminDisabled,
      ownerLogin: config.owner.login,
      ownerSource: config.owner.source,
    },
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Double-submit CSRF check for every mutating request. */
export async function assertCsrf(req: Request, expected: string) {
  const provided = req.headers.get("x-csrf-token");
  if (!provided || !constantTimeEqual(provided, expected)) {
    throw new HttpError(403, "csrf_failed", "CSRF token missing or invalid. Reload the page and try again.");
  }
}

/**
 * Server-side admin gate. Applied on every admin route, not just in the UI.
 * Denials are written to the audit log.
 */
export async function requireOwner(req: Request): Promise<{ user: SessionUser; csrfToken: string }> {
  const session = await getSessionUser();
  if (!session) {
    throw new HttpError(401, "unauthenticated", "Sign in with GitHub to use administrative APIs.");
  }
  const config = await getAppConfig();
  if (config.owner.githubId === null) {
    throw new HttpError(
      503,
      "admin_not_configured",
      "OWNER_GITHUB_ID is not configured on this deployment, so no account can hold admin rights.",
    );
  }
  if (config.adminDisabled) {
    throw new HttpError(503, "admin_disabled", "Administrator privileges are disabled in server configuration.");
  }
  if (session.role !== "owner") {
    await audit({
      actorUserId: session.user.id,
      actorLogin: session.user.login,
      action: "admin.access.denied",
      outcome: "denied",
      details: { path: new URL(req.url).pathname },
    });
    throw new HttpError(403, "forbidden", "This account does not have administrator rights.");
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    await assertCsrf(req, session.csrfToken);
  }
  return { user: session.user, csrfToken: session.csrfToken };
}
