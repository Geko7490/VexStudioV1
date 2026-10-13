"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MODEL_CATALOG,
  PROFILE_SETTINGS,
  detectDevice,
  evaluateCompatibility,
  formatBytes,
  type DeviceCapability,
  type ModelCatalogEntry,
  type PerformanceProfile,
} from "@/lib/ai/models";
import { loadModel, loadRuntimeModelInfo, runSmokeTest, unloadModel, type InitProgressReport } from "@/lib/ai/webllm";

type RuntimeInfo = Map<string, { vramRequiredMb: number | null; lowResource: boolean; modelLib: string | null }>;

type CacheEntryInfo = { key: string; size: number };

export default function AICenterPage() {
  const [device, setDevice] = useState<DeviceCapability | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, InitProgressReport>>({});
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [smoke, setSmoke] = useState<{ answer: string; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<PerformanceProfile>("balanced");
  const [cacheEntries, setCacheEntries] = useState<CacheEntryInfo[]>([]);
  const abortRef = useRef(false);

  const refreshCache = useCallback(async () => {
    if (typeof caches === "undefined") {
      setCacheEntries([]);
      return;
    }
    try {
      const names = await caches.keys();
      const out: CacheEntryInfo[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (!/mlc-ai|hf\.co|huggingface/i.test(request.url)) continue;
          const match = await cache.match(request);
          const buffer = await match?.arrayBuffer();
          out.push({ key: request.url, size: buffer?.byteLength ?? 0 });
        }
      }
      setCacheEntries(out.sort((a, b) => b.size - a.size).slice(0, 20));
    } catch {
      setCacheEntries([]);
    }
  }, []);

  useEffect(() => {
    void detectDevice().then(setDevice);
    void refreshCache();
    loadRuntimeModelInfo()
      .then(setRuntimeInfo)
      .catch((err: unknown) => setRuntimeError(err instanceof Error ? err.message : "Runtime catalogue unavailable"));
  }, [refreshCache]);

  const load = useCallback(async (entry: ModelCatalogEntry) => {
    setError(null);
    setNotice(null);
    setSmoke(null);
    setBusy(entry.id);
    abortRef.current = false;
    try {
      const result = await loadModel(entry.webllmModelId, {
        onProgress: (report) => setProgress((prev) => ({ ...prev, [entry.id]: report })),
        shouldAbort: () => abortRef.current,
      });
      setLoadedId(result.modelId);
      setLoadMs(result.loadMs);
      setNotice(`${entry.label} is loaded and ready (load took ${(result.loadMs / 1000).toFixed(1)} s). Weights are cached by the browser for next time.`);
      await refreshCache();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Model load failed");
      setLoadedId(null);
    } finally {
      setBusy(null);
    }
  }, [refreshCache]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-semibold">AI Center — local models</h1>
      <p className="muted mt-1 text-sm">
        Every model here runs inside this browser tab through WebLLM/WebGPU. Nothing is sent to a server, and there is no hidden cloud fallback: if no model is
        loaded, AI features are simply unavailable.
      </p>

      <div className="card mt-3 p-3 text-xs">
        <h2 className="text-sm font-semibold">This device</h2>
        {!device ? (
          <p className="muted">Detecting hardware…</p>
        ) : (
          <ul className="muted mt-1 space-y-0.5">
            <li>
              WebGPU: <strong style={{ color: device.webgpu ? "var(--ok)" : "var(--danger)" }}>{device.webgpu ? "available" : "unavailable"}</strong>
              {device.adapterInfo ? ` (${device.adapterInfo})` : ""}
            </li>
            <li>Max buffer size: {device.maxBufferMb ? `${device.maxBufferMb} MB` : "not reported"}</li>
            <li>Device memory: {device.deviceMemoryGb ? `~${device.deviceMemoryGb} GB` : "not reported by the browser"}</li>
            <li>
              Platform: {device.platform} · {device.mobile ? "mobile" : "desktop"} · {device.hardwareConcurrency ?? "?"} logical cores
            </li>
          </ul>
        )}
        {runtimeError ? <p className="badge badge-warn mt-2 block whitespace-normal text-left">Runtime catalogue: {runtimeError}</p> : null}
        {runtimeInfo ? <p className="muted mt-1">Runtime verified against @mlc-ai/web-llm prebuilt list ({runtimeInfo.size} entries).</p> : null}
      </div>

      {error ? <p className="badge badge-danger mt-3 block whitespace-normal text-left">{error}</p> : null}
      {notice ? <p className="badge badge-ok mt-3 block whitespace-normal text-left">{notice}</p> : null}

      <div className="card mt-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Active model</h2>
          <span className="badge badge-accent">{loadedId ?? "none loaded"}</span>
          {loadMs ? <span className="badge">load {(loadMs / 1000).toFixed(1)} s</span> : null}
          <label className="label mb-0 ml-auto" htmlFor="profile">
            Inference profile
          </label>
          <select id="profile" className="select w-auto" value={profile} onChange={(event) => setProfile(event.target.value as PerformanceProfile)}>
            {Object.entries(PROFILE_SETTINGS).map(([key, value]) => (
              <option key={key} value={key}>
                {value.label}
              </option>
            ))}
          </select>
        </div>
        <p className="muted mt-1 text-xs">{PROFILE_SETTINGS[profile].note}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!loadedId || busy !== null}
            onClick={async () => {
              setBusy("smoke");
              try {
                const result = await runSmokeTest();
                setSmoke({ answer: result.answer, ms: result.ms });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Smoke test failed");
              } finally {
                setBusy(null);
              }
            }}
          >
            Run real inference test
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!loadedId}
            onClick={async () => {
              await unloadModel();
              setLoadedId(null);
              setSmoke(null);
              setNotice("Model unloaded from memory. Cached weights remain for the next load.");
            }}
          >
            Unload model
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void refreshCache()}>
            Refresh cache list
          </button>
        </div>
        {smoke ? (
          <p className="mono mt-2 text-xs" style={{ color: smoke.answer.includes("VEX_LOCAL_AI_OK") ? "var(--ok)" : "var(--warn)" }}>
            prompt → “Reply with exactly: VEX_LOCAL_AI_OK” · answer → “{smoke.answer || "(empty)"}” · {smoke.ms} ms
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {MODEL_CATALOG.map((entry) => {
          const compat = device ? evaluateCompatibility(entry, device) : null;
          const runtime = runtimeInfo?.get(entry.webllmModelId);
          const report = progress[entry.id];
          const isLoaded = loadedId === entry.webllmModelId;
          return (
            <article key={entry.id} className="card p-4 text-xs">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{entry.label}</h3>
                <span className={`badge ${isLoaded ? "badge-ok" : compat?.status === "supported" ? "badge-accent" : compat?.status === "partial" ? "badge-warn" : "badge-danger"}`}>
                  {isLoaded ? "loaded" : runtime ? (compat?.status === "supported" ? "supported" : compat?.status === "partial" ? "partly compatible" : "incompatible") : "runtime not verified"}
                </span>
              </div>
              <p className="muted mt-1">
                {entry.provider} · {entry.parameters} · {entry.quantization} · context {entry.contextWindow.toLocaleString()} tokens · {entry.codingAbility} coding · licence {entry.license}
              </p>
              <ul className="muted mt-2 space-y-0.5">
                <li>Download ≈ {formatBytes(entry.downloadBytes)} (estimate)</li>
                <li>RAM ≈ {entry.ramMb} MB · VRAM ≈ {runtime?.vramRequiredMb ? `${runtime.vramRequiredMb} MB (upstream figure)` : `${entry.vramMbEstimate} MB (estimate)`}</li>
                <li>Disk ≈ {entry.diskMbEstimate} MB · languages: {entry.languages.join(", ")}</li>
                <li className="mono break-all">id: {entry.webllmModelId}</li>
              </ul>
              {compat && compat.reasons.length > 0 ? (
                <ul className="mt-2 space-y-0.5" style={{ color: "var(--warn)" }}>
                  {compat.reasons.map((reason) => (
                    <li key={reason}>⚠ {reason}</li>
                  ))}
                </ul>
              ) : null}
              {!runtime ? <p className="muted mt-2">Not present in the runtime’s prebuilt list — download is disabled until the runtime verifies the id.</p> : null}
              {report ? (
                <div className="mt-2">
                  <div className="bar" role="progressbar" aria-valuenow={Math.round(report.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${Math.round(report.progress * 100)}%` }} />
                  </div>
                  <p className="muted mt-1">{report.text}</p>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!runtime || !device?.webgpu || busy !== null || isLoaded}
                  onClick={() => void load(entry)}
                >
                  {busy === entry.id ? "Downloading & loading…" : isLoaded ? "Loaded" : "Download & load"}
                </button>
                {busy === entry.id ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      abortRef.current = true;
                      void unloadModel().then(() => setBusy(null));
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
                <a className="btn btn-sm" href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                  Model card
                </a>
              </div>
              <p className="muted mt-2">{entry.notes}</p>
            </article>
          );
        })}
      </div>

      <div className="card mt-3 p-3 text-xs">
        <h2 className="text-sm font-semibold">Cached model files ({cacheEntries.length})</h2>
        {cacheEntries.length === 0 ? (
          <p className="muted mt-1">No model weights cached in this browser yet.</p>
        ) : (
          <>
            <ul className="muted mt-1 space-y-0.5">
              {cacheEntries.map((entry) => (
                <li key={entry.key} className="mono break-all">
                  {formatBytes(entry.size)} — {entry.key.slice(0, 110)}
                </li>
              ))}
            </ul>
            <p className="muted mt-2">Total ≈ {formatBytes(cacheEntries.reduce((sum, entry) => sum + entry.size, 0))}. Deleting these files frees space; the model downloads again on next load.</p>
          </>
        )}
      </div>

      <div className="card mt-3 p-3 text-xs">
        <h2 className="text-sm font-semibold">Cloud models (explicitly separate)</h2>
        <p className="muted mt-1">
          Vex Studio never silently switches to a cloud model. A cloud endpoint would have to be configured by the operator (AI_PROXY_URL / AI_PROXY_KEY); without
          it, the cloud route answers HTTP 503 and local models keep working.
        </p>
      </div>
    </div>
  );
}
