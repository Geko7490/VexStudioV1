/**
 * Real WebLLM (WebGPU) integration.
 *
 * The library is imported from a CDN at runtime so that:
 *  - no model weights or runtime code land in the app bundle,
 *  - a missing/blocked CDN produces an honest error instead of a fake success.
 */

const WEBLLM_CANDIDATE_URLS = [
  "https://esm.run/@mlc-ai/web-llm@0.2.79",
  "https://esm.sh/@mlc-ai/web-llm@0.2.79",
];

export type InitProgressReport = { progress: number; text: string; timeElapsed: number };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type CompletionChunk = {
  choices?: { delta?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type GenerationResult = {
  text: string;
  usage: { promptTokens: number | null; completionTokens: number | null };
};

export interface IWebLlmEngine {
  reload(modelId: string, options?: Record<string, unknown>): Promise<void>;
  unload(): Promise<void>;
  interruptGenerate(): void;
  resetChat(): Promise<void>;
  chat: {
    completions: {
      create(input: {
        messages: ChatMessage[];
        stream: boolean;
        stream_options?: { include_usage: boolean };
        max_tokens?: number;
        temperature?: number;
        top_p?: number;
      }): Promise<AsyncIterable<CompletionChunk>>;
    };
  };
}

interface WebLlmModule {
  CreateMLCEngine: (modelId: string, opts?: Record<string, unknown>) => Promise<IWebLlmEngine>;
  prebuiltAppConfig: {
    model_list: {
      model: string;
      vram_required_MB?: number;
      low_resource_required?: boolean;
      overrides?: Record<string, unknown>;
      model_lib?: string;
    }[];
  };
}

let modulePromise: Promise<WebLlmModule> | null = null;

const dynamicImport = new Function("specifier", "return import(specifier);") as (
  specifier: string,
) => Promise<unknown>;

export async function loadWebLlmLibrary(): Promise<WebLlmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      let lastError: unknown = null;
      for (const url of WEBLLM_CANDIDATE_URLS) {
        try {
          const mod = (await dynamicImport(url)) as WebLlmModule;
          if (typeof mod?.CreateMLCEngine === "function" && mod?.prebuiltAppConfig?.model_list) return mod;
          lastError = new Error("CDN module did not expose the expected WebLLM API");
        } catch (error) {
          lastError = error;
        }
      }
      modulePromise = null;
      throw new Error(
        `Unable to load the WebLLM runtime from CDN (${
          lastError instanceof Error ? lastError.message : "unknown error"
        }). Local AI requires network access to fetch the runtime once.`,
      );
    })();
  }
  return modulePromise;
}

/** Real runtime catalogue: model ids plus the VRAM numbers published upstream. */
export async function loadRuntimeModelInfo(): Promise<Map<string, { vramRequiredMb: number | null; lowResource: boolean; modelLib: string | null }>> {
  const mod = await loadWebLlmLibrary();
  const map = new Map<string, { vramRequiredMb: number | null; lowResource: boolean; modelLib: string | null }>();
  for (const entry of mod.prebuiltAppConfig.model_list) {
    map.set(entry.model, {
      vramRequiredMb: typeof entry.vram_required_MB === "number" ? entry.vram_required_MB : null,
      lowResource: Boolean(entry.low_resource_required),
      modelLib: entry.model_lib ?? null,
    });
  }
  return map;
}

export type LoadedModel = {
  modelId: string;
  engine: IWebLlmEngine;
  loadedAt: string;
  loadMs: number;
};

let active: LoadedModel | null = null;

const modelListeners = new Set<() => void>();

export function subscribeModel(fn: () => void): () => void {
  modelListeners.add(fn);
  return () => {
    modelListeners.delete(fn);
  };
}

function notifyModelChange() {
  for (const fn of modelListeners) fn();
}

export function getActiveModel(): LoadedModel | null {
  return active;
}

export type LoadEvents = {
  onProgress: (report: InitProgressReport) => void;
  shouldAbort: () => boolean;
};

export async function loadModel(modelId: string, events: LoadEvents): Promise<LoadedModel> {
  if (!("gpu" in navigator)) {
    throw new Error("This browser does not expose navigator.gpu, so WebGPU inference is unavailable.");
  }
  const mod = await loadWebLlmLibrary();
  if (active) {
    try {
      await active.engine.unload();
    } catch {
      /* previous engine already gone */
    }
    active = null;
  }
  const startedAt = performance.now();
  const engine = await mod.CreateMLCEngine(modelId, {
    initProgressCallback: (report: InitProgressReport) => {
      events.onProgress({
        progress: report.progress ?? 0,
        text: report.text ?? "loading",
        timeElapsed: report.timeElapsed ?? 0,
      });
    },
  });
  if (events.shouldAbort()) {
    try {
      await engine.unload();
    } catch {
      /* ignore */
    }
    throw new Error("Model load cancelled.");
  }
  active = { modelId, engine, loadedAt: new Date().toISOString(), loadMs: Math.round(performance.now() - startedAt) };
  return active;
}

export async function unloadModel(): Promise<void> {
  if (!active) return;
  try {
    await active.engine.unload();
  } finally {
    active = null;
  }
}

export async function generateOnce(input: {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  onToken?: (full: string) => void;
  signal?: AbortSignal;
}): Promise<GenerationResult> {
  if (!active) throw new Error("No model is loaded. Load a model in the AI Center first.");
  const engine = active.engine;
  const stream = await engine.chat.completions.create({
    messages: input.messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    top_p: input.topP,
  });

  let text = "";
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  for await (const chunk of stream) {
    if (input.signal?.aborted) {
      engine.interruptGenerate();
      break;
    }
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      text += delta;
      input.onToken?.(text);
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
      completionTokens = chunk.usage.completion_tokens ?? completionTokens;
    }
  }

  return { text, usage: { promptTokens, completionTokens } };
}

export async function runSmokeTest(): Promise<{ prompt: string; answer: string; ms: number }> {
  const startedAt = performance.now();
  const result = await generateOnce({
    messages: [
      { role: "system", content: "You are a coding assistant inside the Vex Studio web IDE. Answer briefly." },
      { role: "user", content: "Reply with exactly: VEX_LOCAL_AI_OK" },
    ],
    maxTokens: 32,
    temperature: 0,
  });
  return { prompt: "Reply with exactly: VEX_LOCAL_AI_OK", answer: result.text.trim(), ms: Math.round(performance.now() - startedAt) };
}
