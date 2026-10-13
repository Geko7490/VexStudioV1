"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, useSession } from "@/components/SessionProvider";
import { detectProject } from "@/lib/project-analyze";
import {
  deleteMod,
  exportAllModsZip,
  exportModZip,
  listMods,
  readZipToFiles,
  createMod,
  storageEstimate,
  requestPersistence,
  type ModMeta,
} from "@/lib/local-store";
import { formatBytes } from "@/lib/ai/models";

export default function ModsPage() {
  const { session } = useSession();
  const [mods, setMods] = useState<ModMeta[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<string>("idle");

  const load = useCallback(async () => {
    setMods(await listMods());
    setStorage(await storageEstimate());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = useCallback(async () => {
    if (!session?.authenticated) {
      setError("Mod sync needs a GitHub session. Your mods stay local meanwhile.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        mods: mods.slice(0, 25).map((mod) => ({
          modId: mod.id,
          name: mod.name,
          sourceProjectId: mod.sourceProjectId ?? "",
          sourceVersion: mod.sourceVersion ?? "",
          localVersion: mod.localVersion,
        })),
      };
      const res = await apiFetch<{ ok: boolean; saved: string[] }>("/api/mods/sync", { method: "POST", body: JSON.stringify(payload), csrf: session.csrfToken });
      setSyncState(`${res.saved.length} mod metadata record(s) mirrored to your account`);
      setNotice("Metadata synced. File contents are only pushed when you press “Sync with files”.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }, [mods, session]);

  const syncWithFiles = useCallback(async () => {
    if (!session?.authenticated) {
      setError("Sign in first — the sync endpoint requires a real session.");
      return;
    }
    setBusy(true);
    try {
      const { readModFiles } = await import("@/lib/local-store");
      const payload = [];
      for (const mod of mods.slice(0, 25)) {
        const files = await readModFiles(mod.id);
        payload.push({
          modId: mod.id,
          name: mod.name,
          sourceProjectId: mod.sourceProjectId ?? "",
          sourceVersion: mod.sourceVersion ?? "",
          localVersion: mod.localVersion,
          files,
        });
      }
      await apiFetch("/api/mods/sync", { method: "POST", body: JSON.stringify({ mods: payload }), csrf: session.csrfToken });
      setSyncState(`${payload.length} mod(s) mirrored including file contents`);
      setNotice("Full mirror uploaded to your account.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }, [mods, session]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">My Mods</h1>
        <span className="badge">{mods.length} local</span>
        {storage ? (
          <span className="badge">
            {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} · {storage.persisted ? "persistent" : "best-effort"}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const bytes = await exportAllModsZip();
              setNotice(`Backup ZIP created (${formatBytes(bytes)}).`);
            }}
          >
            Export all as ZIP
          </button>
          <label className="btn btn-sm">
            Import ZIP as new mod
            <input
              type="file"
              accept=".zip"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(true);
                try {
                  const result = await readZipToFiles(file);
                  const errors = result.issues.filter((issue) => issue.severity === "error");
                  if (errors.length > 0) {
                    setError(`ZIP rejected: ${errors.map((e) => e.message).join(" | ")}`);
                    return;
                  }
                  const detected = detectProject(result.files);
                  const created = await createMod({
                    name: file.name.replace(/\.zip$/i, ""),
                    description: "Imported from ZIP",
                    files: result.files,
                    imported: true,
                    entryFile: detected.entryFile,
                    kind: detected.kind,
                    runtimes: detected.runtimes,
                    dependencies: detected.dependencies,
                  });
                  setNotice(`Imported ${result.files.length} files (warnings: ${result.issues.length}) as mod ${created.name}. Nothing was executed automatically.`);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void sync()}>
            Sync metadata
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void syncWithFiles()}>
            Sync with files
          </button>
        </div>
      </div>

      {notice ? <p className="badge badge-ok mb-3 block whitespace-normal text-left">{notice}</p> : null}
      {error ? <p className="badge badge-danger mb-3 block whitespace-normal text-left">{error}</p> : null}
      {syncState ? <p className="muted mb-3 text-xs">Sync state: {syncState}</p> : null}

      {mods.length === 0 ? (
        <div className="card p-4 text-sm">
          <p className="muted">No mods in this browser yet.</p>
          <Link href="/projects" className="btn btn-primary mt-3">
            Create one from the catalogue
          </Link>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {mods.map((mod) => (
          <article key={mod.id} className="card p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{mod.name}</h2>
              <span className="badge">v{mod.localVersion}</span>
            </div>
            <p className="muted mt-1 text-xs">
              {mod.sourceProjectId ? `Fork of ${mod.sourceProjectId}@${mod.sourceVersion ?? "?"}` : "Imported project"} · {mod.filePaths.length} files · {mod.kind}
            </p>
            <p className="muted mt-1 text-xs">Updated {new Date(mod.updatedAt).toLocaleString()}</p>
            {mod.upstream?.latestVersion && mod.upstream.latestVersion !== mod.sourceVersion ? (
              <p className="badge badge-warn mt-2 block whitespace-normal text-left">Upstream published v{mod.upstream.latestVersion} — check updates in the workspace.</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Link href={`/workspace?mod=${mod.id}`} className="btn btn-sm btn-primary">
                Open
              </Link>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  const result = await exportModZip(mod.id);
                  setNotice(`Exported ${result.filename} (${formatBytes(result.bytes)}).`);
                }}
              >
                Export ZIP
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  if (!window.confirm(`Delete "${mod.name}" from this browser? Export a ZIP first if you need a copy.`)) return;
                  await deleteMod(mod.id);
                  await load();
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="card mt-4 p-3 text-xs">
        <h2 className="text-sm font-semibold">Storage safety</h2>
        <p className="muted mt-1">
          Mods live in IndexedDB for this browser profile only. Clearing site data, or using a different browser/device, means the data is gone. Request persistent
          storage below to reduce the chance of automatic eviction (the browser may still refuse).
        </p>
        <button
          type="button"
          className="btn btn-sm mt-2"
          onClick={async () => {
            const granted = await requestPersistence();
            setNotice(granted ? "Persistent storage granted." : "The browser declined persistent storage; data stays best-effort.");
            await load();
          }}
        >
          Request persistent storage
        </button>
      </div>
    </div>
  );
}
