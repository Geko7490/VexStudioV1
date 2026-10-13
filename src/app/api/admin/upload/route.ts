import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectFiles, projectVersions, projects } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { HttpError, clientKey, enforceRateLimit, toErrorResponse } from "@/lib/http";
import { audit, logEvent } from "@/lib/log";
import { slugifyId, buildManifest, runStaticChecks, type ProjectFile } from "@/lib/project-analyze";
import { MAX_ZIP_BYTES, scanZip } from "@/lib/zip-safe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type UploadReport = {
  ok: boolean;
  stage: "received" | "validation" | "duplicate" | "stored";
  projectId: string | null;
  version: string | null;
  versionId: string | null;
  issues: { severity: "error" | "warning"; code: string; message: string }[];
  checks: ReturnType<typeof runStaticChecks>["checks"];
  summary: "pass" | "warn" | "fail";
  manifest: ReturnType<typeof buildManifest> | null;
  contentHash: string | null;
  duplicateOfVersion: string | null;
  projectStatus: string | null;
};

function bumpVersion(version: string | null): string {
  if (!version) return "1.0.0";
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return "1.0.0";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export async function POST(req: Request) {
  try {
    const { user } = await requireOwner(req);
    enforceRateLimit(clientKey(req, "admin-upload"), 12, 60_000);

    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_ZIP_BYTES + 128 * 1024) {
      throw new HttpError(413, "payload_too_large", `Upload exceeds the ${MAX_ZIP_BYTES / 1024 / 1024} MB limit.`);
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "bad_request", "A ZIP file field named 'file' is required.");
    if (file.size > MAX_ZIP_BYTES) {
      throw new HttpError(413, "payload_too_large", `ZIP is ${file.size} bytes; limit is ${MAX_ZIP_BYTES} bytes.`);
    }

    const declaredProjectId = String(form.get("projectId") ?? "").trim();
    const declaredVersion = String(form.get("version") ?? "").trim();
    const name = String(form.get("name") ?? "").trim() || file.name.replace(/\.zip$/i, "");
    const description = String(form.get("description") ?? "").trim();
    const category = String(form.get("category") ?? "general").trim() || "general";
    const changelog = String(form.get("changelog") ?? "").trim();

    const report: UploadReport = {
      ok: false,
      stage: "received",
      projectId: declaredProjectId || slugifyId(name),
      version: null,
      versionId: null,
      issues: [],
      checks: [],
      summary: "fail",
      manifest: null,
      contentHash: null,
      duplicateOfVersion: null,
      projectStatus: null,
    };

    const data = new Uint8Array(await file.arrayBuffer());
    const scan = await scanZip(data);
    report.issues = scan.issues;

    if (!scan.ok) {
      report.stage = "validation";
      await audit({
        actorUserId: user.id,
        actorLogin: user.login,
        action: "project.upload.rejected",
        target: report.projectId ?? "",
        outcome: "error",
        details: { issues: scan.issues.map((i) => i.code) },
      });
      return Response.json({ ok: false, report }, { status: 200 });
    }

    const files: ProjectFile[] = scan.files;
    const checks = runStaticChecks(files);
    report.checks = checks.checks;
    report.summary = checks.summary;

    const contentHash = createHash("sha256")
      .update(files.map((f) => `${f.path}\u0000${f.content}`).join("\u0001"))
      .digest("hex");
    report.contentHash = contentHash;

    const manifest = buildManifest({
      id: report.projectId ?? "project",
      name,
      description,
      version: declaredVersion || "1.0.0",
      files,
    });
    report.manifest = manifest;

    const projectId = report.projectId as string;
    const [existing] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    if (existing) {
      const [latest] = await db
        .select()
        .from(projectVersions)
        .where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.active, true)))
        .orderBy(desc(projectVersions.createdAt))
        .limit(1);
      if (latest && latest.contentHash === contentHash) {
        report.stage = "duplicate";
        report.duplicateOfVersion = latest.version;
        report.version = latest.version;
        report.versionId = latest.id;
        report.projectStatus = existing.status;
        report.ok = true;
        await logEvent("info", "admin", "Duplicate upload skipped", { projectId, version: latest.version });
        return Response.json({ ok: true, report });
      }
      report.version = declaredVersion || bumpVersion(existing.latestVersion);
    } else {
      report.version = declaredVersion || "1.0.0";
    }

    manifest.version = report.version;
    manifest.testStatus = checks.summary === "fail" ? "fail" : "pass";

    const [versionRow] = await db
      .insert(projectVersions)
      .values({
        projectId,
        version: report.version,
        changelog: changelog || `Uploaded ${name} ${report.version}`,
        fileCount: files.length,
        totalBytes: manifest.totalBytes,
        manifest: manifest as unknown as Record<string, unknown>,
        testSummary: { summary: checks.summary, checks: checks.checks } as unknown as Record<string, unknown>,
        publishState: "stored",
        githubVerified: false,
        active: false,
        contentHash,
        createdBy: user.id,
      })
      .returning({ id: projectVersions.id });

    await db.insert(projectFiles).values(
      files.map((f) => ({
        versionId: versionRow.id,
        path: f.path,
        content: f.content,
        size: new TextEncoder().encode(f.content).length,
      })),
    );

    if (existing) {
      await db
        .update(projects)
        .set({ description, category, kind: manifest.kind, runtimes: manifest.runtimes, dependencies: manifest.dependencies, entryFile: manifest.entryFile, manifest: manifest as unknown as Record<string, unknown>, testSummary: { summary: checks.summary, checks: checks.checks } as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      report.projectStatus = existing.status;
    } else {
      await db.insert(projects).values({
        id: projectId,
        name,
        description,
        category,
        kind: manifest.kind,
        runtimes: manifest.runtimes,
        dependencies: manifest.dependencies,
        entryFile: manifest.entryFile,
        manifest: manifest as unknown as Record<string, unknown>,
        testSummary: { summary: checks.summary, checks: checks.checks } as unknown as Record<string, unknown>,
        repositoryPath: `projects/${projectId}`,
        status: "draft",
      });
      report.projectStatus = "draft";
    }

    report.stage = "stored";
    report.ok = true;
    report.versionId = versionRow.id;

    await audit({
      actorUserId: user.id,
      actorLogin: user.login,
      action: "project.upload",
      target: `${projectId}@${report.version}`,
      details: { files: files.length, bytes: manifest.totalBytes, checks: checks.summary },
    });

    return Response.json({ ok: true, report });
  } catch (error) {
    return toErrorResponse(error);
  }
}
