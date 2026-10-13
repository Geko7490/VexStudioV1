/** Shared, dependency-free path validation used by ZIP extraction and GitHub publishing. */

export const FORBIDDEN_EXTENSIONS = [
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bat",
  ".cmd",
  ".msi",
  ".apk",
  ".dmg",
  ".jar",
  ".ps1",
  ".vbs",
];

export const MAX_ZIP_BYTES = 30 * 1024 * 1024; // 30 MB upload cap
export const MAX_TOTAL_UNCOMPRESSED = 80 * 1024 * 1024; // decompression bomb guard
export const MAX_FILES = 1200;
export const MAX_SINGLE_FILE = 2 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 400;

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Rejects traversal, absolute paths, drive letters, UNC paths and NUL bytes. */
export function normalizeArchivePath(rawPath: string): PathCheck {
  if (!rawPath || rawPath.length > 400) return { ok: false, reason: "invalid_path_length" };
  if (rawPath.includes("\0")) return { ok: false, reason: "null_byte" };
  if (/^[a-zA-Z]:[\\/]/.test(rawPath)) return { ok: false, reason: "windows_drive_path" };
  if (/^\\\\/.test(rawPath)) return { ok: false, reason: "unc_path" };
  if (rawPath.startsWith("/") || rawPath.startsWith("\\")) return { ok: false, reason: "absolute_path" };

  const parts = rawPath.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") return { ok: false, reason: "path_traversal" };
    out.push(part);
  }
  if (out.length === 0) return { ok: false, reason: "empty_path" };
  return { ok: true, path: out.join("/") };
}

export function hasForbiddenExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return FORBIDDEN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.08;
}

export function assertSafeProjectPath(path: string) {
  const check = normalizeArchivePath(path);
  if (!check.ok) throw new Error(`Unsafe project path (${check.reason}): ${path}`);
  if (hasForbiddenExtension(check.path)) throw new Error(`Forbidden file type: ${check.path}`);
  return check.path;
}
