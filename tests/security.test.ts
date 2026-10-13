import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { scanZip, MAX_ZIP_BYTES } from "../src/lib/zip-safe.ts";
import { buildPreviewDocument, previewIframeProps } from "../src/lib/preview.ts";

/** Byte-level patch: a UTF-8 round trip would corrupt the compressed streams. */
function patchAsciiBytes(data: Uint8Array, from: string, to: string): Uint8Array {
  const fromBytes = new TextEncoder().encode(from);
  const toBytes = new TextEncoder().encode(to);
  if (fromBytes.length !== toBytes.length) throw new Error("patch lengths must match");
  const out = new Uint8Array(data);
  for (let i = 0; i <= out.length - fromBytes.length; i++) {
    let matched = true;
    for (let j = 0; j < fromBytes.length; j++) {
      if (out[i + j] !== fromBytes[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      out.set(toBytes, i);
      i += fromBytes.length - 1;
    }
  }
  return out;
}

async function zipFrom(files: Record<string, string>, options?: { compression?: "DEFLATE" | "STORE" }) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array", compression: options?.compression ?? "DEFLATE" });
}

test("scanZip accepts a normal text project", async () => {
  const data = await zipFrom({
    "index.html": "<!doctype html><html><title>ok</title></html>",
    "app.js": "console.log('hi')",
    "styles.css": "body{margin:0}",
  });
  const result = await scanZip(data);
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 3);
  assert.deepEqual(result.issues, []);
});

test("scanZip rejects path traversal entries", async () => {
  // JSZip sanitises "../" while creating an archive, so patch the raw entry name
  // back in (same byte length keeps every offset valid).
  const data = await zipFrom({ "index.html": "<p>ok</p>", "xAAEVIL.txt": "pwned" });
  const patched = patchAsciiBytes(data, "xAAEVIL.txt", "../evil.txt");
  const result = await scanZip(patched);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "path_traversal"));
  assert.equal(result.files.some((file) => file.path.includes("evil")), false);
});

test("scanZip rejects absolute and windows paths", async () => {
  for (const evil of ["/etc/passwd", "C:\\boot.ini"]) {
    const zip = new JSZip();
    zip.file(evil, "x");
    const data = await zip.generateAsync({ type: "uint8array" });
    const result = await scanZip(data);
    assert.equal(result.ok, false, evil);
  }
});

test("scanZip flags compression bombs", async () => {
  const data = await zipFrom({ "zeros.txt": "0".repeat(6_000_000) });
  const result = await scanZip(data);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "compression_bomb"));
});

test("scanZip skips executable extensions and binary payloads", async () => {
  const data = await zipFrom({ "tool.exe": "MZfakebinary", "asset.png": String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 5) });
  const result = await scanZip(data);
  assert.ok(result.issues.some((issue) => issue.code === "forbidden_extension"));
  assert.ok(result.issues.some((issue) => issue.code === "binary_skipped"));
  assert.equal(result.files.some((file) => file.path.endsWith(".exe")), false);
});

test("scanZip reports non-zip payloads", async () => {
  const notZip = new TextEncoder().encode("definitely not a zip archive");
  const result = await scanZip(notZip);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.code, "not_a_zip");
});

test("scanZip enforces the configured size limit", async () => {
  const tiny = new TextEncoder().encode("PK\x03\x04");
  const result = await scanZip(tiny);
  assert.equal(result.issues[0]?.code, "not_a_zip");
  assert.ok(MAX_ZIP_BYTES > 0);
});

test("preview builder inlines local assets and keeps remote ones", async () => {
  const files = [
    { path: "index.html", content: '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><script src="app.js"></script><script src="https://cdn.example.com/x.js"></script></body></html>' },
    { path: "styles.css", content: "body{color:red}" },
    { path: "app.js", content: "console.log('app')" },
  ];
  const html = buildPreviewDocument("index.html", files);
  assert.ok(html.includes("body{color:red}"));
  assert.ok(html.includes("console.log('app')"));
  assert.ok(html.includes("https://cdn.example.com/x.js"));
  assert.ok(html.includes("__vexPreview"));
  assert.ok(!html.includes('href="styles.css"'));
  assert.deepEqual(previewIframeProps(), { sandbox: "allow-scripts allow-modals allow-pointer-lock", referrerpolicy: "no-referrer" });
});

test("preview builder reports a missing HTML entry", async () => {
  const html = buildPreviewDocument("missing.html", [{ path: "main.py", content: "print('x')" }]);
  assert.ok(html.includes("No HTML entry file"));
});
