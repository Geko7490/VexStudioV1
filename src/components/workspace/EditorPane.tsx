"use client";

import { useEffect, useRef, useState } from "react";
import { ensureMonaco, monacoStatus, onMonacoStatus } from "@/lib/monaco";

type MonacoApi = {
  editor: {
    create(element: HTMLElement, options: Record<string, unknown>): {
      getValue(): string;
      setValue(value: string): void;
      getModel(): unknown;
      dispose(): void;
      addAction(options: Record<string, unknown>): void;
      onDidChangeModelContent(cb: () => void): { dispose(): void };
    };
    setModelLanguage(model: unknown, language: string): void;
  };
};

const LANGUAGE_MAP: Record<string, string> = {
  html: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  svg: "xml",
};

export function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_MAP[ext] ?? "plaintext";
}

export function EditorPane({
  path,
  value,
  onChange,
  onSave,
  onFind,
}: {
  path: string | null;
  value: string;
  onChange: (next: string) => void;
  onSave: () => void;
  onFind: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReturnType<MonacoApi["editor"]["create"]> | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const [fallback, setFallback] = useState(false);
  const [status, setStatus] = useState(monacoStatus());

  useEffect(() => onMonacoStatus(setStatus), []);

  useEffect(() => {
    let disposed = false;
    if (!hostRef.current || editorRef.current) return;
    ensureMonaco()
      .then((monaco) => {
        if (disposed || !hostRef.current) return;
        const api = monaco as MonacoApi;
        monacoRef.current = api;
        const editor = api.editor.create(hostRef.current, {
          value,
          language: languageForPath(path ?? ""),
          theme: document.documentElement.dataset.theme === "light" ? "vs" : "vs-dark",
          automaticLayout: true,
          fontSize: 13,
          minimap: { enabled: false },
          tabSize: 2,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          renderWhitespace: "selection",
        });
        editorRef.current = editor;
        editor.onDidChangeModelContent(() => onChange(editor.getValue()));
        editor.addAction({ id: "vex.save", label: "Save File", keybindings: [2048 | 49], run: () => onSave() });
        editor.addAction({ id: "vex.find", label: "Find", keybindings: [512 | 36], run: () => onFind() });
      })
      .catch(() => setFallback(true));
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the model in sync without resetting the caret on every keystroke.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== value) editor.setValue(value);
  }, [path, value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !monacoRef.current) return;
    monacoRef.current.editor.setModelLanguage(editor.getModel(), languageForPath(path ?? ""));
  }, [path]);

  useEffect(() => {
    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  if (!path) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="muted text-sm">Select a file in the tree to start editing.</p>
      </div>
    );
  }

  if (fallback || status.state === "failed") {
    const lines = value.split("\n");
    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <p className="muted text-xs">
          Monaco could not be loaded ({status.message ?? "offline"}). Using the accessible fallback editor; syntax highlighting is disabled but nothing else changes.
        </p>
        <div className="flex flex-1 gap-2 overflow-hidden">
          <pre className="mono scroll-y select-none px-2 text-right text-[12px] leading-5" aria-hidden style={{ color: "var(--muted)" }}>
            {lines.map((_, index) => `${index + 1}\n`).join("")}
          </pre>
          <textarea
            className="textarea flex-1 resize-none leading-5"
            style={{ fontSize: 13, minHeight: "100%" }}
            aria-label={`Edit ${path}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                onSave();
              }
            }}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={hostRef} className="min-h-[240px] flex-1" aria-label={`Editor for ${path}`} />
    </div>
  );
}
