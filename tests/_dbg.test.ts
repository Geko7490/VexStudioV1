import test from "node:test";
import JSZip from "jszip";
import { scanZip } from "../src/lib/zip-safe.ts";

function patchAsciiBytes(data: Uint8Array, from: string, to: string): Uint8Array {
  const fromBytes = new TextEncoder().encode(from);
  const toBytes = new TextEncoder().encode(to);
  const out = new Uint8Array(data);
  for (let i = 0; i <= out.length - fromBytes.length; i++) {
    let matched = true;
    for (let j = 0; j < fromBytes.length; j++) if (out[i + j] !== fromBytes[j]) { matched = false; break; }
    if (matched) { out.set(toBytes, i); i += fromBytes.length - 1; }
  }
  return out;
}

test("debug traversal", async () => {
  const zip = new JSZip();
  zip.file("index.html", "<p>ok</p>");
  zip.file("xAAEVIL.txt", "pwned");
  const data = await zip.generateAsync({ type: "uint8array" });
  const patched = patchAsciiBytes(data, "xAAEVIL.txt", "../evil.txt");
  const res = await scanZip(patched);
  console.log("issues:", JSON.stringify(res.issues));
  console.log("files:", res.files.map((f) => f.path), "ok:", res.ok);
});
