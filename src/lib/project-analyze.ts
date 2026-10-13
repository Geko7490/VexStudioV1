export type ProjectKind = "web" | "python" | "node" | "cpp" | "unknown";

export type RuntimeSupport = "supported" | "partial" | "unsupported";

export type ProjectFile = { path: string; content: string };

export type StaticCheck = {
  id: string;
  title: string;
  status: "pass" | "fail" | "warn" | "skipped";
  detail: string;
};

export type ProjectManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: ProjectKind;
  entryFile: string | null;
  runtimes: string[];
  runtimeSupport: Record<string, RuntimeSupport>;
  dependencies: string[];
  files: { path: string; bytes: number; language: string }[];
  totalBytes: number;
  fileCount: number;
  testStatus: "not_run" | "pass" | "fail";
  generatedAt: string;
};

const LANGUAGE_BY_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  py: "python",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  txt: "text",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  svg: "svg",
};

export function languageOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXT[ext] ?? "text";
}

const NATIVE_PY_HINTS = ["numpy", "pandas", "scipy", "matplotlib", "cryptography", "lxml", "pillow"];

export function detectProject(files: ProjectFile[]): {
  kind: ProjectKind;
  entryFile: string | null;
  runtimes: string[];
  runtimeSupport: Record<string, RuntimeSupport>;
  dependencies: string[];
  framework: string | null;
} {
  const paths = files.map((f) => f.path);
  const byName = (name: string) => files.find((f) => f.path === name || f.path.endsWith(`/${name}`));
  const pkg = byName("package.json");
  const requirements = byName("requirements.txt");
  const indexHtml = paths.find((p) => p.toLowerCase() === "index.html") ?? paths.find((p) => p.toLowerCase().endsWith("index.html"));
  const pythonFiles = paths.filter((p) => p.endsWith(".py"));
  const cppFiles = paths.filter((p) => /\.(c|cpp|cc|h|hpp)$/i.test(p));

  let pkgMeta: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    main?: string;
  } = {};
  if (pkg) {
    try {
      pkgMeta = JSON.parse(pkg.content) as typeof pkgMeta;
    } catch {
      pkgMeta = {};
    }
  }

  const deps = [
    ...Object.keys(pkgMeta.dependencies ?? {}),
    ...Object.keys(pkgMeta.devDependencies ?? {}),
  ];

  const requirementsList = (requirements?.content ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(/[<>=~\[;]/)[0].trim().toLowerCase());

  if (indexHtml) {
    return {
      kind: "web",
      entryFile: indexHtml,
      runtimes: ["browser-html-css-js"],
      runtimeSupport: { "browser-html-css-js": "supported" },
      dependencies: deps,
      framework: pkgMeta.dependencies?.react ? "react" : null,
    };
  }

  if (pythonFiles.length > 0 || requirementsList.length > 0) {
    const native = requirementsList.filter((d) => NATIVE_PY_HINTS.includes(d));
    const support: Record<string, RuntimeSupport> = {
      pyodide: native.length > 0 ? "partial" : "supported",
    };
    return {
      kind: "python",
      entryFile: paths.find((p) => /(^|\/)(main|app|run)\.py$/.test(p)) ?? pythonFiles[0] ?? null,
      runtimes: ["pyodide"],
      runtimeSupport: support,
      dependencies: requirementsList,
      framework: null,
    };
  }

  if (pkg) {
    const isBuildTool = ["next", "vite", "webpack", "esbuild", "parcel"].some((t) => t in (pkgMeta.dependencies ?? {}) || t in (pkgMeta.devDependencies ?? {}));
    return {
      kind: "node",
      entryFile: pkgMeta.scripts?.start ? (pkgMeta.main ?? null) : (pkgMeta.main ?? null),
      runtimes: ["node-webcontainer"],
      runtimeSupport: { "node-webcontainer": "unsupported" },
      dependencies: deps,
      framework: isBuildTool ? "node-build-toolchain" : "node",
    };
  }

  if (cppFiles.length > 0) {
    return {
      kind: "cpp",
      entryFile: cppFiles.find((p) => /main\.(c|cpp)$/i.test(p)) ?? cppFiles[0] ?? null,
      runtimes: ["wasm-clang"],
      runtimeSupport: { "wasm-clang": "unsupported" },
      dependencies: [],
      framework: null,
    };
  }

  return {
    kind: "unknown",
    entryFile: paths[0] ?? null,
    runtimes: [],
    runtimeSupport: {},
    dependencies: deps,
    framework: null,
  };
}

export function slugifyId(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "project";
}

export function buildManifest(input: {
  id: string;
  name: string;
  description: string;
  version: string;
  files: ProjectFile[];
}): ProjectManifest {
  const detected = detectProject(input.files);
  const fileRows = input.files
    .map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.content).length, language: languageOf(f.path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = fileRows.reduce((sum, f) => sum + f.bytes, 0);
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    version: input.version,
    kind: detected.kind,
    entryFile: detected.entryFile,
    runtimes: detected.runtimes,
    runtimeSupport: detected.runtimeSupport,
    dependencies: detected.dependencies,
    files: fileRows,
    totalBytes,
    fileCount: fileRows.length,
    testStatus: "not_run",
    generatedAt: new Date().toISOString(),
  };
}

const SECRET_PATTERNS: { id: string; re: RegExp }[] = [
  { id: "aws-key", re: /AKIA[0-9A-Z]{16}/ },
  { id: "openai-key", re: /sk-[A-Za-z0-9]{20,}/ },
  { id: "github-token", re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
];

/** Deterministic static checks that really run on the uploaded file tree. */
export function runStaticChecks(files: ProjectFile[]): { checks: StaticCheck[]; summary: "pass" | "warn" | "fail" } {
  const checks: StaticCheck[] = [];
  const paths = new Set(files.map((f) => f.path));

  const push = (id: string, title: string, status: StaticCheck["status"], detail: string) =>
    checks.push({ id, title, status, detail });

  const indexHtml = files.find((f) => f.path.toLowerCase().endsWith("index.html"));
  if (indexHtml) {
    const ok = /<!doctype html>/i.test(indexHtml.content) && /<html[\s>]/i.test(indexHtml.content);
    push("html-document", "index.html is a complete HTML document", ok ? "pass" : "warn", ok ? "Doctype and <html> found." : "Missing doctype or <html> element.");
    const title = /<title>[^<]{1,200}<\/title>/i.test(indexHtml.content);
    push("html-title", "Document has a title", title ? "pass" : "warn", title ? "Found." : "No <title> element; preview tab stays unnamed.");

    const refs = [...indexHtml.content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
    const unresolved: string[] = [];
    for (const ref of refs) {
      if (/^(https?:)?\/\//i.test(ref) || ref.startsWith("#") || ref.startsWith("data:")) continue;
      const clean = ref.split("?")[0].split("#")[0].replace(/^\.\//, "");
      const candidates = [clean, ...[...clean.matchAll(/\.\.\//g)].map((_, i) => clean.split("../").slice(i + 1).join("/"))];
      const resolved = candidates.some((c) => paths.has(c) || paths.has(clean.replace(/^\//, "")));
      if (!resolved) unresolved.push(ref);
    }
    push(
      "html-assets",
      "Local asset references resolve inside the project",
      unresolved.length === 0 ? "pass" : "fail",
      unresolved.length === 0 ? `${refs.length} reference(s) checked.` : `Unresolved: ${unresolved.slice(0, 5).join(", ")}`,
    );
  } else {
    push("html-document", "index.html present", "skipped", "No index.html in archive.");
  }

  const pyEntry = files.find((f) => f.path.endsWith(".py"));
  if (pyEntry) {
    const hasMain = /if\s+__name__\s*==\s*['"]__main__['"]/.test(pyEntry.content);
    push("python-entry", "Python entry point guard", hasMain ? "pass" : "warn", hasMain ? `${pyEntry.path} guards module execution.` : `No __main__ guard in ${pyEntry.path}; module-level code runs on import.`);
  } else {
    push("python-entry", "Python entry point guard", "skipped", "No Python files.");
  }

  const secretHits: string[] = [];
  for (const file of files) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(file.content)) secretHits.push(`${file.path}:${pattern.id}`);
    }
  }
  push(
    "secrets",
    "No hardcoded credentials in source",
    secretHits.length === 0 ? "pass" : "fail",
    secretHits.length === 0 ? "Scanned every text file." : `Found: ${secretHits.slice(0, 5).join(", ")}`,
  );

  const junk = files.filter((f) => /(^|\/)(node_modules|\.git|dist|build|__pycache__)\//.test(f.path));
  push(
    "no-build-output",
    "No dependency or build output folders",
    junk.length === 0 ? "pass" : "warn",
    junk.length === 0 ? "Clean." : `Contains: ${junk.slice(0, 4).map((f) => f.path).join(", ")}`,
  );

  const oversized = files.filter((f) => f.content.length > 400_000);
  push("file-size", "No oversized source files", oversized.length === 0 ? "pass" : "warn", oversized.length === 0 ? "All files under 400 KB." : `${oversized.length} file(s) above 400 KB.`);

  const failed = checks.some((c) => c.status === "fail");
  const warned = checks.some((c) => c.status === "warn");
  return { checks, summary: failed ? "fail" : warned ? "warn" : "pass" };
}
