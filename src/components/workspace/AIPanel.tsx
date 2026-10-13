"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unifiedDiff } from "@/lib/diff";
import { buildContextPackage, memoryFromAnalysis, parseProposals, type Proposal } from "@/lib/ai/assistant";
import { PROFILE_SETTINGS, type PerformanceProfile } from "@/lib/ai/models";
import { generateOnce, getActiveModel, subscribeModel } from "@/lib/ai/webllm";
import type { ProjectIndex } from "@/lib/indexer";
import {
  addChatTurn,
  clearChats,
  createSnapshot,
  getMemory,
  listChats,
  newId,
  putMemory,
  type ChatTurn,
  type ProjectMemory,
} from "@/lib/local-store";
import type { ProjectFile } from "@/lib/project-analyze";

function DiffView({ proposal }: { proposal: Proposal }) {
  const hunks = useMemo(() => unifiedDiff(proposal.before, proposal.after, 2), [proposal]);
  return (
    <div className="card-soft mt-1 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1" style={{ borderColor: "var(--border)" }}>
        <span className="mono text-xs">{proposal.path}</span>
        <span className="badge">{proposal.created ? "new file" : "modified"}</span>
      </div>
      <div className="scroll-y max-h-64">
        {hunks.length === 0 ? (
          <p className="muted p-2 text-xs">No textual difference detected for this file.</p>
        ) : (
          hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              <p className="mono px-2 py-0.5 text-[11px]" style={{ background: "var(--panel-2)", color: "var(--muted)" }}>
                {hunk.header}
              </p>
              {hunk.ops.map((op, opIndex) => (
                <p
                  key={opIndex}
                  className={`mono px-2 text-[12px] leading-5 ${op.type === "add" ? "diff-add" : op.type === "remove" ? "diff-del" : ""}`}
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {op.type === "add" ? "+ " : op.type === "remove" ? "- " : "  "}
                  {op.text}
                </p>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function AIPanel({
  modId,
  files,
  index,
  activePath,
  onApplyChanges,
  onIndexRefresh,
}: {
  modId: string;
  files: ProjectFile[];
  index: ProjectIndex;
  activePath: string | null;
  onApplyChanges: (changes: { path: string; content: string }[]) => Promise<void>;
  onIndexRefresh: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"ask" | "build">("ask");
  const [profile, setProfile] = useState<PerformanceProfile>("balanced");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Proposal[]>([]);
  const [memory, setMemory] = useState<ProjectMemory | null>(null);
  const [modelVersion, setModelVersion] = useState(0);
  const [context, setContext] = useState<ReturnType<typeof buildContextPackage> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeModel = getActiveModel();

  useEffect(() => subscribeModel(() => setModelVersion((v) => v + 1)), []);
  useEffect(() => {
    void listChats(modId).then(setTurns);
    void getMemory(modId).then(setMemory);
  }, [modId]);

  const push = useCallback(
    async (turn: Omit<ChatTurn, "id" | "createdAt" | "modId">) => {
      const full: ChatTurn = { ...turn, id: newId("turn"), modId, createdAt: new Date().toISOString() };
      await addChatTurn(full);
      setTurns((prev) => [...prev, full]);
    },
    [modId],
  );

  const analyseContext = useCallback(
    (query: string) => {
      const pkg = buildContextPackage({ files, index, query, openPath: activePath, memory });
      setContext(pkg);
      return pkg;
    },
    [files, index, activePath, memory],
  );

  const rebuildMemory = useCallback(async () => {
    const next = memoryFromAnalysis(index, files);
    const existing = await getMemory(modId);
    const merged: ProjectMemory = {
      ...next,
      modId,
      changes: existing?.changes ?? [],
      preferences: existing?.preferences ?? [],
      decisions: existing?.decisions ?? [],
      testResults: existing?.testResults ?? [],
      knownIssues: [...next.knownIssues, ...(existing?.knownIssues ?? [])].slice(0, 8),
    };
    await putMemory(merged);
    setMemory(merged);
  }, [files, index, modId]);

  const send = useCallback(async () => {
    const query = prompt.trim();
    if (!query) return;
    if (!activeModel) {
      setError("No local model is loaded. Open the AI Center, download a model and press Load — Vex Studio does not silently fall back to a cloud model.");
      return;
    }

    setError(null);
    setPending([]);
    const pkg = analyseContext(query);
    await push({ role: "user", content: query, modelId: activeModel.modelId, contextFiles: pkg.usedFiles.map((f) => f.path), proposalId: null, usage: { promptLines: pkg.totalLines, contextFiles: pkg.usedFiles.length } });
    setPrompt("");
    setBusy(true);
    setStreaming("");

    const controller = new AbortController();
    abortRef.current = controller;
    const settings = PROFILE_SETTINGS[profile];

    try {
      const result = await generateOnce({
        messages: [
          { role: "system", content: pkg.systemPrompt },
          ...(mode === "build"
            ? [{ role: "user" as const, content: "Implementation mode: produce the full replacement file(s) as fenced code blocks with the path as the first comment line." }]
            : []),
          { role: "user", content: query },
        ],
        maxTokens: settings.maxTokens,
        temperature: settings.temperature,
        topP: settings.topP,
        signal: controller.signal,
        onToken: (full) => setStreaming(full),
      });

      const parsed = parseProposals(result.text, files);
      setPending(parsed.proposals);
      await push({
        role: "assistant",
        content: result.text,
        modelId: activeModel.modelId,
        contextFiles: pkg.usedFiles.map((f) => f.path),
        proposalId: parsed.proposals.length > 0 ? newId("proposal") : null,
        usage: {
          promptLines: pkg.totalLines,
          contextFiles: pkg.usedFiles.length,
        },
      });
      if (result.usage.promptTokens === null && result.usage.completionTokens === null) {
        setError("The runtime did not report token usage for this generation, so token counts are not shown (lines of context are shown instead).");
      }
      await putMemory({
        ...(memory ?? memoryFromAnalysis(index, files)),
        modId,
        changes: [
          ...(memory?.changes ?? []),
          { at: new Date().toISOString(), summary: query.slice(0, 120), files: parsed.proposals.map((p) => p.path) },
        ].slice(-20),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
      await push({ role: "error", content: message, modelId: activeModel.modelId, contextFiles: [], proposalId: null, usage: null });
    } finally {
      setBusy(false);
      setStreaming("");
      abortRef.current = null;
    }
  }, [prompt, activeModel, analyseContext, push, mode, profile, files, memory, index, modId]);

  const applyAll = useCallback(
    async (accepted: Proposal[]) => {
      if (accepted.length === 0) return;
      await createSnapshot(modId, "Before AI apply", accepted.map((p) => p.path).join(", "));
      try {
        await onApplyChanges(accepted.map((p) => ({ path: p.path, content: p.after })));
        await putMemory({
          ...(memory ?? memoryFromAnalysis(index, files)),
          modId,
          changes: [
            ...(memory?.changes ?? []),
            { at: new Date().toISOString(), summary: `Applied AI changes to ${accepted.map((p) => p.path).join(", ")}`, files: accepted.map((p) => p.path) },
          ].slice(-20),
          updatedAt: new Date().toISOString(),
        });
        setMemory(await getMemory(modId));
        setPending([]);
        onIndexRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Apply failed");
      }
    },
    [modId, onApplyChanges, memory, index, files, onIndexRefresh],
  );

  return (
    <div className="flex h-full flex-col gap-2" key={modelVersion}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="badge badge-accent">{activeModel ? activeModel.modelId : "no model loaded"}</span>
        <select className="select w-auto" aria-label="Performance profile" value={profile} onChange={(event) => setProfile(event.target.value as PerformanceProfile)}>
          {Object.entries(PROFILE_SETTINGS).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" onClick={() => setMode(mode === "ask" ? "build" : "ask")}>
          Mode: {mode === "ask" ? "Ask" : "Build"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void rebuildMemory()} title="Re-run deterministic project analysis">
          Analyse project
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void clearChats(modId).then(() => setTurns([]))}>
          Clear chat
        </button>
      </div>

      {context ? (
        <p className="muted text-xs">
          Context: {context.usedFiles.length} file(s), {context.totalLines} lines{context.truncated ? " (trimmed to fit the model budget)" : ""}
          {context.indexUsed ? " · selected by the project index" : " · index had no keyword hits"}
          {context.usedFiles.length > 0 ? `: ${context.usedFiles.map((f) => f.path).join(", ")}` : ""}
        </p>
      ) : null}

      <div className="scroll-y card-soft flex-1 p-2">
        {turns.length === 0 && !streaming ? (
          <p className="muted text-xs">
            Ask about this mod, or switch to <strong>Build</strong> mode to let the model write replacement files. Every change is shown as a diff first and only
            written after you approve it.
          </p>
        ) : null}
        {turns.map((turn) => (
          <div key={turn.id} className="mb-2">
            <p className="text-[11px]" style={{ color: "var(--muted)" }}>
              {turn.role} {turn.modelId ? `· ${turn.modelId}` : ""} {turn.contextFiles.length ? `· read: ${turn.contextFiles.join(", ")}` : ""}
            </p>
            <div className={`card ${turn.role === "error" ? "badge-danger" : ""} p-2`}>
              <pre className="console" style={{ whiteSpace: "pre-wrap" }}>
                {turn.content}
              </pre>
            </div>
          </div>
        ))}
        {streaming ? (
          <div className="card p-2">
            <pre className="console" style={{ whiteSpace: "pre-wrap" }}>
              {streaming}
            </pre>
          </div>
        ) : null}

        {pending.length > 0 ? (
          <div className="mt-2">
            <p className="text-xs font-semibold">Proposed changes ({pending.length}) — nothing is written until you approve.</p>
            {pending.map((proposal) => (
              <div key={proposal.path}>
                <DiffView proposal={proposal} />
                <div className="mt-1 flex gap-1">
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void applyAll([proposal])}>
                    Apply {proposal.path.split("/").pop()}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setPending((prev) => prev.filter((p) => p.path !== proposal.path))}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
            <div className="mt-2 flex gap-1">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void applyAll(pending)}>
                Apply all
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setPending([])}>
                Reject all
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="badge badge-danger w-full whitespace-normal text-left text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {memory ? (
        <details className="card-soft p-2 text-xs">
          <summary className="cursor-pointer">Project memory (per mod)</summary>
          <p className="mt-1">
            <strong>Purpose:</strong> {memory.purpose}
          </p>
          <p>
            <strong>Architecture:</strong> {memory.architecture}
          </p>
          {memory.modules.length > 0 ? (
            <p>
              <strong>Modules:</strong> {memory.modules.join(", ")}
            </p>
          ) : null}
          {memory.changes.length > 0 ? (
            <p>
              <strong>Recent changes:</strong> {memory.changes.slice(-3).map((c) => `${c.summary}`).join(" | ")}
            </p>
          ) : null}
          <p className="muted mt-1">Memory is a summary, not a source of truth: the file tree always wins when the two disagree.</p>
        </details>
      ) : null}

      <div className="flex items-end gap-1">
        <label className="sr-only" htmlFor="ai-prompt">
          Ask the local model
        </label>
        <textarea
          id="ai-prompt"
          className="textarea min-h-[64px]"
          placeholder={activeModel ? "e.g. fix the inventory logic in game.js" : "Load a model in the AI Center first"}
          value={prompt}
          disabled={!activeModel || busy}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="flex flex-col gap-1">
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !activeModel} onClick={() => void send()}>
            Send
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!busy}
            onClick={() => {
              abortRef.current?.abort();
              getActiveModel()?.engine.interruptGenerate();
            }}
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
