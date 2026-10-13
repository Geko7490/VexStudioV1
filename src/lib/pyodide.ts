/** Real Pyodide (CPython on WASM) loader. Loaded on demand from the official CDN. */

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export type PyodideProgress = { stage: string; detail: string; fraction: number };

interface PyodidePackage {
  name: string;
}

interface PyodideInterface {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(names: string | string[]): Promise<void>;
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
  loadedPackages: Record<string, PyodidePackage>;
  globals: { set: (key: string, value: unknown) => void };
}

type LoadPyodideFn = (options: { indexURL: string; stdout?: (s: string) => void; stderr?: (s: string) => void }) => Promise<PyodideInterface>;

declare global {
  interface Window {
    loadPyodide?: LoadPyodideFn;
  }
}

let instance: PyodideInterface | null = null;
let loading: Promise<PyodideInterface> | null = null;

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-pyodide="1"]`);
    if (existing) {
      if (window.loadPyodide) resolve();
      else existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Pyodide runtime script failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pyodide = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Unable to download the Pyodide runtime from ${src}`));
    document.head.appendChild(script);
  });
}

export function pyodideLoaded(): boolean {
  return instance !== null;
}

export async function getPyodide(onProgress?: (p: PyodideProgress) => void, signal?: AbortSignal): Promise<PyodideInterface> {
  if (instance) return instance;
  if (loading) return loading;

  loading = (async () => {
    onProgress?.({ stage: "runtime", detail: `Downloading Pyodide ${PYODIDE_VERSION} runtime…`, fraction: 0.1 });
    await injectScript(`${PYODIDE_BASE}pyodide.js`);
    if (signal?.aborted) throw new Error("Pyodide load cancelled.");
    if (!window.loadPyodide) throw new Error("Pyodide loader (window.loadPyodide) was not registered by the runtime script.");

    onProgress?.({ stage: "interpreter", detail: "Starting CPython interpreter (WASM)…", fraction: 0.5 });
    const py = await window.loadPyodide({ indexURL: PYODIDE_BASE });
    onProgress?.({ stage: "ready", detail: "Python runtime ready.", fraction: 1 });
    instance = py;
    return py;
  })();

  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

export async function restartPyodide(): Promise<void> {
  instance = null;
  loading = null;
}

export type PythonRunResult = {
  stdout: string;
  result: string | null;
  error: string | null;
  durationMs: number;
  loadedPackages: string[];
};

export async function runPython(
  code: string,
  options: { onProgress?: (p: PyodideProgress) => void; signal?: AbortSignal } = {},
): Promise<PythonRunResult> {
  const py = await getPyodide(options.onProgress, options.signal);
  const out: string[] = [];
  const err: string[] = [];
  py.setStdout({ batched: (text) => out.push(text) });
  py.setStderr({ batched: (text) => err.push(text) });

  const startedAt = performance.now();
  try {
    const result = await py.runPythonAsync(code);
    const durationMs = Math.round(performance.now() - startedAt);
    return {
      stdout: out.join("\n") + (err.length ? `\n[stderr]\n${err.join("\n")}` : ""),
      result: typeof result === "undefined" ? null : String(result),
      error: null,
      durationMs,
      loadedPackages: Object.keys(py.loadedPackages ?? {}),
    };
  } catch (error) {
    return {
      stdout: out.join("\n") + (err.length ? `\n[stderr]\n${err.join("\n")}` : ""),
      result: null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      durationMs: Math.round(performance.now() - startedAt),
      loadedPackages: Object.keys(py.loadedPackages ?? {}),
    };
  }
}

/**
 * Installs requirements through micropip and reports the *real* outcome.
 * Packages that need native binaries which Pyodide does not ship will fail here —
 * that failure is surfaced verbatim instead of being hidden.
 */
export async function installRequirements(
  requirements: string[],
  onLog: (line: string) => void,
): Promise<{ installed: string[]; failed: { name: string; error: string }[] }> {
  const py = await getPyodide();
  const installed: string[] = [];
  const failed: { name: string; error: string }[] = [];
  py.setStdout({ batched: (t) => onLog(t) });
  py.setStderr({ batched: (t) => onLog(t) });

  for (const raw of requirements) {
    const name = raw.trim();
    if (!name || name.startsWith("#")) continue;
    if (name in (py.loadedPackages ?? {})) {
      installed.push(name);
      continue;
    }
    try {
      await py.loadPackage("micropip");
      await py.runPythonAsync(
        `import micropip\nawait micropip.install(${JSON.stringify(name)})`,
      );
      installed.push(name);
      onLog(`installed ${name}`);
    } catch (error) {
      failed.push({ name, error: error instanceof Error ? error.message.split("\n").slice(-3).join("\n") : String(error) });
    }
  }
  return { installed, failed };
}
