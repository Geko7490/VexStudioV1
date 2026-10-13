"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildPreviewDocument, previewIframeProps, type ConsoleEntry } from "@/lib/preview";
import { installRequirements, pyodideLoaded, restartPyodide, runPython } from "@/lib/pyodide";

const FRAME_PRESETS = [
  { id: "desktop", label: "Desktop", width: "100%", height: "100%" },
  { id: "tablet", label: "Tablet 768", width: "768px", height: "100%" },
  { id: "phone", label: "Phone 390", width: "390px", height: "100%" },
  { id: "square", label: "Square 1:1", width: "100%", aspectRatio: "1 / 1" },
];

export function RunPanel({
  kind,
  entryFile,
  files,
  pythonEntry,
  requirements,
  consoleEntries,
  onConsole,
  onRuntimeStatus,
}: {
  kind: string;
  entryFile: string | null;
  files: { path: string; content: string }[];
  pythonEntry: string | null;
  requirements: string[];
  consoleEntries: ConsoleEntry[];
  onConsole: (entry: ConsoleEntry) => void;
  onRuntimeStatus?: (status: string) => void;
}) {
  const [doc, setDoc] = useState<string | null>(null);
  const [frame, setFrame] = useState("desktop");
  const [pyOutput, setPyOutput] = useState<string[]>([]);
  const [pyStatus, setPyStatus] = useState<string>("idle");
  const [pyProgress, setPyProgress] = useState(0);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isWeb = kind === "web" || Boolean(entryFile);
  const isPython = kind === "python";

  const stamp = useCallback((level: ConsoleEntry["level"], text: string) => {
    onConsole({ level, text, at: new Date().toISOString() });
  }, [onConsole]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { __vexPreview?: boolean; level?: string; text?: string };
      if (!data || data.__vexPreview !== true) return;
      const level = (["log", "warn", "error", "info"] as const).includes(data.level as ConsoleEntry["level"])
        ? (data.level as ConsoleEntry["level"])
        : "log";
      onConsole({ level, text: String(data.text ?? ""), at: new Date().toISOString() });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onConsole]);

  const runWeb = useCallback(() => {
    if (!entryFile) {
      stamp("error", "No HTML entry file to preview.");
      return;
    }
    const html = buildPreviewDocument(entryFile, files);
    setDoc(html);
    stamp("info", `Preview rebuilt from ${entryFile} (${files.length} files inlined, sandboxed iframe).`);
  }, [entryFile, files, stamp]);

  const stopWeb = useCallback(() => {
    setDoc(null);
    stamp("info", "Preview stopped (iframe unmounted).");
  }, [stamp]);

  const runPythonEntry = useCallback(async () => {
    if (!pythonEntry) {
      stamp("error", "No Python entry file found.");
      return;
    }
    const file = files.find((f) => f.path === pythonEntry);
    if (!file) {
      stamp("error", `Entry file ${pythonEntry} is missing from the mod.`);
      return;
    }
    setBusy(true);
    setPyOutput([]);
    setPyStatus("starting Pyodide");
    setPyProgress(0.05);
    onRuntimeStatus?.("starting");
    try {
      const result = await runPython(file.content, {
        onProgress: (p) => {
          setPyStatus(`${p.stage}: ${p.detail}`);
          setPyProgress(p.fraction);
        },
      });
      setPyProgress(1);
      setPyStatus(result.error ? "failed" : "finished");
      if (result.stdout) setPyOutput((prev) => [...prev, result.stdout]);
      if (result.result) setPyOutput((prev) => [...prev, `=> ${result.result}`]);
      if (result.error) {
        setPyOutput((prev) => [...prev, `ERROR\n${result.error}`]);
        stamp("error", result.error.split("\n").slice(-1)[0]);
        onRuntimeStatus?.("failed");
      } else {
        stamp("info", `Python run finished in ${result.durationMs} ms. Loaded packages: ${result.loadedPackages.join(", ") || "none"}.`);
        onRuntimeStatus?.("finished");
      }
    } catch (error) {
      setPyStatus("failed");
      const message = error instanceof Error ? error.message : "Python runtime failed";
      setPyOutput((prev) => [...prev, `RUNTIME ERROR\n${message}`]);
      stamp("error", message);
      onRuntimeStatus?.("failed");
    } finally {
      setBusy(false);
    }
  }, [files, pythonEntry, stamp, onRuntimeStatus]);

  const install = useCallback(async () => {
    if (requirements.length === 0) {
      stamp("info", "requirements.txt has no installable entries.");
      return;
    }
    setBusy(true);
    setInstallLog([]);
    try {
      const result = await installRequirements(requirements, (line) => setInstallLog((prev) => [...prev.slice(-40), line]));
      setInstallLog((prev) => [...prev, `installed: ${result.installed.join(", ") || "none"}`]);
      if (result.failed.length > 0) {
        setInstallLog((prev) => [...prev, `FAILED: ${result.failed.map((f) => `${f.name} → ${f.error}`).join(" | ")}`]);
        stamp("error", `${result.failed.length} requirement(s) could not be installed in Pyodide.`);
      } else {
        stamp("info", `Installed: ${result.installed.join(", ")}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "install failed";
      setInstallLog((prev) => [...prev, `ERROR ${message}`]);
      stamp("error", message);
    } finally {
      setBusy(false);
    }
  }, [requirements, stamp]);

  const preset = useMemo(() => FRAME_PRESETS.find((f) => f.id === frame) ?? FRAME_PRESETS[0], [frame]);

  if (isPython) {
    return (
      <div className="flex h-full flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={runPythonEntry}>
            {pyStatus === "idle" ? "Run Python" : "Run again"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => {
              await restartPyodide();
              setPyStatus("idle");
              setPyProgress(0);
              setPyOutput([]);
              stamp("info", "Python interpreter reset. The next run downloads a fresh Pyodide instance.");
            }}
          >
            Reset runtime
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={install}>
            Install requirements (micropip)
          </button>
          <span className="badge">{pyStatus === "idle" ? (pyodideLoaded() ? "runtime cached" : "runtime not loaded") : pyStatus}</span>
        </div>

        {busy || pyProgress > 0 ? (
          <div className="bar" role="status" aria-label="Python runtime progress">
            <span style={{ width: `${Math.round(pyProgress * 100)}%` }} />
          </div>
        ) : null}
        <p className="muted text-xs">
          Pyodide {pyStatus === "idle" ? "downloads on first run" : "active"}. Packages must ship with the Pyodide distribution or install as pure-Python wheels;
          anything needing native binaries fails and the real error is shown below.
        </p>

        <div className="card-soft scroll-y min-h-[120px] flex-1">
          <pre className="console">{pyOutput.join("\n") || "Console output appears here."}</pre>
        </div>
        {installLog.length > 0 ? (
          <div className="card-soft scroll-y max-h-32">
            <pre className="console">{installLog.join("\n")}</pre>
          </div>
        ) : null}
        <div className="scroll-y max-h-40 card-soft">
          {consoleEntries.length === 0 ? (
            <p className="muted p-2 text-xs">No console events yet.</p>
          ) : (
            consoleEntries
              .slice(-50)
              .map((entry, index) => (
                <p key={index} className="mono px-2 py-0.5 text-[12px]" style={{ color: entry.level === "error" ? "var(--danger)" : entry.level === "warn" ? "var(--warn)" : "var(--muted)" }}>
                  [{entry.level}] {entry.text}
                </p>
              ))
          )}
        </div>
      </div>
    );
  }

  if (!isWeb) {
    return (
      <div className="p-3">
        <p className="badge badge-danger">Runtime not supported in the browser</p>
        <p className="muted mt-2 text-sm">
          This project kind (<span className="mono">{kind || "unknown"}</span>) has no browser runtime wired into Vex Studio. Node.js/npm projects need a
          WebContainers-style runtime that this deployment does not ship, and C/C++ would need a WASM toolchain. The files still open and edit normally, and you can
          export the mod as a ZIP.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn btn-sm btn-primary" onClick={runWeb}>
          Run
        </button>
        <button type="button" className="btn btn-sm" onClick={stopWeb} disabled={!doc}>
          Stop
        </button>
        <button type="button" className="btn btn-sm" onClick={runWeb} disabled={!doc}>
          Refresh
        </button>
        <label className="muted ml-1 text-xs" htmlFor="frame-preset">
          Viewport
        </label>
        <select id="frame-preset" className="select w-auto" value={frame} onChange={(event) => setFrame(event.target.value)}>
          {FRAME_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid min-h-[220px] flex-1 place-items-center overflow-auto rounded-lg border p-2" style={{ borderColor: "var(--border)", background: "var(--bg-soft)" }}>
        {doc ? (
          <iframe
            title="Project preview"
            className="rounded-md border bg-white"
            style={{ width: preset.width, height: preset.height, aspectRatio: preset.aspectRatio, borderColor: "var(--border)" }}
            srcDoc={doc}
            {...previewIframeProps()}
          />
        ) : (
          <p className="muted text-sm">Press Run to build a sandboxed preview of {entryFile ?? "index.html"}.</p>
        )}
      </div>

      <div className="scroll-y h-40 card-soft">
        <p className="muted px-2 pt-2 text-xs">Console ({consoleEntries.length}) — captured from the sandboxed iframe.</p>
        {consoleEntries.length === 0 ? (
          <p className="muted p-2 text-xs">No console output yet.</p>
        ) : (
          consoleEntries
            .slice(-100)
            .map((entry, index) => (
              <p key={index} className="mono px-2 py-0.5 text-[12px]" style={{ color: entry.level === "error" ? "var(--danger)" : entry.level === "warn" ? "var(--warn)" : "var(--muted)" }}>
                [{entry.level}] {entry.text}
              </p>
            ))
        )}
      </div>
    </div>
  );
}
