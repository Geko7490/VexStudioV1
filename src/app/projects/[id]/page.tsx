"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createModFromCatalog } from "@/lib/start-mod";

type Detail = {
  ok: boolean;
  error?: string;
  project: {
    id: string;
    name: string;
    description: string;
    category: string;
    kind: string;
    runtimes: string[];
    dependencies: string[];
    entryFile: string | null;
    manifest: {
      fileCount?: number;
      totalBytes?: number;
      runtimeSupport?: Record<string, string>;
      files?: { path: string; bytes: number; language: string }[];
    } | null;
    testSummary: { summary?: string; checks?: { id: string; title: string; status: string; detail: string }[] } | null;
    docsUrl: string | null;
    repositoryPath: string | null;
    latestVersion: string | null;
    latestCommitSha: string | null;
    updatedAt: string;
  };
  version: { id: string; version: string; commitSha: string | null; changelog: string; publishState: string; githubVerified: boolean; fileCount: number; createdAt: string };
  versions: { id: string; version: string; commitSha: string | null; active: boolean; publishState: string; githubVerified: boolean; createdAt: string; changelog: string }[];
  files: { path: string; content: string }[];
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (version?: string) => {
      try {
        const query = version ? `?files=1&version=${encodeURIComponent(version)}` : "?files=1";
        const res = await fetch(`/api/projects/${params.id}${query}`, { cache: "no-store" });
        const data = (await res.json()) as Detail;
        if (!data.ok) throw new Error(data.error ?? "Project unavailable");
        setDetail(data);
        setSelected(data.project.entryFile ?? data.files[0]?.path ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Project unavailable");
      }
    },
    [params.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const file = detail?.files.find((f) => f.path === selected);

  const createMod = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const mod = await createModFromCatalog(
        { id: detail.project.id, name: detail.project.name, latestVersion: detail.project.latestVersion, latestCommitSha: detail.project.latestCommitSha },
        detail.files,
      );
      router.push(`/workspace?mod=${mod.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-xl">
        <p className="badge badge-danger block whitespace-normal text-left">{error}</p>
        <Link href="/projects" className="btn mt-3">
          Back to catalogue
        </Link>
      </div>
    );
  }
  if (!detail) return <p className="muted text-sm">Loading project…</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{detail.project.name}</h1>
            <span className="badge">v{detail.project.latestVersion}</span>
            <span className="badge">{detail.project.kind}</span>
            <span className={`badge ${detail.version.publishState === "github" ? (detail.version.githubVerified ? "badge-ok" : "badge-warn") : "badge-warn"}`}>
              {detail.version.publishState === "github" ? (detail.version.githubVerified ? "commit verified on GitHub" : "commit not verified") : "stored in catalogue only"}
            </span>
          </div>
          <p className="muted mt-2 text-sm">{detail.project.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void createMod()}>
              {busy ? "Copying files…" : "New independent mod"}
            </button>
            {detail.project.docsUrl ? (
              <a className="btn btn-sm" href={detail.project.docsUrl} target="_blank" rel="noreferrer noopener">
                Documentation
              </a>
            ) : null}
          </div>
        </div>

        <div className="card mt-3 p-3">
          <h2 className="text-sm font-semibold">Files ({detail.files.length})</h2>
          <div className="mt-2 grid gap-2 md:grid-cols-[200px_minmax(0,1fr)]">
            <ul className="scroll-y max-h-[420px] space-y-0.5">
              {detail.files.map((item) => (
                <li key={item.path}>
                  <button type="button" className="tree-row mono" data-active={selected === item.path} onClick={() => setSelected(item.path)}>
                    {item.path}
                  </button>
                </li>
              ))}
            </ul>
            <div className="scroll-y card-soft max-h-[420px] overflow-auto">
              <pre className="console">{file?.content ?? "Select a file."}</pre>
            </div>
          </div>
        </div>
      </div>

      <aside className="grid gap-3">
        <div className="card p-3 text-xs">
          <h2 className="text-sm font-semibold">Manifest</h2>
          <dl className="mt-2 space-y-1">
            <div className="flex gap-2">
              <dt className="muted w-28">Project id</dt>
              <dd className="mono">{detail.project.id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="muted w-28">Entry file</dt>
              <dd className="mono">{detail.project.entryFile ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="muted w-28">Runtimes</dt>
              <dd>
                {Object.entries(detail.project.manifest?.runtimeSupport ?? {}).map(([runtime, support]) => (
                  <span key={runtime} className={`badge mr-1 ${support === "supported" ? "badge-ok" : support === "partial" ? "badge-warn" : "badge-danger"}`}>
                    {runtime}: {support}
                  </span>
                ))}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="muted w-28">Dependencies</dt>
              <dd>{detail.project.dependencies.join(", ") || "none"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="muted w-28">Repository</dt>
              <dd className="mono">{detail.project.repositoryPath ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="muted w-28">Updated</dt>
              <dd>{new Date(detail.project.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <div className="card p-3 text-xs">
          <h2 className="text-sm font-semibold">Static checks ({detail.project.testSummary?.summary ?? "not run"})</h2>
          <ul className="mt-2 space-y-1">
            {(detail.project.testSummary?.checks ?? []).map((check) => (
              <li key={check.id}>
                <span className={`badge ${check.status === "pass" ? "badge-ok" : check.status === "fail" ? "badge-danger" : check.status === "warn" ? "badge-warn" : ""}`}>{check.status}</span>{" "}
                {check.title}
                <span className="muted"> — {check.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-3 text-xs">
          <h2 className="text-sm font-semibold">Versions</h2>
          <ul className="mt-2 space-y-1">
            {detail.versions.map((version) => (
              <li key={version.id} className="flex items-center gap-2">
                <button type="button" className="tree-row" data-active={version.id === detail.version.id} onClick={() => void load(version.version)}>
                  v{version.version} {version.active ? "· active" : ""}
                </button>
                <span className={`badge ${version.publishState === "github" ? "badge-ok" : "badge-warn"}`}>{version.publishState}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
