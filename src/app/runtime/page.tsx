"use client";

import { useCallback, useEffect, useState } from "react";
import { getPyodide, pyodideLoaded, restartPyodide, runPython } from "@/lib/pyodide";
import type { PyodideProgress } from "@/lib/pyodide";

const RUNTIMES = [
  {
    id: "browser-html-css-js",
    label: "HTML / CSS / JavaScript",
    status: "supported" as const,
    detail: "Files are inlined into a sandboxed iframe (sandbox=\"allow-scripts\") with a console bridge. The preview has no access to studio cookies or admin APIs.",
  },
  {
    id: "pyodide",
    label: "Python (Pyodide)",
    status: "partial" as const,
    detail: "CPython compiled to WASM, downloaded on demand from the official CDN. Standard-library code works; native-binary packages fail with the real pip/micropip error.",
  },
  {
    id: "node-webcontainer",
    label: "Node.js / npm projects",
    status: "unsupported" as const,
    detail: "No WebContainers (or equivalent) runtime is bundled in this deployment, so npm scripts and Node APIs are not executed. Such projects are labelled unsupported instead of being approximated by a browser shim.",
  },
  {
    id: "wasm-clang",
    label: "C / C++ (WASM toolchain)",
    status: "unsupported" as const,
    detail: "A browser clang-to-WASM toolchain is not integrated. Source files can be viewed and exported, but they are not compiled here.",
  },
];

const SMOKE_SNIPPET = `import sys, platform, json
print("python", platform.python_version())
print("implementation", sys.implementation.name)
print(json.dumps({"ok": True, "runtime": "pyodide"}))`;

export default function RuntimePage() {
  const [progress, setProgress] = useState<PyodideProgress | null>(null);
  const [status, setStatus] = useState<string>(pyodideLoaded() ? "runtime cached" : "idle");
  const [output, setOutput] = useState<string>("");
  const [snippet, setSnippet] = useState<string>(SMOKE_SNIPPET);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(pyodideLoaded() ? "runtime cached" : "idle");
  }, []);

  const boot = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await getPyodide((report) => {
        setProgress(report);
        setStatus(report.stage);
      });
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pyodide failed to load");
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOutput("");
    try {
      const result = await runPython(snippet, {
        onProgress: (report) => {
          setProgress(report);
          setStatus(report.stage);
        },
      });
      setOutput([result.stdout, result.result ? `=> ${result.result}` : "", result.error ? `ERROR\n${result.error}` : ""].filter(Boolean).join("\n"));
      setStatus(result.error ? "run failed" : `ran in ${result.durationMs} ms`);
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      setStatus("failed");
    } finally {
      setBusy(false);
    }
  }, [snippet]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold">Runtime Center</h1>
      <p className="muted mt-1 text-sm">
        Real capability of each runtime in this browser. Anything not wired up is labelled unsupported — nothing is simulated.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {RUNTIMES.map((runtime) => (
          <article key={runtime.id} className="card p-4 text-xs">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold">{runtime.label}</h2>
              <span className={`badge ${runtime.status === "supported" ? "badge-ok" : runtime.status === "partial" ? "badge-warn" : "badge-danger"}`}>
                {runtime.status === "supported" ? "supported" : runtime.status === "partial" ? "partially supported" : "not supported"}
              </span>
            </div>
            <p className="muted mono mt-1">{runtime.id}</p>
            <p className="muted mt-2">{runtime.detail}</p>
          </article>
        ))}
      </div>

      <section className="card mt-4 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Python runtime</h2>
          <span className={`badge ${status === "ready" ? "badge-ok" : status === "idle" ? "" : status === "failed" ? "badge-danger" : "badge-warn"}`}>{status}</span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void boot()}>
              Load runtime
            </button>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run()}>
              Run snippet
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={async () => {
                await restartPyodide();
                setStatus("reset — runtime will download again on next run");
                setOutput("");
              }}
            >
              Reset runtime
            </button>
          </div>
        </div>

        {progress ? (
          <div className="mt-2">
            <div className="bar" role="status">
              <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </div>
            <p className="muted mt-1">{progress.detail}</p>
          </div>
        ) : null}

        <label className="label mt-3" htmlFor="python-snippet">
          Python snippet (runs in Pyodide, no server involved)
        </label>
        <textarea id="python-snippet" className="textarea" value={snippet} onChange={(event) => setSnippet(event.target.value)} rows={8} />

        {error ? <p className="badge badge-danger mt-2 block whitespace-normal text-left">{error}</p> : null}
        <div className="card-soft scroll-y mt-2 max-h-64">
          <pre className="console">{output || "Output appears here."}</pre>
        </div>
        <p className="muted mt-2">
          Stopping a running WASM cell is not possible from JavaScript, so there is no “Stop” for Python: use <strong>Reset runtime</strong> to drop the interpreter
          and reload a fresh one.
        </p>
      </section>

      <section className="card mt-4 p-3 text-xs">
        <h2 className="text-sm font-semibold">Sandbox isolation</h2>
        <ul className="muted mt-1 list-disc space-y-1 pl-5">
          <li>Previews run with <span className="mono">sandbox="allow-scripts"</span> and no <span className="mono">allow-same-origin</span>, so the document gets an opaque origin.</li>
          <li>The preview cannot read studio cookies, localStorage or call admin APIs with your session.</li>
          <li>Imported ZIPs are never executed automatically: you must press Run.</li>
          <li>Uploads are capped at 30 MB / 1200 entries with traversal, symlink and archive-bomb checks.</li>
        </ul>
      </section>
    </div>
  );
}
