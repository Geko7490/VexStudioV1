import { languageOf, type ProjectFile } from "./project-analyze";

export type SymbolKind = "function" | "class" | "const" | "route" | "method" | "style" | "section";
export type SymbolInfo = { name: string; kind: SymbolKind; line: number };

export type IndexChunk = { start: number; end: number; preview: string };

export type IndexedFile = {
  path: string;
  language: string;
  bytes: number;
  lines: number;
  symbols: SymbolInfo[];
  imports: string[];
  exports: string[];
  chunks: IndexChunk[];
};

export type ProjectIndex = {
  indexVersion: number;
  generatedAt: string;
  fileCount: number;
  totalBytes: number;
  files: IndexedFile[];
  relations: { from: string; to: string; kind: "import" }[];
  entryPoints: string[];
  testFiles: string[];
  configFiles: string[];
  modules: { name: string; files: string[] }[];
  stats: { symbols: number; imports: number; lines: number };
};

const CHUNK_LINES = 120;

const SYMBOL_PATTERNS: { re: RegExp; kind: SymbolKind }[] = [
  { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, kind: "function" },
  { re: /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, kind: "function" },
  { re: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, kind: "class" },
  { re: /^\s*(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/, kind: "class" },
  { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/, kind: "const" },
  { re: /^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/, kind: "function" },
  { re: /^\s*export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD)/, kind: "route" },
  { re: /^\s{2,}(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/, kind: "method" },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/, kind: "function" },
  { re: /^\s*class\s+([A-Za-z0-9_]+)\s*[(:]/, kind: "class" },
  { re: /^\s*\.([-A-Za-z0-9_]+)\s*\{/, kind: "style" },
  { re: /^#{1,3}\s+(.{3,60})\s*$/, kind: "section" },
];

const IMPORT_PATTERNS: RegExp[] = [
  /import\s+(?:type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /export\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*import\s+([A-Za-z0-9_.]+)\s*$/gm,
  /^\s*from\s+([A-Za-z0-9_.]+)\s+import\s/gm,
];

function extractSymbols(content: string): SymbolInfo[] {
  const lines = content.split("\n");
  const symbols: SymbolInfo[] = [];
  lines.forEach((line, idx) => {
    if (line.length > 300) return;
    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern.re);
      if (match?.[1]) {
        const name = match[1].trim();
        if (name && !symbols.some((s) => s.name === name && s.line === idx + 1)) {
          symbols.push({ name, kind: pattern.kind, line: idx + 1 });
        }
        break;
      }
    }
  });
  return symbols.slice(0, 300);
}

function extractImports(content: string): string[] {
  const found = new Set<string>();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) found.add(match[1]);
  }
  return [...found].slice(0, 200);
}

function extractExports(content: string): string[] {
  const found = new Set<string>();
  const re = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface)\s+([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) found.add(match[1]);
  return [...found].slice(0, 200);
}

function chunk(content: string): IndexChunk[] {
  const lines = content.split("\n");
  const chunks: IndexChunk[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    chunks.push({
      start: i + 1,
      end: Math.min(lines.length, i + CHUNK_LINES),
      preview: lines.slice(i, i + 6).join("\n").slice(0, 400),
    });
  }
  return chunks;
}

/** Resolves a relative import specifier to a file inside the index, if possible. */
export function resolveImport(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const dirParts = fromPath.split("/").slice(0, -1);
  const specParts = specifier.replace(/^\//, "").split("/");
  const stack = specifier.startsWith("/") ? [] : [...dirParts];
  for (const part of specParts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  const candidates = [base, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}.mjs`, `${base}.py`, `${base}.css`, `${base}/index.js`, `${base}/index.ts`, `${base}/__init__.py`];
  for (const candidate of candidates) if (knownPaths.has(candidate)) return candidate;
  return null;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "be", "fix", "add",
  "make", "create", "change", "update", "please", "should", "would", "it", "this", "that", "my", "me",
  "how", "what", "why", "when", "do", "does", "can", "you", "i", "we", "use", "using", "into", "from",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_$.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 64);
}

/** Builds a real, deterministic index of the mod's files. */
export function buildIndex(files: ProjectFile[], indexVersion = 1): ProjectIndex {
  const knownPaths = new Set(files.map((f) => f.path));
  const indexed: IndexedFile[] = files.map((file) => ({
    path: file.path,
    language: languageOf(file.path),
    bytes: new TextEncoder().encode(file.content).length,
    lines: file.content.length === 0 ? 0 : file.content.split("\n").length,
    symbols: extractSymbols(file.content),
    imports: extractImports(file.content),
    exports: extractExports(file.content),
    chunks: chunk(file.content),
  }));

  const relations: ProjectIndex["relations"] = [];
  for (const file of indexed) {
    for (const spec of file.imports) {
      const resolved = resolveImport(file.path, spec, knownPaths);
      if (resolved && resolved !== file.path) relations.push({ from: file.path, to: resolved, kind: "import" });
    }
  }

  const modules = new Map<string, string[]>();
  for (const file of indexed) {
    const parts = file.path.split("/");
    const name = parts.length === 1 ? "(root)" : parts.slice(0, -1).join("/");
    modules.set(name, [...(modules.get(name) ?? []), file.path]);
  }

  const lowerPaths = (p: string) => p.toLowerCase();
  return {
    indexVersion,
    generatedAt: new Date().toISOString(),
    fileCount: indexed.length,
    totalBytes: indexed.reduce((sum, f) => sum + f.bytes, 0),
    files: indexed,
    relations,
    entryPoints: indexed.filter((f) => /(^|\/)(index\.html|main\.(py|js|ts|tsx)|app\.(py|js|ts)|__main__\.py|run\.py)$/i.test(lowerPaths(f.path))).map((f) => f.path),
    testFiles: indexed.filter((f) => /(^|\/)(test|tests|__tests__)\/|(\.|_)test\.|_test\.py$/i.test(f.path)).map((f) => f.path),
    configFiles: indexed
      .filter((f) => /package\.json$|requirements\.txt$|tsconfig|\.config\.|vite\.config|next\.config|pyproject\.toml|manifest\.json$|\.env\.example$/i.test(f.path))
      .map((f) => f.path),
    modules: [...modules.entries()].map(([name, list]) => ({ name, files: list })),
    stats: {
      symbols: indexed.reduce((sum, f) => sum + f.symbols.length, 0),
      imports: relations.length,
      lines: indexed.reduce((sum, f) => sum + f.lines, 0),
    },
  };
}

export type RelevantFile = { path: string; score: number; reasons: string[] };

/** Keyword + symbol + graph scoring over the index. Purely local, no model needed. */
export function queryRelevantFiles(index: ProjectIndex, query: string, limit = 6): RelevantFile[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return index.files.slice(0, limit).map((f) => ({ path: f.path, score: 0, reasons: ["no query tokens: first files"] }));
  }

  const scored = index.files.map((file) => {
    let score = 0;
    const reasons: string[] = [];
    const pathTokens = tokenize(file.path.replace(/[/_.]/g, " "));
    const symbolNames = file.symbols.map((s) => s.name.toLowerCase());

    for (const token of tokens) {
      if (pathTokens.some((p) => p.includes(token) || token.includes(p))) {
        score += 5;
        reasons.push(`path matches "${token}"`);
      }
      const symbol = symbolNames.find((s) => s.toLowerCase() === token || s.toLowerCase().includes(token));
      if (symbol) {
        score += 6;
        reasons.push(`defines ${symbol}`);
      }
    }

    if (index.entryPoints.includes(file.path)) score += 1.5;
    if (index.testFiles.includes(file.path)) score += 0.5;
    if (file.lines > 1200) score -= 1;

    return { path: file.path, score, reasons: [...new Set(reasons)] };
  });

  const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  // Boost files that are imported by the top matches (dependency closure).
  const top = ranked.slice(0, limit);
  const topSet = new Set(top.map((t) => t.path));
  for (const rel of index.relations) {
    if (topSet.has(rel.from) && !topSet.has(rel.to)) {
      const target = ranked.find((r) => r.path === rel.to);
      if (target) {
        target.score += 2;
        target.reasons.push(`imported by ${rel.from}`);
      }
    }
  }

  return [...top, ...ranked.filter((r) => !topSet.has(r.path) && r.score > 2)]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type ArchitectureSummary = {
  purpose: string;
  entryPoints: string[];
  modules: { name: string; files: number; lines: number }[];
  technologies: string[];
  dependencies: string[];
  testFiles: string[];
  configFiles: string[];
  largestFiles: { path: string; lines: number }[];
  warnings: string[];
};

/** Deterministic architecture report, used for project memory and the AI context header. */
export function summarizeArchitecture(index: ProjectIndex, files: ProjectFile[]): ArchitectureSummary {
  const readme = files.find((f) => /^readme\.(md|txt)$/i.test(f.path));
  const purpose =
    readme?.content.split("\n").find((l) => l.trim().length > 12)?.replace(/^#+\s*/, "").trim() ??
    (index.entryPoints[0] ? `Project with entry point ${index.entryPoints[0]}.` : "Purpose not documented (no README heading found).");

  const technologies = new Set<string>();
  for (const file of index.files) {
    if (file.language === "html") technologies.add("HTML");
    if (file.language === "css") technologies.add("CSS");
    if (file.language === "typescript") technologies.add("TypeScript");
    if (file.language === "javascript") technologies.add("JavaScript");
    if (file.language === "python") technologies.add("Python");
    for (const spec of file.imports) {
      if (spec.startsWith("react")) technologies.add("React");
      if (spec.startsWith("three")) technologies.add("Three.js");
      if (spec.startsWith("pyodide")) technologies.add("Pyodide");
    }
  }

  const pkg = files.find((f) => f.path.endsWith("package.json"));
  const req = files.find((f) => f.path.endsWith("requirements.txt"));
  const dependencies: string[] = [];
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as { dependencies?: Record<string, string> };
      dependencies.push(...Object.keys(parsed.dependencies ?? {}));
    } catch {
      dependencies.push("(package.json is not valid JSON)");
    }
  }
  if (req) {
    dependencies.push(
      ...req.content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
  }

  const warnings: string[] = [];
  if (!readme) warnings.push("No README file — AI memory purpose is inferred from entry points.");
  if (index.files.length > 200) warnings.push("Large project: context is trimmed to the most relevant files per request.");
  if (dependencies.length > 40) warnings.push("Many dependencies detected.");

  return {
    purpose,
    entryPoints: index.entryPoints,
    modules: index.modules.map((m) => ({
      name: m.name,
      files: m.files.length,
      lines: m.files.reduce((sum, p) => sum + (index.files.find((f) => f.path === p)?.lines ?? 0), 0),
    })),
    technologies: [...technologies],
    dependencies,
    testFiles: index.testFiles,
    configFiles: index.configFiles,
    largestFiles: [...index.files].sort((a, b) => b.lines - a.lines).slice(0, 5).map((f) => ({ path: f.path, lines: f.lines })),
    warnings,
  };
}
