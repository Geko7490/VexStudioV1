import JSZip from "jszip";
import { scanZip } from "./zip-safe";
import { languageOf, type ProjectFile } from "./project-analyze";

const DB_NAME = "vex-studio";
const DB_VERSION = 1;

export const STORES = {
  mods: "mods",
  files: "files",
  snapshots: "snapshots",
  memories: "memories",
  chats: "chats",
  meta: "meta",
} as const;

export type StorageMode = "indexeddb" | "folder";

export type ModMeta = {
  id: string;
  name: string;
  description: string;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  sourceVersion: string | null;
  sourceCommitSha: string | null;
  modVersion: string;
  localVersion: number;
  storageMode: StorageMode;
  folderHandleName: string | null;
  manifestPath: string | null;
  entryFile: string | null;
  kind: string;
  runtimes: string[];
  dependencies: string[];
  filePaths: string[];
  createdAt: string;
  updatedAt: string;
  lastSavedAt: string | null;
  dirty: boolean;
  imported: boolean;
  memoryVersion: number;
  indexVersion: number;
  upstream: { latestVersion: string | null; latestCommitSha: string | null; checkedAt: string | null };
  testSummary: { summary: string; at: string } | null;
};

export type ModFileRow = { modId: string; path: string; content: string; size: number; updatedAt: string };

export type ModSnapshot = {
  id: string;
  modId: string;
  label: string;
  reason: string;
  files: { path: string; content: string }[];
  createdAt: string;
};

export type ProjectMemory = {
  modId: string;
  purpose: string;
  architecture: string;
  modules: string[];
  technologies: string[];
  importantFiles: string[];
  changes: { at: string; summary: string; files: string[] }[];
  preferences: string[];
  knownIssues: string[];
  testResults: string[];
  decisions: { at: string; decision: string; reason: string }[];
  updatedAt: string;
  sourceIndexVersion: number;
};

export type ChatTurn = {
  id: string;
  modId: string;
  role: "user" | "assistant" | "system" | "error";
  content: string;
  createdAt: string;
  modelId: string | null;
  contextFiles: string[];
  proposalId: string | null;
  usage: { promptLines: number; contextFiles: number } | null;
};

function req<T>(store: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    store.onsuccess = () => resolve(store.result);
    store.onerror = () => reject(store.error ?? new Error("IndexedDB request failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available in this context."));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORES.mods)) db.createObjectStore(STORES.mods, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.files)) {
          const files = db.createObjectStore(STORES.files, { keyPath: ["modId", "path"] });
          files.createIndex("byMod", "modId");
        }
        if (!db.objectStoreNames.contains(STORES.snapshots)) {
          const snaps = db.createObjectStore(STORES.snapshots, { keyPath: "id" });
          snaps.createIndex("byMod", "modId");
        }
        if (!db.objectStoreNames.contains(STORES.memories)) db.createObjectStore(STORES.memories, { keyPath: "modId" });
        if (!db.objectStoreNames.contains(STORES.chats)) {
          const chats = db.createObjectStore(STORES.chats, { keyPath: "id" });
          chats.createIndex("byMod", "modId");
        }
        if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: "key" });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("Failed to open IndexedDB"));
    });
  }
  return dbPromise;
}

async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  return req(fn(tx.objectStore(name)));
}

export function newId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

export function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

/* ------------------------------------------------------------------ mods */

export async function putMod(meta: ModMeta): Promise<void> {
  await withStore(STORES.mods, "readwrite", (s) => s.put(meta));
}

export async function getMod(id: string): Promise<ModMeta | null> {
  const row = await withStore<ModMeta | undefined>(STORES.mods, "readonly", (s) => s.get(id));
  return row ?? null;
}

export async function listMods(): Promise<ModMeta[]> {
  const rows = await withStore<ModMeta[]>(STORES.mods, "readonly", (s) => s.getAll());
  return rows.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
}

export async function deleteMod(id: string): Promise<void> {
  await withStore(STORES.mods, "readwrite", (s) => s.delete(id));
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORES.files, STORES.snapshots, STORES.memories, STORES.chats], "readwrite");
    for (const storeName of [STORES.files, STORES.snapshots, STORES.chats]) {
      const index = tx.objectStore(storeName).index("byMod");
      const cursorReq = index.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }
    tx.objectStore(STORES.memories).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Delete failed"));
  });
}

export async function readModFiles(modId: string): Promise<ProjectFile[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.files, "readonly");
    const out: ProjectFile[] = [];
    const cursorReq = tx.objectStore(STORES.files).index("byMod").openCursor(IDBKeyRange.only(modId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const row = cursor.value as ModFileRow;
        out.push({ path: row.path, content: row.content });
        cursor.continue();
      } else {
        out.sort((a, b) => a.path.localeCompare(b.path));
        resolve(out);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Read failed"));
  });
}

export async function writeModFile(modId: string, path: string, content: string): Promise<void> {
  const row: ModFileRow = { modId, path, content, size: bytesOf(content), updatedAt: new Date().toISOString() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.files, "readwrite");
    tx.objectStore(STORES.files).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Write failed"));
  });
  const meta = await getMod(modId);
  if (meta && !meta.filePaths.includes(path)) {
    await putMod({
      ...meta,
      filePaths: [...meta.filePaths, path].sort(),
      updatedAt: new Date().toISOString(),
      lastSavedAt: new Date().toISOString(),
      dirty: false,
    });
  } else if (meta) {
    await putMod({ ...meta, lastSavedAt: new Date().toISOString(), dirty: false, updatedAt: new Date().toISOString() });
  }
}

export async function deleteModFile(modId: string, path: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.files, "readwrite");
    tx.objectStore(STORES.files).delete([modId, path]);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Delete failed"));
  });
  const meta = await getMod(modId);
  if (meta) {
    await putMod({ ...meta, filePaths: meta.filePaths.filter((p) => p !== path), updatedAt: new Date().toISOString() });
  }
}

export async function createMod(input: {
  name: string;
  description?: string;
  files: ProjectFile[];
  sourceProjectId?: string | null;
  sourceProjectName?: string | null;
  sourceVersion?: string | null;
  sourceCommitSha?: string | null;
  imported?: boolean;
  entryFile?: string | null;
  kind?: string;
  runtimes?: string[];
  dependencies?: string[];
}): Promise<ModMeta> {
  const id = newId("mod");
  const now = new Date().toISOString();
  const meta: ModMeta = {
    id,
    name: input.name,
    description: input.description ?? "",
    sourceProjectId: input.sourceProjectId ?? null,
    sourceProjectName: input.sourceProjectName ?? null,
    sourceVersion: input.sourceVersion ?? null,
    sourceCommitSha: input.sourceCommitSha ?? null,
    modVersion: "0.1.0",
    localVersion: 1,
    storageMode: "indexeddb",
    folderHandleName: null,
    manifestPath: "vex.mod.json",
    entryFile: input.entryFile ?? null,
    kind: input.kind ?? "unknown",
    runtimes: input.runtimes ?? [],
    dependencies: input.dependencies ?? [],
    filePaths: input.files.map((f) => f.path).sort(),
    createdAt: now,
    updatedAt: now,
    lastSavedAt: now,
    dirty: false,
    imported: input.imported ?? false,
    memoryVersion: 1,
    indexVersion: 1,
    upstream: { latestVersion: null, latestCommitSha: null, checkedAt: null },
    testSummary: null,
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORES.mods, STORES.files], "readwrite");
    tx.objectStore(STORES.mods).put(meta);
    const store = tx.objectStore(STORES.files);
    for (const file of input.files) {
      store.put({ modId: id, path: file.path, content: file.content, size: bytesOf(file.content), updatedAt: now } satisfies ModFileRow);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save mod"));
  });

  await writeModManifest(meta, input.files);
  await createSnapshot(id, "Initial copy", input.imported ? "imported project" : "created from catalog project");
  return meta;
}

export async function writeModManifest(meta: ModMeta, files: ProjectFile[]): Promise<void> {
  const manifest = {
    modId: meta.id,
    name: meta.name,
    description: meta.description,
    modVersion: meta.modVersion,
    localVersion: meta.localVersion,
    source: {
      projectId: meta.sourceProjectId,
      projectName: meta.sourceProjectName,
      version: meta.sourceVersion,
      commitSha: meta.sourceCommitSha,
    },
    storage: meta.storageMode,
    entryFile: meta.entryFile,
    kind: meta.kind,
    runtimes: meta.runtimes,
    dependencies: meta.dependencies,
    files: files.map((f) => ({ path: f.path, bytes: bytesOf(f.content), language: languageOf(f.path) })),
    memoryVersion: meta.memoryVersion,
    indexVersion: meta.indexVersion,
    createdAt: meta.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await writeModFileRaw(meta.id, meta.manifestPath ?? "vex.mod.json", JSON.stringify(manifest, null, 2));
}

async function writeModFileRaw(modId: string, path: string, content: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.files, "readwrite");
    tx.objectStore(STORES.files).put({ modId, path, content, size: bytesOf(content), updatedAt: new Date().toISOString() } satisfies ModFileRow);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Write failed"));
  });
}

/* ------------------------------------------------------------- snapshots */

export async function createSnapshot(modId: string, label: string, reason: string): Promise<ModSnapshot> {
  const files = await readModFiles(modId);
  const snapshot: ModSnapshot = { id: newId("snap"), modId, label, reason, files, createdAt: new Date().toISOString() };
  await withStore(STORES.snapshots, "readwrite", (s) => s.put(snapshot));
  const all = await listSnapshots(modId);
  for (const old of all.slice(12)) await withStore(STORES.snapshots, "readwrite", (s) => s.delete(old.id));
  return snapshot;
}

export async function listSnapshots(modId: string): Promise<ModSnapshot[]> {
  const rows = await withStore<ModSnapshot[]>(STORES.snapshots, "readonly", (s) => s.getAll());
  return rows.filter((r) => r.modId === modId).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

export async function restoreSnapshot(snapshotId: string): Promise<ModSnapshot | null> {
  const snapshot = await withStore<ModSnapshot | undefined>(STORES.snapshots, "readonly", (s) => s.get(snapshotId));
  if (!snapshot) return null;
  const current = await readModFiles(snapshot.modId);
  await createSnapshot(snapshot.modId, "Pre-restore backup", `automatic backup before restoring ${snapshot.label}`);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.files, "readwrite");
    const store = tx.objectStore(STORES.files);
    for (const file of current) store.delete([snapshot.modId, file.path]);
    for (const file of snapshot.files) {
      store.put({ modId: snapshot.modId, path: file.path, content: file.content, size: bytesOf(file.content), updatedAt: new Date().toISOString() } satisfies ModFileRow);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Restore failed"));
  });
  const meta = await getMod(snapshot.modId);
  if (meta) await putMod({ ...meta, filePaths: snapshot.files.map((f) => f.path).sort(), updatedAt: new Date().toISOString() });
  return snapshot;
}

/* -------------------------------------------------------------- memory */

export async function getMemory(modId: string): Promise<ProjectMemory | null> {
  const row = await withStore<ProjectMemory | undefined>(STORES.memories, "readonly", (s) => s.get(modId));
  return row ?? null;
}

export async function putMemory(memory: ProjectMemory): Promise<void> {
  await withStore(STORES.memories, "readwrite", (s) => s.put(memory));
}

/* --------------------------------------------------------------- chats */

export async function listChats(modId: string): Promise<ChatTurn[]> {
  const rows = await withStore<ChatTurn[]>(STORES.chats, "readonly", (s) => s.getAll());
  return rows.filter((r) => r.modId === modId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addChatTurn(turn: ChatTurn): Promise<void> {
  await withStore(STORES.chats, "readwrite", (s) => s.put(turn));
}

export async function clearChats(modId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORES.chats, "readwrite");
    const index = tx.objectStore(STORES.chats).index("byMod");
    const cursorReq = index.openCursor(IDBKeyRange.only(modId));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else resolve();
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Clear failed"));
  });
}

/* ----------------------------------------------------------------- meta */

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await withStore<{ key: string; value: T } | undefined>(STORES.meta, "readonly", (s) => s.get(key));
  return row?.value ?? null;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await withStore(STORES.meta, "readwrite", (s) => s.put({ key, value }));
}

export type GuestIdentity = { guestId: string; label: string; createdAt: string };

export async function getGuestIdentity(): Promise<GuestIdentity> {
  const existing = await getMeta<GuestIdentity>("guest");
  if (existing) return existing;
  const identity: GuestIdentity = {
    guestId: newId("guest"),
    label: "Local workspace (not signed in)",
    createdAt: new Date().toISOString(),
  };
  await setMeta("guest", identity);
  return identity;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.().catch(() => false)) ?? false;
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

/* ------------------------------------------------------- import/export */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mod";
}

export async function exportModZip(modId: string): Promise<{ filename: string; bytes: number }> {
  const meta = await getMod(modId);
  if (!meta) throw new Error("Mod not found");
  const files = await readModFiles(modId);
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, file.content);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const filename = `${slugify(meta.name)}-v${meta.localVersion}.zip`;
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size };
}

export async function exportAllModsZip(): Promise<number> {
  const mods = await listMods();
  const zip = new JSZip();
  for (const mod of mods) {
    const files = await readModFiles(mod.id);
    const folder = zip.folder(slugify(mod.name));
    for (const file of files) folder?.file(file.path, file.content);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, `vex-studio-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  return blob.size;
}

export type ZipImportResult = {
  files: ProjectFile[];
  issues: { severity: "error" | "warning"; code: string; message: string }[];
  totalBytes: number;
};

export async function readZipToFiles(file: File, rootDir?: string): Promise<ZipImportResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  const scan = await scanZip(data, rootDir);
  return { files: scan.files, issues: scan.issues, totalBytes: scan.totalBytes };
}

/* --------------------------------------------- optional folder mirror */

export function folderAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickFolder(): Promise<{ name: string } | null> {
  if (!folderAccessSupported()) throw new Error("File System Access API is not available in this browser.");
  const handle = await (window as unknown as { showDirectoryPicker: (o?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({
    mode: "readwrite",
  });
  await setMeta("folderHandleName", handle.name);
  return { name: handle.name };
}

/** Best-effort mirror into a user-picked folder. Failures never lose IndexedDB data. */
export async function mirrorModToFolder(modId: string, folderName: string): Promise<{ written: number; error?: string }> {
  try {
    const handle = await (navigator.storage as unknown as { getDirectory?: () => Promise<FileSystemDirectoryHandle> }).getDirectory?.();
    if (!handle) throw new Error("Browser did not restore a directory handle; pick the folder again.");
    const root = await handle.getDirectoryHandle(folderName, { create: true });
    const mod = await getMod(modId);
    const modDir = await root.getDirectoryHandle(slugify(mod?.name ?? modId), { create: true });
    const files = await readModFiles(modId);
    for (const file of files) {
      const parts = file.path.split("/");
      const fileName = parts.pop();
      if (!fileName) continue;
      let dir = modDir;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const fileHandle = await dir.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file.content);
      await writable.close();
    }
    return { written: files.length };
  } catch (error) {
    return { written: 0, error: error instanceof Error ? error.message : "Folder write failed" };
  }
}
