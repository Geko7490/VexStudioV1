import JSZip from "jszip";
import {
  MAX_COMPRESSION_RATIO,
  MAX_FILES,
  MAX_SINGLE_FILE,
  MAX_TOTAL_UNCOMPRESSED,
  MAX_ZIP_BYTES,
  hasForbiddenExtension,
  looksBinary,
  normalizeArchivePath,
} from "./paths";

export { MAX_FILES, MAX_SINGLE_FILE, MAX_TOTAL_UNCOMPRESSED, MAX_ZIP_BYTES };

export type ExtractedFile = { path: string; content: string; size: number };
export type ZipIssue = { severity: "error" | "warning"; code: string; message: string };

export type ZipScanResult = {
  ok: boolean;
  files: ExtractedFile[];
  issues: ZipIssue[];
  totalBytes: number;
  entryCount: number;
};

function isZip(data: Uint8Array): boolean {
  // Local file header signature "PK\x03\x04" or empty-spanning "PK\x05\x06".
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5);
}

/**
 * Reads entry names straight from the ZIP headers.
 * Some libraries silently sanitise hostile names while unpacking, which would
 * hide the attack instead of reporting it, so we inspect the raw bytes too.
 */
function rawEntryNames(data: Uint8Array): string[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const names: string[] = [];
  const latin1 = (start: number, length: number) => {
    let out = "";
    for (let i = 0; i < length; i++) out += String.fromCharCode(data[start + i]);
    return out;
  };

  for (let i = 0; i + 4 <= data.length - 3; i++) {
    if (data[i] !== 0x50 || data[i + 1] !== 0x4b) continue;
    const signature = data[i + 2] | (data[i + 3] << 8);
    if (signature !== 0x0304 && signature !== 0x0201) continue;
    const headerSize = signature === 0x0304 ? 30 : 46;
    if (i + headerSize + 2 > data.length) break;
    try {
      const nameLength = view.getUint16(i + (signature === 0x0304 ? 26 : 28), true);
      if (nameLength === 0 || nameLength > 400 || i + headerSize + nameLength > data.length) continue;
      names.push(latin1(i + headerSize, nameLength));
    } catch {
      break;
    }
  }
  return names;
}

/**
 * Defence-in-depth ZIP extraction:
 * signature, size caps, entry caps, compression-ratio (archive bomb),
 * traversal/absolute/symlink rejection, forbidden extensions, binary skipping.
 */
export async function scanZip(data: Uint8Array, rootDir?: string): Promise<ZipScanResult> {
  const issues: ZipIssue[] = [];
  const files: ExtractedFile[] = [];

  if (data.byteLength === 0) {
    return { ok: false, files, issues: [{ severity: "error", code: "empty_upload", message: "The uploaded file is empty." }], totalBytes: 0, entryCount: 0 };
  }
  if (data.byteLength > MAX_ZIP_BYTES) {
    return {
      ok: false,
      files,
      issues: [{ severity: "error", code: "archive_too_large", message: `Archive exceeds the ${MAX_ZIP_BYTES / 1024 / 1024} MB limit.` }],
      totalBytes: 0,
      entryCount: 0,
    };
  }
  if (!isZip(data)) {
    return {
      ok: false,
      files,
      issues: [{ severity: "error", code: "not_a_zip", message: "The file is not a ZIP archive (missing PK signature)." }],
      totalBytes: 0,
      entryCount: 0,
    };
  }

  for (const rawName of rawEntryNames(data)) {
    const rawCheck = normalizeArchivePath(rawName);
    if (!rawCheck.ok) {
      issues.push({
        severity: "error",
        code: rawCheck.reason,
        message: `Rejected raw archive entry "${rawName.slice(0, 120)}" (${rawCheck.reason}).`,
      });
    }
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data, { checkCRC32: true });
  } catch (error) {
    return {
      ok: false,
      files,
      issues: [{ severity: "error", code: "corrupt_zip", message: `Archive could not be read: ${error instanceof Error ? error.message : "unknown"}` }],
      totalBytes: 0,
      entryCount: 0,
    };
  }

  const entries = Object.values(zip.files);
  let totalBytes = 0;

  if (entries.length > MAX_FILES) {
    issues.push({ severity: "error", code: "too_many_entries", message: `Archive contains ${entries.length} entries (limit ${MAX_FILES}).` });
  }

  for (const entry of entries) {
    const check = normalizeArchivePath(entry.name);
    if (!check.ok) {
      issues.push({ severity: "error", code: check.reason, message: `Rejected unsafe entry "${entry.name}" (${check.reason}).` });
      continue;
    }
    if (entry.dir) continue;

    const mode = typeof entry.unixPermissions === "number" ? entry.unixPermissions : null;
    if (mode !== null && ((mode >> 12) & 0xf) === 0xa) {
      issues.push({ severity: "error", code: "symlink_entry", message: `Rejected symlink entry "${check.path}".` });
      continue;
    }
    if (hasForbiddenExtension(check.path)) {
      issues.push({ severity: "warning", code: "forbidden_extension", message: `Skipped "${check.path}" (executable/binary type not allowed).` });
      continue;
    }

    const uncompressed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    const compressed = (entry as unknown as { _data?: { compressedSize?: number } })._data?.compressedSize ?? 0;
    if (compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO) {
      issues.push({ severity: "error", code: "compression_bomb", message: `Rejected "${check.path}" (compression ratio ${Math.round(uncompressed / compressed)}).` });
      continue;
    }
    if (uncompressed > MAX_SINGLE_FILE) {
      issues.push({ severity: "warning", code: "file_too_large", message: `Skipped "${check.path}" (larger than ${MAX_SINGLE_FILE / 1024 / 1024} MB).` });
      continue;
    }

    const bytes = await entry.async("uint8array");
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED) {
      issues.push({ severity: "error", code: "uncompressed_too_large", message: `Decompressed content exceeds ${MAX_TOTAL_UNCOMPRESSED / 1024 / 1024} MB. Extraction stopped.` });
      break;
    }
    if (looksBinary(bytes)) {
      issues.push({ severity: "warning", code: "binary_skipped", message: `Skipped binary file "${check.path}" (text projects only).` });
      continue;
    }

    let path = check.path;
    if (rootDir) {
      const prefix = `${rootDir.replace(/\/+$/, "")}/`;
      if (!path.startsWith(prefix)) continue;
      path = path.slice(prefix.length);
      if (!path) continue;
    }

    files.push({ path, content: new TextDecoder("utf-8").decode(bytes), size: bytes.length });
  }

  const hasError = issues.some((i) => i.severity === "error");
  return { ok: !hasError && files.length > 0, files, issues, totalBytes, entryCount: entries.length };
}
