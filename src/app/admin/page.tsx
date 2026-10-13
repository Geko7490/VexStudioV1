"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { formatBytes } from "@/lib/ai/models";

type Overview = {
  ok: boolean;
  code?: string;
  error?: string;
  actor: { login: string; githubId: number; role: string };
  config: {
    ownerGithubId: number | null;
    ownerLogin: string | null;
    ownerSource: string;
    adminDisabled: boolean;
    setupCompletedAt: string | null;
    oauthConfigured: boolean;
    githubPublishConfigured: boolean;
    publishTarget: { repo: string; branch: string } | null;
    setupSecretConfigured: boolean;
  };
  counts: { projects: number; versions: number; users: number; sessions: number; modBackups: number };
  audit: { id: number; action: string; target: string; outcome: string; actorLogin: string | null; createdAt: string }[];
  logs: { id: number; level: string; scope: string; message: string; createdAt: string }[];
  uploadLimits: { maxZipBytes: number; maxFiles: number; maxSingleFile: number };
};

type AdminProject = {
  id: string;
  name: string;
  status: string;
  kind: string;
  latestVersion: string | null;
  latestCommitSha: string | null;
  updatedAt: string;
  versions: {
    id: string;
    version: string;
    commitSha: string | null;
    active: boolean;
    publishState: string;
    githubVerified: boolean;
    fileCount: number;
    totalBytes: number;
    contentHash: string;
    createdAt: string;
    changelog: string;
    publishError: string | null;
  }[];
};

type UploadReport = {
  ok: boolean;
  stage: string;
  projectId: string | null;
  version: string | null;
  versionId: string | null;
  issues: { severity: string; code: string; message: string }[];
  checks: { id: string; title: string; status: string; detail: string }[];
  summary: string;
  manifest: { fileCount: number; totalBytes: number; kind: string; entryFile: string | null; dependencies: string[] } | null;
  contentHash: string | null;
  duplicateOfVersion: string | null;
  projectStatus: string | null;
};

export default function AdminPage() {
  const { session, loading } = useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [denied, setDenied] = useState<string | null>(null);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ projectId: "", name: "", description: "", category: "general", version: "", changelog: "" });
  const [file, setFile] = useState<File | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ projectId: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [overviewRes, projectsRes] = await Promise.all([fetch("/api/admin/overview", { cache: "no-store" }), fetch("/api/admin/project", { cache: "no-store" })]);
      const overviewData = (await overviewRes.json()) as Overview;
      const projectsData = (await projectsRes.json()) as { ok: boolean; error?: string; code?: string; projects?: AdminProject[] };

      if (!overviewRes.ok) {
        setDenied(`${overviewData.code ?? overviewRes.status}: ${overviewData.error ?? "Request rejected"}`);
        setOverview(null);
      } else {
        setDenied(null);
        setOverview(overviewData);
      }
      if (!projectsRes.ok) {
        setError(projectsData.error ?? "Project list unavailable");
      } else {
        setProjects(projectsData.projects ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin API unreachable");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loading) void load();
  }, [loading, load]);

  const upload = useCallback(async () => {
    if (!file) {
      setError("Choose a ZIP file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("projectId", form.projectId);
      body.set("name", form.name);
      body.set("description", form.description);
      body.set("category", form.category);
      body.set("version", form.version);
      body.set("changelog", form.changelog);
      const res = await fetch("/api/admin/upload", { method: "POST", body, headers: { "x-csrf-token": session?.csrfToken ?? "" } });
      const data = (await res.json()) as { ok: boolean; report?: UploadReport; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (data.report) {
        setReport(data.report);
        setNotice(
          data.report.stage === "duplicate"
            ? `Identical content already published as v${data.report.duplicateOfVersion}; no duplicate version was created.`
            : `Version stored as ${data.report.projectId}@${data.report.version}. Publishing is a separate step.`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [file, form, session?.csrfToken, load]);

  const action = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/project", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": session?.csrfToken ?? "" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok: boolean; error?: string; commitSha?: string; verified?: boolean; htmlUrl?: string | null };
        if (!res.ok) throw new Error(data.error ?? "Action failed");
        setNotice(
          data.commitSha
            ? `GitHub commit ${data.commitSha.slice(0, 10)} created${data.verified ? " and remote content verified" : " but verification failed"}.`
            : "Action completed.",
        );
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setBusy(false);
      }
    },
    [session?.csrfToken, load],
  );

  if (loading) return <p className="muted text-sm">Checking session…</p>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Admin Panel</h1>
        {session?.role === "owner" ? <span className="badge badge-ok">owner session</span> : <span className="badge badge-danger">not authorised</span>}
        <button type="button" className="btn btn-sm ml-auto" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </div>

      {denied ? (
        <div className="card mt-3 p-4 text-sm">
          <p className="badge badge-danger block whitespace-normal text-left">Access denied — {denied}</p>
          <p className="muted mt-2 text-xs">
            The server rejected this request before returning any data. Hiding the menu item is not the security boundary: the API itself enforces the owner id from
            <span className="mono"> OWNER_GITHUB_ID</span>.
          </p>
          {!session?.authenticated ? (
            <Link href="/login" className="btn btn-sm mt-3">
              Sign in with GitHub
            </Link>
          ) : null}
        </div>
      ) : null}

      {overview ? (
        <>
          <div className="card mt-3 p-3 text-xs">
            <h2 className="text-sm font-semibold">Deployment configuration</h2>
            <ul className="muted mt-1 space-y-0.5">
              <li>Owner GitHub id: {overview.config.ownerGithubId ?? "not configured"} (source: {overview.config.ownerSource})</li>
              <li>Owner login label: {overview.config.ownerLogin ?? "—"}</li>
              <li>Admin privileges: {overview.config.adminDisabled ? "disabled by configuration" : "enabled"}</li>
              <li>GitHub OAuth: {overview.config.oauthConfigured ? "configured" : "not configured"}</li>
              <li>
                GitHub publishing: {overview.config.githubPublishConfigured ? `configured for ${overview.config.publishTarget?.repo}@${overview.config.publishTarget?.branch}` : "not configured (versions stay stored in the catalogue)"}
              </li>
              <li>Setup secret present: {overview.config.setupSecretConfigured ? "yes" : "no"}</li>
              <li>
                Counts: {overview.counts.projects} projects · {overview.counts.versions} versions · {overview.counts.users} users · {overview.counts.sessions} active sessions ·{" "}
                {overview.counts.modBackups} mod backups
              </li>
              <li>
                Upload limits: {formatBytes(overview.uploadLimits.maxZipBytes)} archive, {overview.uploadLimits.maxFiles} entries,{" "}
                {formatBytes(overview.uploadLimits.maxSingleFile)} per file
              </li>
            </ul>
          </div>

          <div className="card mt-3 p-3 text-xs">
            <h2 className="text-sm font-semibold">Upload project ZIP</h2>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="zip-file">
                  ZIP archive
                </label>
                <input
                  id="zip-file"
                  type="file"
                  accept=".zip"
                  className="input"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    if (event.target.files?.[0] && !form.name) {
                      setForm((prev) => ({ ...prev, name: event.target.files![0]!.name.replace(/\.zip$/i, "") }));
                    }
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor="project-id">
                  Project id (slug, optional)
                </label>
                <input id="project-id" className="input" value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} placeholder="auto from name" />
              </div>
              <div>
                <label className="label" htmlFor="project-name">
                  Name
                </label>
                <input id="project-name" className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="project-category">
                  Category
                </label>
                <input id="project-category" className="input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="project-version">
                  Version (leave empty to auto-bump)
                </label>
                <input id="project-version" className="input" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} placeholder="1.0.0" />
              </div>
              <div>
                <label className="label" htmlFor="project-description">
                  Description
                </label>
                <input id="project-description" className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="label" htmlFor="project-changelog">
                  Changelog
                </label>
                <input id="project-changelog" className="input" value={form.changelog} onChange={(event) => setForm({ ...form, changelog: event.target.value })} />
              </div>
            </div>
            <button type="button" className="btn btn-primary btn-sm mt-2" disabled={busy} onClick={() => void upload()}>
              {busy ? "Validating…" : "Validate & store version"}
            </button>
            <p className="muted mt-1">
              The archive is validated (signature, size, entry count, compression ratio, traversal, symlinks) and static checks run before anything is stored.
              Publishing to the catalogue and to GitHub are separate, explicit steps.
            </p>
          </div>

          {report ? (
            <div className="card mt-3 p-3 text-xs">
              <h2 className="text-sm font-semibold">
                Upload report — stage: {report.stage} · summary: {report.summary}
              </h2>
              {report.duplicateOfVersion ? <p className="badge badge-warn mt-1 block">Duplicate content of v{report.duplicateOfVersion}; no new version stored.</p> : null}
              {report.issues.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {report.issues.map((issue, index) => (
                    <li key={index} className={issue.severity === "error" ? "" : "muted"} style={{ color: issue.severity === "error" ? "var(--danger)" : undefined }}>
                      [{issue.severity}] {issue.code}: {issue.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted mt-1">No archive issues detected.</p>
              )}
              <h3 className="mt-2 font-semibold">Static checks</h3>
              <ul className="mt-1 space-y-0.5">
                {report.checks.map((check) => (
                  <li key={check.id}>
                    <span className={`badge ${check.status === "pass" ? "badge-ok" : check.status === "fail" ? "badge-danger" : check.status === "warn" ? "badge-warn" : ""}`}>{check.status}</span> {check.title} —{" "}
                    <span className="muted">{check.detail}</span>
                  </li>
                ))}
              </ul>
              {report.manifest ? (
                <p className="muted mt-2">
                  Detected {report.manifest.kind} project · {report.manifest.fileCount} files · {formatBytes(report.manifest.totalBytes)} · entry {report.manifest.entryFile ?? "—"} · deps{" "}
                  {report.manifest.dependencies.join(", ") || "none"}
                </p>
              ) : null}
              {report.contentHash ? <p className="mono muted mt-1">content sha256 {report.contentHash.slice(0, 32)}…</p> : null}
            </div>
          ) : null}

          <div className="card mt-3 p-3 text-xs">
            <h2 className="text-sm font-semibold">Catalogue management</h2>
            <div className="mt-2 grid gap-2">
              {projects.map((project) => (
                <div key={project.id} className="card-soft p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{project.name}</strong>
                    <span className="badge">{project.id}</span>
                    <span className={`badge ${project.status === "published" ? "badge-ok" : project.status === "draft" ? "badge-warn" : "badge-danger"}`}>{project.status}</span>
                    <span className="badge">{project.kind}</span>
                    <span className="muted">latest v{project.latestVersion ?? "—"}</span>
                  </div>
                  <div className="mt-2 grid gap-1">
                    {project.versions.map((version) => (
                      <div key={version.id} className="flex flex-wrap items-center gap-2">
                        <span className="mono">
                          v{version.version} {version.active ? "· active" : ""}
                        </span>
                        <span className={`badge ${version.publishState === "github" ? (version.githubVerified ? "badge-ok" : "badge-warn") : "badge-warn"}`}>{version.publishState}</span>
                        <span className="muted">
                          {version.fileCount} files · {formatBytes(version.totalBytes)} · {new Date(version.createdAt).toLocaleString()}
                        </span>
                        {version.commitSha ? <span className="mono muted">{version.commitSha.slice(0, 10)}</span> : null}
                        <div className="flex flex-wrap gap-1">
                          {!version.active ? (
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void action({ action: "publish", projectId: project.id, versionId: version.id })}>
                              Publish to catalogue
                            </button>
                          ) : null}
                          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void action({ action: "publish_github", projectId: project.id, versionId: version.id })}>
                            Publish to GitHub
                          </button>
                          {!version.active ? (
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void action({ action: "rollback", projectId: project.id, versionId: version.id })}>
                              Roll back to this
                            </button>
                          ) : null}
                        </div>
                        {version.publishError ? <p className="badge badge-danger block whitespace-normal text-left">{version.publishError}</p> : null}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {project.status === "archived" ? (
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void action({ action: "restore", projectId: project.id })}>
                        Restore from archive
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void action({ action: "archive", projectId: project.id })}>
                        Archive
                      </button>
                    )}
                    {deleteConfirm?.projectId === project.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          className="input w-48"
                          placeholder={`type ${project.id}`}
                          value={deleteConfirm.value}
                          onChange={(event) => setDeleteConfirm({ projectId: project.id, value: event.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={busy || deleteConfirm.value !== project.id}
                          onClick={() => {
                            void action({ action: "delete", projectId: project.id, confirm: deleteConfirm.value }).then(() => setDeleteConfirm(null));
                          }}
                        >
                          Confirm delete
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setDeleteConfirm(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleteConfirm({ projectId: project.id, value: "" })}>
                        Delete…
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="card p-3 text-xs">
              <h2 className="text-sm font-semibold">Audit log</h2>
              <ul className="scroll-y mt-1 max-h-64 space-y-0.5">
                {overview.audit.map((entry) => (
                  <li key={entry.id}>
                    <span className={entry.outcome === "ok" ? "" : "badge-danger"} style={{ color: entry.outcome === "ok" ? undefined : "var(--danger)" }}>
                      {entry.action}
                    </span>{" "}
                    <span className="muted">
                      {entry.actorLogin ?? "anonymous"} → {entry.target || "—"} · {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-3 text-xs">
              <h2 className="text-sm font-semibold">Server log (secrets redacted)</h2>
              <ul className="scroll-y mt-1 max-h-64 space-y-0.5">
                {overview.logs.map((entry) => (
                  <li key={entry.id}>
                    <span className="mono">[{entry.level}]</span> <span className="muted">{entry.scope}: {entry.message} · {new Date(entry.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      ) : null}

      {notice ? <p className="badge badge-ok mt-3 block whitespace-normal text-left">{notice}</p> : null}
      {error ? <p className="badge badge-danger mt-3 block whitespace-normal text-left">{error}</p> : null}
    </div>
  );
}
