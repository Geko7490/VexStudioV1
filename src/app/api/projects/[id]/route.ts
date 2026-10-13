import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectFiles, projectVersions, projects } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { HttpError, enforceRateLimit, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    enforceRateLimit("project-detail", 120, 60_000);
    await ensureSeeded();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const wantFiles = url.searchParams.get("files") !== "0";
    const requestedVersion = url.searchParams.get("version");

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.status, "published")))
      .limit(1);
    if (!project) throw new HttpError(404, "not_found", "Project is not in the published catalogue.");

    const versions = await db
      .select({
        id: projectVersions.id,
        version: projectVersions.version,
        commitSha: projectVersions.commitSha,
        createdAt: projectVersions.createdAt,
        changelog: projectVersions.changelog,
        publishState: projectVersions.publishState,
        githubVerified: projectVersions.githubVerified,
        active: projectVersions.active,
        fileCount: projectVersions.fileCount,
        totalBytes: projectVersions.totalBytes,
      })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, id))
      .orderBy(desc(projectVersions.createdAt));

    const target = requestedVersion ? versions.find((v) => v.version === requestedVersion) : versions.find((v) => v.active) ?? versions[0];
    if (!target) throw new HttpError(404, "no_version", "Project has no published version.");

    const files = wantFiles
      ? (await db.select({ path: projectFiles.path, content: projectFiles.content }).from(projectFiles).where(eq(projectFiles.versionId, target.id))).sort((a, b) =>
          a.path.localeCompare(b.path),
        )
      : [];

    return Response.json({
      ok: true,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        category: project.category,
        kind: project.kind,
        runtimes: project.runtimes,
        dependencies: project.dependencies,
        entryFile: project.entryFile,
        manifest: project.manifest,
        testSummary: project.testSummary,
        docsUrl: project.docsUrl,
        latestVersion: project.latestVersion,
        latestCommitSha: project.latestCommitSha,
        repositoryPath: project.repositoryPath,
        updatedAt: project.updatedAt.toISOString(),
      },
      version: { ...target, createdAt: target.createdAt.toISOString() },
      versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
      files,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
