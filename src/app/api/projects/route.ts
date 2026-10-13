import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectVersions, projects } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { enforceRateLimit, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    enforceRateLimit("projects-list", 120, 60_000);
    await ensureSeeded();
    const url = new URL(req.url);
    const category = url.searchParams.get("category");
    const includeArchived = url.searchParams.get("includeArchived") === "1";

    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        category: projects.category,
        kind: projects.kind,
        runtimes: projects.runtimes,
        dependencies: projects.dependencies,
        entryFile: projects.entryFile,
        manifest: projects.manifest,
        testSummary: projects.testSummary,
        docsUrl: projects.docsUrl,
        status: projects.status,
        latestVersion: projects.latestVersion,
        latestCommitSha: projects.latestCommitSha,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(includeArchived ? undefined : eq(projects.status, "published"))
      .orderBy(desc(projects.updatedAt));

    const versions = await db
      .select({
        projectId: projectVersions.projectId,
        version: projectVersions.version,
        commitSha: projectVersions.commitSha,
        createdAt: projectVersions.createdAt,
        githubVerified: projectVersions.githubVerified,
        publishState: projectVersions.publishState,
        active: projectVersions.active,
      })
      .from(projectVersions)
      .where(and(eq(projectVersions.active, true)))
      .orderBy(desc(projectVersions.createdAt));

    const filtered = category && category !== "all" ? rows.filter((r) => r.category === category) : rows;

    return Response.json({
      ok: true,
      projects: filtered.map((row) => ({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
        versionHistory: versions.filter((v) => v.projectId === row.id).map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
      })),
      categories: [...new Set(rows.map((r) => r.category))],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
