import type { ProjectMemory } from "@/lib/local-store";
import { parseProposedChanges } from "@/lib/diff";
import { queryRelevantFiles, summarizeArchitecture, type ProjectIndex } from "@/lib/indexer";
import type { ProjectFile } from "@/lib/project-analyze";

export type ContextPackage = {
  systemPrompt: string;
  contextBlock: string;
  usedFiles: { path: string; lines: number; reason: string }[];
  truncated: boolean;
  totalLines: number;
  indexUsed: boolean;
};

const DEFAULT_MAX_LINES = 550;

/**
 * Selects the smallest useful context for the request. Files the model never
 * receives are reported in `usedFiles`, so the UI can show exactly what was read.
 */
export function buildContextPackage(input: {
  files: ProjectFile[];
  index: ProjectIndex;
  query: string;
  openPath?: string | null;
  memory?: ProjectMemory | null;
  maxLines?: number;
}): ContextPackage {
  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES;
  const byPath = new Map(input.files.map((f) => [f.path, f]));
  const selected: { path: string; lines: number; reason: string }[] = [];
  let usedIndex = false;

  const add = (path: string, reason: string) => {
    const file = byPath.get(path);
    if (!file || selected.some((s) => s.path === path)) return;
    selected.push({ path, lines: file.content.length === 0 ? 0 : file.content.split("\n").length, reason });
  };

  if (input.openPath) add(input.openPath, "open in editor");

  const ranked = input.query.trim() ? queryRelevantFiles(input.index, input.query, 6) : [];
  if (ranked.length > 0) usedIndex = true;
  for (const hit of ranked) add(hit.path, hit.reasons.slice(0, 2).join(", ") || "index match");

  const architecture = summarizeArchitecture(input.index, input.files);
  for (const entry of architecture.entryPoints.slice(0, 2)) add(entry, "entry point");
  for (const path of architecture.configFiles.slice(0, 2)) add(path, "manifest/config");

  let totalLines = selected.reduce((sum, s) => sum + s.lines, 0);
  let truncated = false;
  while (totalLines > maxLines && selected.length > 1) {
    const removed = selected.pop();
    if (!removed) break;
    totalLines -= removed.lines;
    truncated = true;
  }

  const contextBlock = selected
    .map((item) => {
      const file = byPath.get(item.path);
      if (!file) return "";
      return `/* ===== FILE: ${item.path} (${item.lines} lines, reason: ${item.reason}) ===== */\n${file.content}`;
    })
      .filter(Boolean)
      .join("\n\n");

  const memoryBlock = input.memory
    ? [
        `Project purpose: ${input.memory.purpose}`,
        `Architecture: ${input.memory.architecture}`,
        input.memory.modules.length ? `Modules: ${input.memory.modules.join(", ")}` : "",
        input.memory.technologies.length ? `Technologies: ${input.memory.technologies.join(", ")}` : "",
        input.memory.knownIssues.length ? `Known issues: ${input.memory.knownIssues.join("; ")}` : "",
        input.memory.preferences.length ? `User preferences: ${input.memory.preferences.join("; ")}` : "",
        input.memory.changes.length
          ? `Recent changes: ${input.memory.changes
              .slice(0, 5)
              .map((c) => `${c.at.slice(0, 10)} ${c.summary}`)
              .join("; ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "No project memory stored yet.";

  const systemPrompt = [
    "You are the Vex Studio coding assistant. You work inside the user's browser on a local model.",
    "Only the files in the CONTEXT block have been read. Never claim to have read other files.",
    "When you change code, output one fenced code block per file and put the target file path as the first line of the block as a comment (// path/to/file.js or # path/to/file.py).",
    "Prefer small, complete files that can replace the original. Explain briefly before the code.",
    "If the request needs a file that is not in the context, say which file you would need instead of inventing content.",
    "",
    "PROJECT MEMORY",
    memoryBlock,
    "",
    "PROJECT ARCHITECTURE (deterministic analysis)",
    `Entry points: ${architecture.entryPoints.join(", ") || "none detected"}`,
    `Files: ${input.files.length} · Lines: ${input.index.stats.lines} · Symbols: ${input.index.stats.symbols} · Import edges: ${input.index.stats.imports}`,
    `Modules: ${architecture.modules.map((m) => `${m.name}(${m.files})`).join(", ") || "none"}`,
    `Dependencies: ${architecture.dependencies.join(", ") || "none declared"}`,
    architecture.warnings.length ? `Notes: ${architecture.warnings.join(" ")}` : "",
    "",
    "CONTEXT",
    contextBlock || "(no file content selected — answer from the architecture summary only)",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    systemPrompt,
    contextBlock,
    usedFiles: selected,
    truncated,
    totalLines,
    indexUsed: usedIndex,
  };
}

export type Proposal = { path: string; before: string; after: string; created: boolean };

export type ProposalParse = { proposals: Proposal[]; unmatched: { path: string; content: string }[] };

const PATH_LIKE = /[\w./-]+\.(?:html?|css|js|mjs|jsx|ts|tsx|json|py|md|txt|yml|yaml)/g;

/** Turns a model answer into concrete per-file changes that the user can review. */
export function parseProposals(answer: string, files: ProjectFile[]): ProposalParse {
  const known = new Set(files.map((f) => f.path));
  const fences = parseProposedChanges(answer);
  const proposals: Proposal[] = [];
  const unmatched: { path: string; content: string }[] = [];

  const mentions: { path: string; index: number }[] = [];
  for (const match of answer.matchAll(PATH_LIKE)) {
    const candidate = match[0].replace(/^\.\//, "");
    if (known.has(candidate)) mentions.push({ path: candidate, index: match.index ?? 0 });
  }

  for (const fence of fences) {
    if (fence.path && known.has(fence.path)) {
      const before = files.find((f) => f.path === fence.path)?.content ?? "";
      proposals.push({ path: fence.path, before, after: fence.content, created: !files.some((f) => f.path === fence.path) });
      continue;
    }

    // Assign the closest path mention that appears before this fence.
    const fenceIndex = answer.indexOf(fence.content);
    const candidates = mentions.filter((m) => m.index < fenceIndex);
    const nearest = candidates[candidates.length - 1];
    if (nearest && known.has(nearest.path)) {
      const before = files.find((f) => f.path === nearest.path)?.content ?? "";
      proposals.push({ path: nearest.path, before, after: fence.content, created: false });
    } else if (fence.path) {
      unmatched.push({ path: fence.path, content: fence.content });
    } else {
      unmatched.push({ path: "(unknown file)", content: fence.content });
    }
  }

  const seen = new Set<string>();
  const deduped = proposals.filter((p) => (seen.has(p.path) ? false : (seen.add(p.path), true)));
  return { proposals: deduped, unmatched };
}

export function memoryFromAnalysis(index: ProjectIndex, files: ProjectFile[]): ProjectMemory {
  const architecture = summarizeArchitecture(index, files);
  return {
    modId: "",
    purpose: architecture.purpose,
    architecture: `${files.length} files, ${index.stats.lines} lines, entry: ${architecture.entryPoints.join(", ") || "unknown"}`,
    modules: architecture.modules.map((m) => `${m.name} (${m.files} files)`),
    technologies: architecture.technologies,
    importantFiles: [...architecture.entryPoints, ...architecture.largestFiles.map((f) => f.path)].slice(0, 8),
    changes: [],
    preferences: [],
    knownIssues: architecture.warnings,
    testResults: [],
    decisions: [],
    updatedAt: new Date().toISOString(),
    sourceIndexVersion: index.indexVersion,
  };
}
