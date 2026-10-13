/**
 * Local (in-browser) model catalogue.
 *
 * Sizes and memory numbers are *estimates* taken from the upstream model cards and
 * the WebLLM prebuilt configuration. They are marked as estimates everywhere in the
 * UI. The runtime report (see webllm.ts) overrides them with the real
 * `vram_required_MB` value published by @mlc-ai/web-llm when that runtime version
 * is available in the browser.
 */

export type RuntimeKind = "webllm-webgpu";

export type ModelCatalogEntry = {
  id: string;
  label: string;
  provider: string;
  webllmModelId: string;
  parameters: string;
  quantization: string;
  contextWindow: number;
  downloadBytes: number;
  ramMb: number;
  vramMbEstimate: number;
  diskMbEstimate: number;
  codingAbility: "basic" | "moderate" | "strong";
  languages: string[];
  license: string;
  sourceUrl: string;
  notes: string;
};

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "smollm2-360m",
    label: "SmolLM2 360M Instruct",
    provider: "HuggingFaceTB",
    webllmModelId: "SmolLM2-360M-Instruct-q4f16_1-MLC",
    parameters: "0.36B",
    quantization: "q4f16_1",
    contextWindow: 4096,
    downloadBytes: 430 * 1024 * 1024,
    ramMb: 1200,
    vramMbEstimate: 700,
    diskMbEstimate: 460,
    codingAbility: "basic",
    languages: ["en"],
    license: "Apache-2.0",
    sourceUrl: "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct",
    notes: "Runs on modest hardware and most phones with WebGPU. Best for explanations and small edits.",
  },
  {
    id: "qwen25-coder-1.5b",
    label: "Qwen2.5 Coder 1.5B Instruct",
    provider: "Qwen",
    webllmModelId: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    parameters: "1.54B",
    quantization: "q4f16_1",
    contextWindow: 32768,
    downloadBytes: 1300 * 1024 * 1024,
    ramMb: 3000,
    vramMbEstimate: 1800,
    diskMbEstimate: 1400,
    codingAbility: "strong",
    languages: ["en", "zh", "multilingual"],
    license: "Apache-2.0 (Qwen research licence for 3B+ variants)",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct",
    notes: "Default coding model for Vex Studio: good code edits within a small footprint.",
  },
  {
    id: "llama32-1b",
    label: "Llama 3.2 1B Instruct",
    provider: "Meta",
    webllmModelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    parameters: "1.24B",
    quantization: "q4f16_1",
    contextWindow: 8192,
    downloadBytes: 900 * 1024 * 1024,
    ramMb: 2400,
    vramMbEstimate: 1500,
    diskMbEstimate: 950,
    codingAbility: "moderate",
    languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"],
    license: "Llama 3.2 Community License",
    sourceUrl: "https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct",
    notes: "Balanced general model; useful for architecture questions in several languages.",
  },
  {
    id: "qwen25-1.5b",
    label: "Qwen2.5 1.5B Instruct",
    provider: "Qwen",
    webllmModelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    parameters: "1.54B",
    quantization: "q4f16_1",
    contextWindow: 32768,
    downloadBytes: 1300 * 1024 * 1024,
    ramMb: 3000,
    vramMbEstimate: 1800,
    diskMbEstimate: 1400,
    codingAbility: "moderate",
    languages: ["en", "zh", "multilingual"],
    license: "Qwen Research Licence",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct",
    notes: "Long context general assistant; not code specialised.",
  },
  {
    id: "llama32-3b",
    label: "Llama 3.2 3B Instruct",
    provider: "Meta",
    webllmModelId: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    parameters: "3.21B",
    quantization: "q4f16_1",
    contextWindow: 8192,
    downloadBytes: 2200 * 1024 * 1024,
    ramMb: 5200,
    vramMbEstimate: 3200,
    diskMbEstimate: 2300,
    codingAbility: "moderate",
    languages: ["en", "de", "fr", "it", "pt", "hi", "es", "th"],
    license: "Llama 3.2 Community License",
    sourceUrl: "https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct",
    notes: "Needs ~4 GB of free memory. Desktop GPUs or high-end laptops only.",
  },
  {
    id: "phi35-mini",
    label: "Phi 3.5 mini Instruct",
    provider: "Microsoft",
    webllmModelId: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    parameters: "3.82B",
    quantization: "q4f16_1",
    contextWindow: 32768,
    downloadBytes: 2500 * 1024 * 1024,
    ramMb: 6000,
    vramMbEstimate: 3600,
    diskMbEstimate: 2600,
    codingAbility: "moderate",
    languages: ["en", "multilingual"],
    license: "MIT",
    sourceUrl: "https://huggingface.co/microsoft/Phi-3.5-mini-instruct",
    notes: "Strong reasoning per byte, long context. Verify available device memory before loading.",
  },
  {
    id: "qwen25-coder-7b",
    label: "Qwen2.5 Coder 7B Instruct",
    provider: "Qwen",
    webllmModelId: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
    parameters: "7.62B",
    quantization: "q4f16_1",
    contextWindow: 32768,
    downloadBytes: 5100 * 1024 * 1024,
    ramMb: 11000,
    vramMbEstimate: 6200,
    diskMbEstimate: 5200,
    codingAbility: "strong",
    languages: ["en", "zh", "multilingual"],
    license: "Apache-2.0",
    sourceUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct",
    notes: "Highest quality local option here. Requires a discrete GPU with ~6 GB VRAM; expect long first load.",
  },
];

export type DeviceCapability = {
  webgpu: boolean;
  adapterInfo: string | null;
  maxBufferMb: number | null;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
  platform: string;
  mobile: boolean;
};

type MinimalGpuAdapter = {
  limits?: { maxBufferSize?: number };
  info?: { vendor?: string; architecture?: string; device?: string };
};

type MinimalGpu = { requestAdapter: () => Promise<MinimalGpuAdapter | null> };

export async function detectDevice(): Promise<DeviceCapability> {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string; mobile?: boolean } };
  let webgpu = false;
  let adapterInfo: string | null = null;
  let maxBufferMb: number | null = null;

  const gpu = (nav as unknown as { gpu?: MinimalGpu }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        maxBufferMb = Math.round((adapter.limits?.maxBufferSize ?? 0) / (1024 * 1024)) || null;
        const info = (adapter as unknown as { info?: { vendor?: string; architecture?: string; device?: string } }).info;
        adapterInfo = info ? [info.vendor, info.architecture, info.device].filter(Boolean).join(" ") || "WebGPU adapter" : "WebGPU adapter";
      }
    } catch {
      webgpu = false;
    }
  }

  return {
    webgpu,
    adapterInfo,
    maxBufferMb,
    deviceMemoryGb: nav.deviceMemory ?? null,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    platform: nav.userAgentData?.platform ?? nav.platform ?? "unknown",
    mobile: nav.userAgentData?.mobile ?? /android|iphone|ipad|mobile/i.test(nav.userAgent),
  };
}

export type Compatibility = {
  status: "supported" | "partial" | "unsupported";
  reasons: string[];
  estimatedTotalMb: number;
};

export function evaluateCompatibility(entry: ModelCatalogEntry, device: DeviceCapability): Compatibility {
  const reasons: string[] = [];
  const estimatedTotalMb = Math.round(entry.downloadBytes / (1024 * 1024)) + entry.vramMbEstimate;

  if (!device.webgpu) {
    reasons.push("WebGPU is unavailable in this browser, so WebLLM cannot run any model locally.");
  }
  if (device.maxBufferMb !== null && entry.vramMbEstimate > device.maxBufferMb) {
    reasons.push(`Single buffer limit reported by the adapter is ${device.maxBufferMb} MB; this model is estimated to need ~${entry.vramMbEstimate} MB.`);
  }
  if (device.deviceMemoryGb !== null && entry.ramMb / 1024 > device.deviceMemoryGb * 0.6) {
    reasons.push(`Browser reports ~${device.deviceMemoryGb} GB device memory; the model estimate is ~${Math.round(entry.ramMb / 1024)} GB.`);
  }
  if (device.mobile && entry.vramMbEstimate > 2200) {
    reasons.push("Mobile WebGPU devices usually cannot allocate this much memory; expect failure or tab eviction.");
  }

  if (reasons.length === 0) return { status: "supported", reasons, estimatedTotalMb };
  if (!device.webgpu || reasons.length >= 2 || entry.vramMbEstimate > 4000) {
    return { status: "unsupported", reasons, estimatedTotalMb };
  }
  return { status: "partial", reasons, estimatedTotalMb };
}

export type PerformanceProfile = "low" | "balanced" | "quality";

export const PROFILE_SETTINGS: Record<PerformanceProfile, { label: string; maxTokens: number; temperature: number; topP: number; note: string }> = {
  low: { label: "Low (fastest)", maxTokens: 512, temperature: 0.2, topP: 0.8, note: "Short answers, lowest memory pressure. Does not guarantee weak devices can run big models." },
  balanced: { label: "Balanced", maxTokens: 1024, temperature: 0.4, topP: 0.9, note: "Default sampling settings for coding help." },
  quality: { label: "Quality (slowest)", maxTokens: 2048, temperature: 0.6, topP: 0.95, note: "Longest outputs; heaviest memory use and highest time-to-first-token." },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
