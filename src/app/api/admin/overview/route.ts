import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, modBackups, projectVersions, projects, serverLogs, sessions, users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { getAppConfig, githubPublishTarget, isGithubOAuthConfigured, isSetupSecretConfigured } from "@/lib/config";
import { enforceRateLimit, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { user } = await requireOwner(req);
    enforceRateLimit("admin-overview", 120, 60_000);

    const config = await getAppConfig();
    const [counts] = await db
      .select({
        projects: sql<number>`(select count(*)::int from ${projects})`,
        versions: sql<number>`(select count(*)::int from ${projectVersions})`,
        users: sql<number>`(select count(*)::int from ${users})`,
        sessions: sql<number>`(select count(*)::int from ${sessions} where expires_at > now())`,
        modBackups: sql<number>`(select count(*)::int from ${modBackups})`,
      })
      .from(sql`(select 1) as t`);

    const auditRows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(25);
    const logRows = await db.select().from(serverLogs).orderBy(desc(serverLogs.createdAt)).limit(25);

    return Response.json({
      ok: true,
      actor: { login: user.login, githubId: user.githubId, role: "owner" },
      config: {
        ownerGithubId: config.owner.githubId,
        ownerLogin: config.owner.login,
        ownerSource: config.owner.source,
        adminDisabled: config.adminDisabled,
        setupCompletedAt: config.setupCompletedAt,
        oauthConfigured: isGithubOAuthConfigured(),
        githubPublishConfigured: Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO),
        publishTarget: githubPublishTarget(),
        setupSecretConfigured: isSetupSecretConfigured(),
      },
      counts,
      audit: auditRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      logs: logRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      contentHashAlgorithm: "sha256",
      uploadLimits: { maxZipBytes: 30 * 1024 * 1024, maxFiles: 1200, maxSingleFile: 2 * 1024 * 1024 },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireOwner(req);
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    const hash = createHash("sha256").update(body.action ?? "").digest("hex").slice(0, 12);
    return Response.json({ ok: true, echo: body.action ?? null, hash });
  } catch (error) {
    return toErrorResponse(error);
  }
}
