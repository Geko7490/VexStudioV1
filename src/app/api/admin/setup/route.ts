import { timingSafeEqual } from "node:crypto";
import { getSessionUser, requireOwner } from "@/lib/auth";
import { CONFIG_KEYS, getAppConfig, isSetupSecretConfigured, setConfigValue, deleteConfigValue } from "@/lib/config";
import { HttpError, clientKey, enforceRateLimit, readJson, toErrorResponse } from "@/lib/http";
import { audit } from "@/lib/log";

export const dynamic = "force-dynamic";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  try {
    enforceRateLimit(clientKey(req, "setup-status"), 60, 60_000);
    const config = await getAppConfig();
    const session = await getSessionUser();
    return Response.json({
      ok: true,
      ownerConfigured: config.owner.githubId !== null,
      ownerSource: config.owner.source,
      ownerLogin: config.owner.login,
      adminDisabled: config.adminDisabled,
      setupSecretConfigured: isSetupSecretConfigured(),
      setupCompletedAt: config.setupCompletedAt,
      signedIn: session !== null,
      role: session?.role ?? "guest",
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * One-time, secret-protected provisioning of the owner account id.
 * The token comes from ADMIN_SETUP_TOKEN and is never exposed to the client.
 */
export async function POST(req: Request) {
  try {
    enforceRateLimit(clientKey(req, "setup"), 10, 10 * 60_000);
    const body = await readJson<{ setupToken?: string; ownerGithubId?: number; ownerLogin?: string }>(req, 8192);

    const expected = process.env.ADMIN_SETUP_TOKEN?.trim();
    if (!expected) throw new HttpError(503, "setup_secret_missing", "ADMIN_SETUP_TOKEN is not set on the server, so the setup wizard is disabled.");
    if (!body.setupToken || !tokenMatches(body.setupToken, expected)) {
      await audit({ action: "setup.attempt.denied", outcome: "denied" });
      throw new HttpError(403, "invalid_setup_token", "The setup secret does not match.");
    }

    const config = await getAppConfig();
    if (config.owner.source === "env") {
      throw new HttpError(409, "owner_from_env", "OWNER_GITHUB_ID is set as an environment variable and always takes precedence.");
    }
    if (config.owner.source === "database") {
      // Already provisioned: only an authenticated owner may change it.
      const { user } = await requireOwner(req);
      await audit({ actorUserId: user.id, actorLogin: user.login, action: "setup.owner.transfer" });
    }

    const githubId = Number(body.ownerGithubId);
    if (!Number.isInteger(githubId) || githubId <= 0) {
      throw new HttpError(400, "invalid_github_id", "ownerGithubId must be the numeric GitHub account id (not the username).");
    }

    await setConfigValue(CONFIG_KEYS.owner, { githubId, login: body.ownerLogin ?? null });
    await deleteConfigValue(CONFIG_KEYS.adminDisabled);
    await setConfigValue(CONFIG_KEYS.setup, { completedAt: new Date().toISOString() });

    await audit({ action: "setup.owner.provisioned", target: `github:${String(githubId).length} digits`, details: { login: body.ownerLogin ?? null } });
    return Response.json({ ok: true, ownerGithubId: githubId, ownerLogin: body.ownerLogin ?? null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
