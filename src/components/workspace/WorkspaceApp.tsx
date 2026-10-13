"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorPane } from "./EditorPane";
import { FileTree } from "./FileTree";
import { AIPanel } from "./AIPanel";
import { RunPanel } from "./RunPanel";
import { buildIndex, summarizeArchitecture, type ProjectIndex } from "@/lib/indexer";
import { merge3 } from "@/lib/merge";
import { detectProject } from "@/lib/project-analyze";
import { normalizeArchivePath } from "@/lib/paths";
import {
  createMod,
  createSnapshot,
  deleteMod,
  deleteModFile,
  exportModZip,
  getMod,
  listMods,
  listSnapshots,
  mirrorModToFolder,
  putMod,
  readModFiles,
  readZipToFiles,
  restoreSnapshot,
  writeModFile,
  writeModManifest,
  type ModMeta,
} from "@/lib/local-store";
import type { ConsoleEntry } from "@/lib/preview";

type UpstreamState = {
  status: "idle" | "checking" | "ready" | "error" | "applied";
  message: string;
  latestVersion: string | null;
  changes: { path: string; localChanged: boolean; upstreamChanged: boolean; conflicts: number }[];
};

export function WorkspaceApp() {
  const params = useSearchParams();
  const router = useRouter();
  const modId = params.get("mod");

  const [mods, setMods] = useState<ModMeta[]>([]);
  const [meta, setMeta] = useState<ModMeta | null>(null);
  const [files, setFiles] = useState<{ path: string; content: string }[]>([]);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [index, setIndex] = useState<ProjectIndex | null>(null);
  const [filter, setFilter] = useState("");
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [rightPane, setRightPane] = useState<"run" | "ai">("run");
  const [mobilePane, setMobilePane] = useState<"files" | "editor" | "run" | "ai">("editor");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshots, setSnapshots] = useState<{ id: string; label: string; createdAt: string }[]>([]);
  const [upstream, setUpstream] = useState<UpstreamState>({ status: "idle", message: "", latestVersion: null, changes: [] });

  const refreshModList = useCallback(async () => setMods(await listMods()), []);

  useEffect(() => {
    void refreshModList();
  }, [refreshModList]);

  useEffect(() => {
    if (!modId) {
      setMeta(null);
      setFiles([]);
      setBuffers({});
      setIndex(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const loaded = await getMod(modId);
      if (cancelled) return;
      if (!loaded) {
        setError(`Mod ${modId} was not found in this browser's storage.`);
        return;
      }
      const loadedFiles = await readModFiles(modId);
      setMeta(loaded);
      setFiles(loadedFiles);
      setBuffers({});
      setTabs(loaded.filePaths.slice(0, 3));
      setActivePath(loaded.entryFile && loadedFiles.some((f) => f.path === loaded.entryFile) ? loaded.entryFile : loadedFiles[0]?.path ?? null);
      setIndex(buildIndex(loadedFiles, loaded.indexVersion));
      setSnapshots((await listSnapshots(modId)).map((s) => ({ id: s.id, label: s.label, createdAt: s.createdAt })));
    })();
    return () => {
      cancelled = true;
    };
  }, [modId]);

  const dirtyPaths = useMemo(() => new Set(Object.keys(buffers).filter((p) => buffers[p] !== files.find((f) => f.path === p)?.content)), [buffers, files]);
  const currentContent = activePath ? buffers[activePath] ?? files.find((f) => f.path === activePath)?.content ?? "" : "";

  const saveFile = useCallback(
    async (path: string) => {
      if (!meta) return;
      const content = buffers[path];
      if (content === undefined) return;
      await writeModFile(meta.id, path, content);
      const next = files.some((f) => f.path === path) ? files.map((f) => (f.path === path ? { path, content } : f)) : [...files, { path, content }];
      const sorted = next.sort((a, b) => a.path.localeCompare(b.path));
      setFiles(sorted);
      setBuffers((prev) => {
        const copy = { ...prev };
        delete copy[path];
        return copy;
      });
      const built = buildIndex(sorted, meta.indexVersion);
      setIndex(built);
      const detected = detectProject(sorted);
      const updated: ModMeta = {
        ...meta,
        entryFile: meta.entryFile ?? detected.entryFile,
        kind: meta.sourceProjectId ? meta.kind : detected.kind,
        runtimes: meta.sourceProjectId ? meta.runtimes : detected.runtimes,
        filePaths: sorted.map((f) => f.path),
      };
      await putMod(updated);
      setMeta(updated);
      setNotice(`Saved ${path}`);
    },
    [meta, buffers, files],
  );

  const saveAll = useCallback(async () => {
    for (const path of dirtyPaths) await saveFile(path);
  }, [dirtyPaths, saveFile]);

  const openFile = useCallback(
    async (path: string) => {
      if (dirtyPaths.size > 0) setNotice("You have unsaved changes; they stay in the buffer when you switch files.");
      setActivePath(path);
      setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
      setMobilePane("editor");
    },
    [dirtyPaths.size],
  );

  const createFile = useCallback(async () => {
    if (!meta) return;
    const raw = window.prompt("New file path (folders are created automatically)", "src/new-file.js");
    if (!raw) return;
    const check = normalizeArchivePath(raw);
    if (!check.ok) {
      setError(`Invalid path: ${check.reason}`);
      return;
    }
    if (files.some((f) => f.path === check.path)) {
      setError("That file already exists.");
      return;
    }
    await writeModFile(meta.id, check.path, "");
    const next = [...files, { path: check.path, content: "" }].sort((a, b) => a.path.localeCompare(b.path));
    setFiles(next);
    setBuffers((prev) => ({ ...prev, [check.path]: "" }));
    setTabs((prev) => [...prev, check.path]);
    setActivePath(check.path);
    setIndex(buildIndex(next, meta.indexVersion));
  }, [meta, files]);

  const createFolder = useCallback(async () => {
    if (!meta) return;
    const raw = window.prompt("New folder path", "src");
    if (!raw) return;
    const check = normalizeArchivePath(`${raw.replace(/\/+$/, "")}/.gitkeep`);
    if (!check.ok) {
      setError(`Invalid folder: ${check.reason}`);
      return;
    }
    await writeModFile(meta.id, check.path, "");
    const next = [...files, { path: check.path, content: "" }].sort((a, b) => a.path.localeCompare(b.path));
    setFiles(next);
    setIndex(buildIndex(next, meta.indexVersion));
  }, [meta, files]);

  const renameFile = useCallback(
    async (path: string) => {
      if (!meta) return;
      const raw = window.prompt(`Rename ${path} to`, path);
      if (!raw || raw === path) return;
      const check = normalizeArchivePath(raw);
      if (!check.ok) {
        setError(`Invalid path: ${check.reason}`);
        return;
      }
      const content = buffers[path] ?? files.find((f) => f.path === path)?.content ?? "";
      await writeModFile(meta.id, check.path, content);
      await deleteModFile(meta.id, path);
      const next = files.filter((f) => f.path !== path).concat({ path: check.path, content }).sort((a, b) => a.path.localeCompare(b.path));
      setFiles(next);
      setTabs((prev) => prev.map((t) => (t === path ? check.path : t)));
      setActivePath((prev) => (prev === path ? check.path : prev));
      setIndex(buildIndex(next, meta.indexVersion));
      setNotice(`Renamed ${path} → ${check.path}`);
    },
    [meta, buffers, files],
  );

  const removeFile = useCallback(
    async (path: string) => {
      if (!meta) return;
      if (!window.confirm(`Delete ${path}? A snapshot is taken first so you can restore it.`)) return;
      await createSnapshot(meta.id, `Before deleting ${path}`, "user deleted file");
      await deleteModFile(meta.id, path);
      const next = files.filter((f) => f.path !== path);
      setFiles(next);
      setTabs((prev) => prev.filter((t) => t !== path));
      if (activePath === path) setActivePath(next[0]?.path ?? null);
      setIndex(buildIndex(next, meta.indexVersion));
      setSnapshots((await listSnapshots(meta.id)).map((s) => ({ id: s.id, label: s.label, createdAt: s.createdAt })));
    },
    [meta, files, activePath],
  );

  const loadUpstream = useCallback(async () => {
    if (!meta?.sourceProjectId) throw new Error("This mod was imported, so it has no upstream catalogue project to compare against.");
    const res = await fetch(`/api/projects/${meta.sourceProjectId}?files=1`, { cache: "no-store" });
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      project?: { latestVersion: string | null; latestCommitSha: string | null };
      files?: { path: string; content: string }[];
    };
    if (!res.ok || !data.ok || !data.files) throw new Error(data.error ?? "Upstream project is unavailable.");
    const snaps = await listSnapshots(meta.id);
    const base = snaps[snaps.length - 1] ?? null;
    return { upstreamFiles: data.files, latestVersion: data.project?.latestVersion ?? null, latestCommitSha: data.project?.latestCommitSha ?? null, base };
  }, [meta]);

  const checkUpstream = useCallback(async () => {
    if (!meta?.sourceProjectId) {
      setError("This mod was imported, so it has no upstream catalogue project to compare against.");
      return;
    }
    setBusy(true);
    setUpstream({ status: "checking", message: "Fetching the published version…", latestVersion: null, changes: [] });
    try {
      const { upstreamFiles, latestVersion, base } = await loadUpstream();
      const baseMap = new Map((base?.files ?? []).map((f) => [f.path, f.content]));
      const localMap = new Map(files.map((f) => [f.path, f.content]));
      const upstreamMap = new Map(upstreamFiles.map((f) => [f.path, f.content]));
      const paths = [...new Set([...baseMap.keys(), ...localMap.keys(), ...upstreamMap.keys()])];

      const changes = paths
        .filter((path) => path !== "vex.mod.json")
        .map((path) => {
          const baseContent = baseMap.get(path);
          const local = localMap.get(path);
          const up = upstreamMap.get(path);
          const localChanged = baseContent !== undefined && local !== baseContent;
          const upstreamChanged = baseContent !== undefined ? baseContent !== up : local !== up;
          const conflicts =
            baseContent !== undefined && local !== undefined && up !== undefined && localChanged && baseContent !== up
              ? merge3(baseContent.split("\n"), local.split("\n"), up.split("\n")).conflicts.length
              : 0;
          return { path, localChanged, upstreamChanged: Boolean(upstreamChanged), conflicts };
        })
        .filter((change) => change.upstreamChanged || change.localChanged);

      await putMod({ ...meta, upstream: { latestVersion, latestCommitSha: null, checkedAt: new Date().toISOString() } });

      setUpstream({
        status: "ready",
        message:
          !base
            ? "No creation snapshot found, so a three-way merge is not possible; only an overwrite would be safe."
            : changes.length === 0
              ? `Your mod already matches ${meta.sourceProjectId} ${latestVersion ?? ""}.`
              : `${changes.length} file(s) differ from the published version. Your edits are never overwritten without an explicit choice.`,
        latestVersion,
        changes,
      });
    } catch (err) {
      setUpstream({ status: "error", message: err instanceof Error ? err.message : "Upstream check failed", latestVersion: null, changes: [] });
    } finally {
      setBusy(false);
    }
  }, [meta, files, loadUpstream]);

  const applyUpstream = useCallback(
    async (mode: "merge" | "overwrite") => {
      if (!meta || upstream.status !== "ready") return;
      setBusy(true);
      try {
        const { upstreamFiles, base } = await loadUpstream();
        await createSnapshot(meta.id, `Before ${mode} from upstream ${upstream.latestVersion ?? ""}`, "upstream update");

        const baseMap = new Map((base?.files ?? []).map((f) => [f.path, f.content]));
        const localMap = new Map(files.map((f) => [f.path, f.content]));
        const upstreamMap = new Map(upstreamFiles.map((f) => [f.path, f.content]));
        let applied = 0;
        let conflicts = 0;

        for (const [path, up] of upstreamMap) {
          if (path === "vex.mod.json") continue;
          const local = localMap.get(path);
          const baseContent = baseMap.get(path);
          if (mode === "overwrite" || local === undefined || local === up) {
            if (local !== up) {
              await writeModFile(meta.id, path, up);
              applied += 1;
            }
            continue;
          }
          if (baseContent === undefined) continue; // cannot merge safely without a base
          const merged = merge3(baseContent.split("\n"), local.split("\n"), up.split("\n"));
          conflicts += merged.conflicts.length;
          const content = merged.lines.join("\n");
          if (content !== local) {
            await writeModFile(meta.id, path, content);
            applied += 1;
          }
        }

        setUpstream({
          status: "applied",
          message: `Applied ${applied} file(s) from upstream${conflicts > 0 ? ` with ${conflicts} conflict marker(s) inserted for manual review` : ""}. A pre-update snapshot was saved.`,
          latestVersion: upstream.latestVersion,
          changes: [],
        });
        const loadedFiles = await readModFiles(meta.id);
        setFiles(loadedFiles);
        setBuffers({});
        setIndex(buildIndex(loadedFiles, meta.indexVersion));
        setSnapshots((await listSnapshots(meta.id)).map((s) => ({ id: s.id, label: s.label, createdAt: s.createdAt })));
      } catch (err) {
        setUpstream({ status: "error", message: err instanceof Error ? err.message : "Update failed", latestVersion: upstream.latestVersion, changes: [] });
      } finally {
        setBusy(false);
      }
    },
    [meta, files, upstream, loadUpstream],
  );

  const importZip = useCallback(
    async (file: File) => {
      if (!meta) return;
      setBusy(true);
      try {
        const result = await readZipToFiles(file);
        const errors = result.issues.filter((i) => i.severity === "error");
        if (errors.length > 0) {
          setError(`ZIP rejected: ${errors.map((e) => e.message).join(" | ")}`);
          return;
        }
        await createSnapshot(meta.id, "Before ZIP import", file.name);
        for (const item of result.files) {
          if (item.path === meta.manifestPath) continue;
          await writeModFile(meta.id, item.path, item.content);
        }
        const loadedFiles = await readModFiles(meta.id);
        setFiles(loadedFiles);
        setBuffers({});
        setIndex(buildIndex(loadedFiles, meta.indexVersion));
        const detected = detectProject(loadedFiles);
        const updated = { ...meta, entryFile: detected.entryFile ?? meta.entryFile, filePaths: loadedFiles.map((f) => f.path) };
        await writeModManifest(updated, loadedFiles);
        await putMod(updated);
        setMeta(updated);
        setNotice(`Imported ${result.files.length} file(s) from ${file.name}. Warnings: ${result.issues.length}`);
      } finally {
        setBusy(false);
      }
    },
    [meta],
  );

  if (!modId || !meta) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold">Workspace</h1>
        <p className="muted mb-4 text-sm">Pick one of your local mods, or create an empty workspace.</p>
        {error ? <p className="badge badge-danger mb-3 block whitespace-normal text-left">{error}</p> : null}
        <div className="grid gap-2">
          {mods.length === 0 ? <p className="muted text-sm">No mods yet — open a catalogue project and press “New mod”.</p> : null}
          {mods.map((item) => (
            <Link key={item.id} href={`/workspace?mod=${item.id}`} className="card flex items-center justify-between p-3 text-sm">
              <span>
                <strong>{item.name}</strong>
                <span className="muted"> · {item.filePaths.length} files · v{item.localVersion}</span>
              </span>
              <span className="badge">{item.kind}</span>
            </Link>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary mt-4"
          onClick={async () => {
            const created = await createMod({ name: "Untitled mod", files: [{ path: "index.html", content: "<!doctype html>\n<html><body><h1>Hello from Vex Studio</h1></body></html>\n" }] });
            await refreshModList();
            router.push(`/workspace?mod=${created.id}`);
          }}
        >
          Create empty mod
        </button>
      </div>
    );
  }

  const architecture = index ? summarizeArchitecture(index, files) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-base">{meta.name}</strong>
        <span className="badge">{meta.kind}</span>
        <span className="badge">v{meta.localVersion}</span>
        {meta.sourceProjectId ? <span className="badge">from {meta.sourceProjectId}@{meta.sourceVersion ?? "?"}</span> : <span className="badge badge-warn">imported</span>}
        {meta.lastSavedAt ? <span className="muted text-xs">saved {new Date(meta.lastSavedAt).toLocaleTimeString()}</span> : null}
        {dirtyPaths.size > 0 ? <span className="badge badge-warn">{dirtyPaths.size} unsaved</span> : null}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm btn-primary" disabled={dirtyPaths.size === 0} onClick={() => void saveAll()}>
            Save all
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void exportModZip(meta.id)}>
            Export ZIP
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              document.getElementById("import-zip-input")?.click()
            }
          >
            Import ZIP
          </button>
          <input
            id="import-zip-input"
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importZip(file);
              event.target.value = "";
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => void checkUpstream()} disabled={busy}>
            Check upstream
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              await createSnapshot(meta.id, "Manual backup", "user requested");
              setSnapshots((await listSnapshots(meta.id)).map((s) => ({ id: s.id, label: s.label, createdAt: s.createdAt })));
              setNotice("Snapshot created.");
            }}
          >
            Snapshot
          </button>
        </div>
      </div>

      {notice ? <p className="badge badge-ok block whitespace-normal text-left">{notice}</p> : null}
      {error ? <p className="badge badge-danger block whitespace-normal text-left">{error}</p> : null}
      {upstream.status !== "idle" ? (
        <div className="card p-2 text-xs">
          <p>
            <strong>Upstream:</strong> {upstream.message}
          </p>
          {upstream.changes.length > 0 ? (
            <div className="scroll-y mt-1 max-h-40">
              {upstream.changes.map((change) => (
                <p key={change.path} className="mono">
                  {change.path} — {change.upstreamChanged ? "upstream changed" : ""}
                  {change.localChanged ? " · your copy changed" : ""}
                  {change.conflicts > 0 ? ` · ${change.conflicts} conflict(s)` : ""}
                </p>
              ))}
            </div>
          ) : null}
          {upstream.changes.length > 0 ? (
            <div className="mt-2 flex gap-1">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void applyUpstream("merge")} disabled={busy}>
                Merge into my mod (3-way)
              </button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void applyUpstream("overwrite")} disabled={busy}>
                Take upstream version
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setUpstream({ status: "idle", message: "", latestVersion: null, changes: [] })}>
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-1 lg:hidden">
        {(["files", "editor", "run", "ai"] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            className={`btn btn-sm flex-1 ${mobilePane === pane ? "btn-primary" : ""}`}
            onClick={() => setMobilePane(pane)}
            aria-pressed={mobilePane === pane}
          >
            {pane === "files" ? "Files" : pane === "editor" ? "Editor" : pane === "run" ? "Run" : "AI"}
          </button>
        ))}
      </div>

      <div className="grid gap-2 lg:h-[calc(100vh-190px)] lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
        <aside className={`card p-2 ${mobilePane === "files" ? "" : "hidden lg:block"}`}>
          <FileTree
            files={files.map((f) => ({ path: f.path, dirty: dirtyPaths.has(f.path) }))}
            activePath={activePath}
            filter={filter}
            onFilterChange={setFilter}
            onOpen={(path) => void openFile(path)}
            onCreateFile={() => void createFile()}
            onCreateFolder={() => void createFolder()}
            onRename={(path) => void renameFile(path)}
            onDelete={(path) => void removeFile(path)}
          />
        </aside>

        <section className={`card flex min-h-[420px] flex-col overflow-hidden ${mobilePane === "editor" ? "" : "hidden lg:flex"}`}>
          <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1" style={{ borderColor: "var(--border)" }}>
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className="tree-row whitespace-nowrap"
                data-active={activePath === tab}
                data-dirty={dirtyPaths.has(tab)}
                onClick={() => setActivePath(tab)}
              >
                {tab.split("/").pop()}
                {dirtyPaths.has(tab) ? " ●" : ""}
              </button>
            ))}
          </div>
          <EditorPane
            path={activePath}
            value={currentContent}
            onChange={(next) => setBuffers((prev) => ({ ...prev, [activePath as string]: next }))}
            onSave={() => activePath && void saveFile(activePath)}
            onFind={() => setNotice("Use Ctrl/Cmd+F inside the editor for search and replace.")}
          />
        </section>

        <section className={`card flex min-h-[420px] flex-col overflow-hidden ${mobilePane === "run" || mobilePane === "ai" ? "" : "hidden lg:flex"}`}>
          <div className="flex gap-1 border-b px-2 py-1" style={{ borderColor: "var(--border)" }}>
            <button type="button" className={`btn btn-sm ${rightPane === "run" ? "btn-primary" : ""}`} onClick={() => setRightPane("run")}>
              Run / Preview
            </button>
            <button type="button" className={`btn btn-sm ${rightPane === "ai" ? "btn-primary" : ""}`} onClick={() => setRightPane("ai")}>
              AI assistant
            </button>
          </div>
          <div className="flex-1 overflow-hidden p-2">
            {rightPane === "run" ? (
              <RunPanel
                kind={meta.kind}
                entryFile={meta.entryFile}
                files={files.map((f) => ({ path: f.path, content: buffers[f.path] ?? f.content }))}
                pythonEntry={meta.kind === "python" ? meta.entryFile : null}
                requirements={
                  files
                    .filter((f) => f.path.endsWith("requirements.txt"))
                    .flatMap((f) => (buffers[f.path] ?? f.content).split("\n"))
                    .map((l) => l.trim())
                    .filter((l) => l && !l.startsWith("#"))
                }
                consoleEntries={consoleEntries}
                onConsole={(entry) => setConsoleEntries((prev) => [...prev.slice(-199), entry])}
              />
            ) : index ? (
              <AIPanel
                modId={meta.id}
                files={files.map((f) => ({ path: f.path, content: buffers[f.path] ?? f.content }))}
                index={index}
                activePath={activePath}
                onApplyChanges={async (changes) => {
                  for (const change of changes) await writeModFile(meta.id, change.path, change.content);
                  const loadedFiles = await readModFiles(meta.id);
                  setFiles(loadedFiles);
                  setBuffers({});
                  setIndex(buildIndex(loadedFiles, meta.indexVersion));
                  if (!tabs.includes(changes[0].path)) setTabs((prev) => [...prev, changes[0].path]);
                  setActivePath(changes[0].path);
                }}
                onIndexRefresh={() => setIndex(buildIndex(files, meta.indexVersion))}
              />
            ) : null}
          </div>
        </section>
      </div>

      <div className="card p-2 text-xs">
        <details>
          <summary className="cursor-pointer">Storage, snapshots & project report</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <p className="font-semibold">Snapshots (local, newest first)</p>
              {snapshots.length === 0 ? <p className="muted">No snapshots yet.</p> : null}
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className="mt-1 flex items-center gap-2">
                  <span className="truncate">
                    {snapshot.label} · {new Date(snapshot.createdAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      await restoreSnapshot(snapshot.id);
                      const loadedFiles = await readModFiles(meta.id);
                      setFiles(loadedFiles);
                      setBuffers({});
                      setIndex(buildIndex(loadedFiles, meta.indexVersion));
                      setSnapshots((await listSnapshots(meta.id)).map((s) => ({ id: s.id, label: s.label, createdAt: s.createdAt })));
                      setNotice("Snapshot restored (a new backup was taken first).");
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
            <div>
              <p className="font-semibold">Architecture report (deterministic)</p>
              {architecture ? (
                <ul className="muted mt-1 space-y-0.5">
                  <li>Purpose: {architecture.purpose}</li>
                  <li>Entry: {architecture.entryPoints.join(", ") || "none detected"}</li>
                  <li>
                    Modules: {architecture.modules.map((m) => `${m.name} (${m.files})`).join(", ") || "none"}
                  </li>
                  <li>Technologies: {architecture.technologies.join(", ") || "unknown"}</li>
                  <li>Import edges: {index?.stats.imports ?? 0} · symbols {index?.stats.symbols ?? 0}</li>
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    if (!folderAccessSupported()) {
                      setError("This browser does not support the File System Access API (common on Android). IndexedDB storage and ZIP export still work.");
                      return;
                    }
                    const picker = window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<{ name: string }> };
                    if (!picker.showDirectoryPicker) {
                      setError("This browser does not support the File System Access API (common on Android). IndexedDB storage and ZIP export still work.");
                      return;
                    }
                    const { name } = await picker.showDirectoryPicker({ mode: "readwrite" });
                    const result = await mirrorModToFolder(meta.id, name);
                    setNotice(result.error ? `Folder mirror failed: ${result.error}` : `Mirrored ${result.written} file(s) into ${name}.`);
                  }}
                >
                  Mirror to folder
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete mod "${meta.name}" and all its local files? Export a ZIP first if you need a copy.`)) return;
                    await deleteMod(meta.id);
                    router.push("/mods");
                  }}
                >
                  Delete mod
                </button>
              </div>
              <p className="muted mt-2">
                Mods live in this browser profile (IndexedDB). Clearing site data deletes them — export a ZIP or enable sync in Settings for a copy.
              </p>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function folderAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
