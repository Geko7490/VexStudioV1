"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createModFromCatalog } from "@/lib/start-mod";

type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: string;
  runtimes: string[];
  dependencies: string[];
  entryFile: string | null;
  manifest: { fileCount?: number; totalBytes?: number; runtimeSupport?: Record<string, string> } | null;
  testSummary: { summary?: string; checks?: { title: string; status: string; detail: string }[] } | null;
  docsUrl: string | null;
  status: string;
  latestVersion: string | null;
  latestCommitSha: string | null;
  updatedAt: string;
  versionHistory: { version: string; commitSha: string | null; githubVerified: boolean; createdAt: string }[];
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<CatalogEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "version">("updated");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; projects?: CatalogEntry[]; categories?: string[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Catalogue unavailable");
      setProjects(data.projects ?? []);
      setCategories(data.categories ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalogue unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      const matchesCategory = category === "all" || p.category === category;
      const matchesQuery =
        q.length === 0 ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.dependencies.some((d) => d.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
    return filtered.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "version") return (b.latestVersion ?? "").localeCompare(a.latestVersion ?? "");
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [projects, category, query, sort]);

  const openProject = useCallback(
    async (project: CatalogEntry) => {
      setWorking(project.id);
      try {
        const res = await fetch(`/api/projects/${project.id}?files=1`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; error?: string; files?: { path: string; content: string }[] };
        if (!data.ok || !data.files) throw new Error(data.error ?? "Project files unavailable");
        const mod = await createModFromCatalog(project, data.files);
        router.push(`/workspace?mod=${mod.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create a mod");
      } finally {
        setWorking(null);
      }
    },
    [router],
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label className="label" htmlFor="catalog-search">
            Search
          </label>
          <input id="catalog-search" className="input" placeholder="Name, description or dependency…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="catalog-category">
            Category
          </label>
          <select id="catalog-category" className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="catalog-sort">
            Sort
          </label>
          <select id="catalog-sort" className="select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="updated">Last updated</option>
            <option value="name">Name</option>
            <option value="version">Version</option>
          </select>
        </div>
      </div>

      {error ? <p className="badge badge-danger mb-3 block whitespace-normal text-left">{error}</p> : null}
      {notice ? <p className="badge badge-ok mb-3 block whitespace-normal text-left">{notice}</p> : null}
      {loading ? <p className="muted text-sm">Loading catalogue…</p> : null}
      {!loading && visible.length === 0 ? <p className="muted text-sm">No published projects match this filter.</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((project) => (
          <article key={project.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold">
                <Link href={`/projects/${project.id}`} className="hover:underline">
                  {project.name}
                </Link>
              </h2>
              <span className="badge">v{project.latestVersion ?? "?"}</span>
            </div>
            <p className="muted mt-1 text-xs">{project.description}</p>
            <dl className="mt-3 space-y-1 text-xs">
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Category</dt>
                <dd>{project.category}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Type</dt>
                <dd>{project.kind}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Runtimes</dt>
                <dd>{project.runtimes.join(", ") || "none declared"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Dependencies</dt>
                <dd>{project.dependencies.slice(0, 6).join(", ") || "none"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Files</dt>
                <dd>
                  {project.manifest?.fileCount ?? "?"} · {Math.round((project.manifest?.totalBytes ?? 0) / 1024)} KB
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Checks</dt>
                <dd>
                  <span className={`badge ${(project.testSummary?.summary ?? "not_run") === "pass" ? "badge-ok" : project.testSummary?.summary === "fail" ? "badge-danger" : "badge-warn"}`}>
                    {project.testSummary?.summary ?? "not run"}
                  </span>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="muted w-24 shrink-0">Updated</dt>
                <dd>{new Date(project.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button type="button" className="btn btn-sm btn-primary" disabled={working === project.id} onClick={() => void openProject(project)}>
                {working === project.id ? "Copying…" : "Open project"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={working === project.id}
                onClick={async () => {
                  await openProject(project);
                  setNotice(`Independent mod created from ${project.name}. The original project stays untouched.`);
                }}
              >
                New mod
              </button>
              <Link className="btn btn-sm" href={`/projects/${project.id}`}>
                Details
              </Link>
              {project.docsUrl ? (
                <a className="btn btn-sm" href={project.docsUrl} target="_blank" rel="noreferrer noopener">
                  Docs
                </a>
              ) : null}
            </div>
            {project.latestCommitSha ? <p className="muted mono mt-2 text-[11px]">commit {project.latestCommitSha.slice(0, 10)}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
