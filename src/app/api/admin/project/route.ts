import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectFiles, projectVersions, projects } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { githubPublishTarget, isGithubPublishConfigured } from "@/lib/config";
import { HttpError, clientKey, enforceRateLimit, readJson, toErrorResponse } from "@/lib/http";
import { audit, logEvent } from "@/lib/log";
import { publishFilesToGithub } from "@/lib/github";

export const dynamic = "force-dynamic";

type ActionBody = {
  action: "publish" | "publish_github" | "archive" | "restore" | "delete" | "rollback";
  projectId: string;
  versionId?: string;
  confirm?: string;
};

export async function GET(req: Request) {
  try {
    await requireOwner(req);
    enforceRateLimit(clientKey(req, "admin-list"), 120, 60_000);
    const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
    const versions = await db.select().from(projectVersions).orderBy(desc(projectVersions.createdAt));
    return Response.json({
      ok: true,
      projects: rows.map((p) => ({
        ...p,
        updatedAt: p.updatedAt.toISOString(),
        createdAt: p.createdAt.toISOString(),
        versions: versions
          .filter((v) => v.projectId === p.id)
          .map((v) => ({
            id: v.id,
            version: v.version,
            commitSha: v.commitSha,
            active: v.active,
            publishState: v.publishState,
            githubVerified: v.githubVerified,
            fileCount: v.fileCount,
            totalBytes: v.totalBytes,
            contentHash: v.contentHash,
            createdAt: v.createdAt.toISOString(),
            changelog: v.changelog,
            publishError: v.publishError,
          })),
      })),
      github: { configured: isGithubPublishConfigured(), target: githubPublishTarget() },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireOwner(req);
    enforceRateLimit(clientKey(req, "admin-action"), 60, 60_000);
    const body = await readJson<ActionBody>(req);
    if (!body.action || !body.projectId) throw new HttpError(400, "bad_request", "action and projectId are required.");

    const [project] = await db.select().from(projects).where(eq(projects.id, body.projectId)).limit(1);
    if (!project) throw new HttpError(404, "not_found", "Project not found.");

    switch (body.action) {
      case "publish": {
        const versionId = body.versionId;
        if (!versionId) throw new HttpError(400, "bad_request", "versionId is required to publish a version.");
        const [version] = await db
          .select()
          .from(projectVersions)
          .where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, project.id)))
          .limit(1);
        if (!version) throw new HttpError(404, "not_found", "Version not found for this project.");

        await db.update(projectVersions).set({ active: false }).where(eq(projectVersions.projectId, project.id));
        await db.update(projectVersions).set({ active: true }).where(eq(projectVersions.id, version.id));
        await db
          .update(projects)
          .set({
            status: "published",
            latestVersion: version.version,
            latestVersionId: version.id,
            latestCommitSha: version.commitSha,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id));

        await audit({ actorUserId: user.id, actorLogin: user.login, action: "project.publish", target: `${project.id}@${version.version}` });
        return Response.json({ ok: true, action: "publish", projectId: project.id, version: version.version });
      }

      case "publish_github": {
        if (!isGithubPublishConfigured()) {
          throw new HttpError(
            503,
            "github_not_configured",
            "GitHub publishing is not configured (GITHUB_TOKEN / GITHUB_REPO missing). The version stays stored in the catalogue.",
          );
        }
        if (!body.versionId) throw new HttpError(400, "bad_request", "versionId is required.");
        const [version] = await db
          .select()
          .from(projectVersions)
          .where(and(eq(projectVersions.id, body.versionId), eq(projectVersions.projectId, project.id)))
          .limit(1);
        if (!version) throw new HttpError(404, "not_found", "Version not found.");

        const files = await db
          .select({ path: projectFiles.path, content: projectFiles.content })
          .from(projectFiles)
          .where(eq(projectFiles.versionId, version.id));

        try {
          const result = await publishFilesToGithub({
            files,
            message: `Vex Studio: publish ${project.id} ${version.version}`,
          });
          const verified = result.verified.every((v) => v.ok);
          await db
            .update(projectVersions)
            .set({ commitSha: result.commitSha, publishState: "github", githubVerified: verified, publishError: verified ? null : "Remote content check failed for some paths" })
            .where(eq(projectVersions.id, version.id));
          await db.update(projects).set({ latestCommitSha: result.commitSha, updatedAt: new Date() }).where(eq(projects.id, project.id));

          await audit({
            actorUserId: user.id,
            actorLogin: user.login,
            action: "project.publish_github",
            target: `${project.id}@${version.version}`,
            details: { commitSha: result.commitSha, verified },
          });
          return Response.json({ ok: true, action: "publish_github", commitSha: result.commitSha, verified, verifiedPaths: result.verified, htmlUrl: result.htmlUrl });
        } catch (error) {
          const message = error instanceof Error ? error.message : "GitHub publish failed";
          await db.update(projectVersions).set({ publishError: message }).where(eq(projectVersions.id, version.id));
          await audit({ actorUserId: user.id, actorLogin: user.login, action: "project.publish_github", target: project.id, outcome: "error" });
          throw new HttpError(502, "github_publish_failed", message);
        }
      }

      case "archive": {
        await db.update(projects).set({ status: "archived", updatedAt: new Date() }).where(eq(projects.id, project.id));
        await audit({ actorUserId: user.id, actorLogin: user.login, action: "project.archive", target: project.id });
        return Response.json({ ok: true, action: "archive", status: "archived" });
      }

      case "restore": {
        await db.update(projects).set({ status: "published", updatedAt: new Date() }).where(eq(projects.id, project.id));
        await audit({ actorUserId: user.id, actorLogin: user.login, action: "project.restore", target: project.id });
        return Response.json({ ok: true, action: "restore", status: "published" });
      }

      case "rollback": {
        if (!body.versionId) throw new HttpError(400, "bad_request", "versionId of the target version is required.");
        const versions = await db
          .select()
          .from(projectVersions)
          .where(eq(projectVersions.projectId, project.id))
          .orderBy(desc(projectVersions.createdAt));
        const target = versions.find((v) => v.id === body.versionId);
        if (!target) throw new HttpError(404, "not_found", "Rollback target not found.");

        await db.update(projectVersions).set({ active: false }).where(eq(projectVersions.projectId, project.id));
        await db.update(projectVersions).set({ active: true }).where(eq(projectVersions.id, target.id));
        await db
          .update(projects)
          .set({ latestVersion: target.version, latestVersionId: target.id, latestCommitSha: target.commitSha, status: "published", updatedAt: new Date() })
          .where(eq(projects.id, project.id));

        await audit({ actorUserId: user.id, actorLogin: user.login, action: "project.rollback", target: `${project.id}@${target.version}` });
        return Response.json({ ok: true, action: "rollback", version: target.version });
      }

      case "delete": {
        if (body.confirm !== project.id) {
          throw new HttpError(400, "confirm_required", `Type the project id "${project.id}" to confirm deletion. This removes every version and is not reversible.`);
        }
        await logEvent("warn", "admin", "Project deleted", { projectId: project.id, versions: project.latestVersion });
        await audit({ actorUserId: user.id, actorLogin: user.login, action: "project.delete", target: project.id, outcome: "ok" });
        await db.delete(projects).where(eq(projects.id, project.id));
        return Response.json({ ok: true, action: "delete", reversible: false });
      }

      default:
        throw new HttpError(400, "unknown_action", `Unknown action "${body.action}".`);
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
