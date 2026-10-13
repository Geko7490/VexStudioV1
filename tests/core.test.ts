import assert from "node:assert/strict";
import test from "node:test";
import { diffLines, diffStat, parseProposedChanges, unifiedDiff } from "../src/lib/diff.ts";
import { merge3, merge3Text } from "../src/lib/merge.ts";
import { buildIndex, queryRelevantFiles, resolveImport, summarizeArchitecture, tokenize } from "../src/lib/indexer.ts";
import { buildManifest, detectProject, runStaticChecks, slugifyId } from "../src/lib/project-analyze.ts";
import { normalizeArchivePath, hasForbiddenExtension } from "../src/lib/paths.ts";

test("diffLines reports additions, removals and equal lines", () => {
  const ops = diffLines("a\nb\nc", "a\nB\nc\nd");
  assert.equal(ops.filter((op) => op.type === "remove").length, 1);
  assert.equal(ops.filter((op) => op.type === "add").length, 2);
  const stat = diffStat("a\nb", "a\nb");
  assert.equal(stat.changed, false);
});

test("unifiedDiff groups changes with context", () => {
  const base = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  const next = base.replace("line 20", "line 20 changed");
  const hunks = unifiedDiff(base, next, 2);
  assert.equal(hunks.length, 1);
  assert.ok(hunks[0].header.startsWith("@@"));
  assert.ok(hunks[0].ops.some((op) => op.type === "add"));
});

test("merge3 takes ours when only theirs changed and conflicts on double edits", () => {
  const base = "one\ntwo\nthree";
  const ours = "one\ntwo\nthree-plus";
  const theirs = "one\ntwo\nthree";
  const clean = merge3(base.split("\n"), ours.split("\n"), theirs.split("\n"));
  assert.equal(clean.clean, true);
  assert.equal(clean.lines.join("\n"), ours);

  const conflict = merge3Text("a\nb\nc", "a\nours\nc", "a\ntheirs\nc");
  assert.equal(conflict.clean, false);
  assert.equal(conflict.conflicts.length, 1);
  assert.ok(conflict.lines.some((line) => line.startsWith("<<<<<<<")));
});

test("indexer extracts symbols, imports and relevance", () => {
  const files = [
    { path: "index.html", content: "<!doctype html>\n<html><head><title>Vex</title></head><body><script src=\"game.js\"></script></body></html>" },
    { path: "game.js", content: "import { spawnEnemy } from './enemies.js'\nexport class Game {}\nexport function resetGame() {}\n" },
    { path: "enemies.js", content: "export function spawnEnemy(count) {}\nfunction despawnEnemy() {}\n" },
    { path: "readme.md", content: "# Vex Arena\nA tiny game about enemies." },
  ];
  const index = buildIndex(files);
  assert.equal(index.fileCount, 4);
  assert.ok(index.entryPoints.includes("index.html"));
  assert.ok(index.relations.some((rel) => rel.from === "game.js" && rel.to === "enemies.js"));
  assert.equal(resolveImport("game.js", "./enemies.js", new Set(files.map((f) => f.path))), "enemies.js");

  const hits = queryRelevantFiles(index, "fix the spawnEnemy enemy logic", 3);
  assert.equal(hits[0].path, "enemies.js");
  assert.ok(tokenize("fix the inventory system").includes("inventory"));

  const summary = summarizeArchitecture(index, files);
  assert.equal(summary.technologies.includes("HTML"), true);
  assert.ok(summary.warnings.length >= 0);
});

test("detectProject classifies web, python, node and cpp projects", () => {
  const web = detectProject([{ path: "index.html", content: "<!doctype html><html><title>x</title></html>" }]);
  assert.equal(web.kind, "web");
  const py = detectProject([{ path: "main.py", content: "if __name__ == '__main__':\n    print('hi')\n" }]);
  assert.equal(py.kind, "python");
  const node = detectProject([{ path: "package.json", content: JSON.stringify({ dependencies: { next: "15.0.0" }, scripts: { start: "next start" } }) }]);
  assert.equal(node.kind, "node");
  assert.equal(node.runtimeSupport["node-webcontainer"], "unsupported");
  const cpp = detectProject([{ path: "main.cpp", content: "int main() { return 0; }" }]);
  assert.equal(cpp.kind, "cpp");
});

test("static checks catch unresolved assets and hardcoded secrets", () => {
  const bad = runStaticChecks([
    { path: "index.html", content: "<!doctype html><html><title>x</title><script src=\"missing.js\"></script></html>" },
    { path: "config.js", content: "const key = 'sk-abcdefghijklmnopqrstuvwx';" },
  ]);
  assert.equal(bad.summary, "fail");
  assert.ok(bad.checks.some((c) => c.id === "html-assets" && c.status === "fail"));
  assert.ok(bad.checks.some((c) => c.id === "secrets" && c.status === "fail"));

  const good = runStaticChecks([{ path: "index.html", content: "<!doctype html><html><title>x</title><script src=\"app.js\"></script></html>" }, { path: "app.js", content: "console.log('ok')" }]);
  assert.equal(good.summary, "pass");
});

test("archive path validation blocks traversal and absolute paths", () => {
  for (const evil of ["../evil.txt", "/etc/passwd", "C:\\Windows\\system32\\x.dll", "\\\\server\\share\\f", "a/../../b"]) {
    assert.equal(normalizeArchivePath(evil).ok, false, evil);
  }
  assert.equal(normalizeArchivePath("src/lib/app.ts").ok, true);
  assert.equal(hasForbiddenExtension("bin/tool.exe"), true);
  assert.equal(slugifyId("Vex Orbit Deluxe!"), "vex-orbit-deluxe");
});

test("manifest reflects the detected project", () => {
  const manifest = buildManifest({ id: "demo", name: "Demo", description: "d", version: "1.0.0", files: [{ path: "index.html", content: "<!doctype html><html><title>t</title></html>" }] });
  assert.equal(manifest.kind, "web");
  assert.equal(manifest.fileCount, 1);
  assert.equal(manifest.testStatus, "not_run");
});

test("role derivation fails closed without an owner id", () => {
  const cfg = { githubId: null, adminDisabled: false };
  assert.equal(deriveRole(123, cfg), "user");
  assert.equal(deriveRole(123, { githubId: 123, adminDisabled: false }), "owner");
  assert.equal(deriveRole(124, { githubId: 123, adminDisabled: false }), "user");
  assert.equal(deriveRole(123, { githubId: 123, adminDisabled: true }), "user");
  assert.equal(deriveRole(0, { githubId: 123, adminDisabled: false }), "user");
});
import { deriveRole } from "../src/lib/roles.ts";
