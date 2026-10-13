/** Monaco loader with a graceful fallback: if the CDN is unreachable we say so and
 *  the editor falls back to an accessible textarea with line numbers. */

const MONACO_VERSION = "0.52.2";
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

type MonacoRequire = {
  config: (options: { paths: Record<string, string> }) => void;
  (modules: string[], onLoad: () => void, onError?: (err: unknown) => void): void;
};

declare global {
  interface Window {
    monaco?: unknown;
  }
}

function amdLoader(): MonacoRequire | undefined {
  return (window as unknown as { require?: MonacoRequire }).require;
}

type Status = { state: "idle" | "loading" | "ready" | "failed"; message?: string };

let status: Status = { state: "idle" };
const listeners = new Set<(s: Status) => void>();

export function monacoStatus(): Status {
  return status;
}

export function onMonacoStatus(fn: (s: Status) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(next: Status) {
  status = next;
  for (const fn of listeners) fn(next);
}

function injectLoader(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (amdLoader()) return resolve();
    const script = document.createElement("script");
    script.src = `${MONACO_BASE}/loader.min.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Monaco loader could not be downloaded from ${MONACO_BASE}`));
    document.head.appendChild(script);
  });
}

export async function ensureMonaco(): Promise<unknown> {
  if (window.monaco) return window.monaco;
  if (status.state === "failed") throw new Error(status.message ?? "Monaco unavailable");
  setStatus({ state: "loading" });
  try {
    await injectLoader();
    const amd = amdLoader();
    if (!amd) throw new Error("Monaco AMD loader missing");
    amd.config({ paths: { vs: MONACO_BASE } });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Monaco load timed out after 15s")), 15_000);
      amd(["vs/editor/editor.main"], () => {
        clearTimeout(timeout);
        resolve();
      }, () => {
        clearTimeout(timeout);
        reject(new Error("Monaco modules failed to load"));
      });
    });
    if (!window.monaco) throw new Error("Monaco did not initialise");
    setStatus({ state: "ready" });
    return window.monaco;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monaco unavailable";
    setStatus({ state: "failed", message });
    throw new Error(message);
  }
}
