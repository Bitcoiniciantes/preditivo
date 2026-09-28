"use client";
// lib/painelcolorido-ai.ts — cliente da Análise IA do PainelColorido.
// Fala SOMENTE com o servidor HTTP local (localhost:3002). Nunca chama o
// Gemini do browser, nunca expõe chave. POST sem corpo: o snapshot é lido
// da memória do daemon no backend — nada de mercado trafega pelo browser.

export type PcIaAnalysis = {
  texto: string;
  geradoEm: string;
  modelo: string;
  snapshotTs: number;
  snapshotIdadeSeg: number;
};

export class PcIaError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number;

  constructor(message: string, status: number, retryAfterSeconds = 0) {
    super(message);
    this.name = "PcIaError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const PC_IA_CACHE_KEY = "pc-ia-v1";
const PC_IA_CACHE_TTL_MS = 5 * 60_000;
const PC_IA_TIMEOUT_MS = 20_000;

export function resolvePcIaUrl(): string {
  const base = (process.env.NEXT_PUBLIC_PC_IA_URL || "").trim().replace(/\/+$/, "");
  return base.length > 0 ? `${base}/api/painel-ia` : "http://localhost:3002/api/painel-ia";
}

function isPcIaAnalysis(value: unknown): value is PcIaAnalysis {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PcIaAnalysis>;
  return typeof v.texto === "string"
    && v.texto.length > 0
    && typeof v.geradoEm === "string"
    && typeof v.modelo === "string"
    && typeof v.snapshotTs === "number"
    && Number.isFinite(v.snapshotTs)
    && typeof v.snapshotIdadeSeg === "number"
    && Number.isFinite(v.snapshotIdadeSeg);
}

export function readCachedPcIa(): PcIaAnalysis | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PC_IA_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { expiresAt?: number; analysis?: unknown } | null;
    if (!cached || !Number.isFinite(cached.expiresAt) || Number(cached.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(PC_IA_CACHE_KEY);
      return null;
    }
    if (!isPcIaAnalysis(cached.analysis)) {
      window.localStorage.removeItem(PC_IA_CACHE_KEY);
      return null;
    }
    return cached.analysis;
  } catch {
    return null;
  }
}

export function writeCachedPcIa(analysis: PcIaAnalysis): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PC_IA_CACHE_KEY, JSON.stringify({ expiresAt: Date.now() + PC_IA_CACHE_TTL_MS, analysis }));
  } catch {
    // Armazenamento cheio/bloqueado: análise segue válida em memória.
  }
}

export function clearCachedPcIa(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PC_IA_CACHE_KEY);
  } catch {
    // Sem armazenamento: nada a limpar.
  }
}

export async function fetchPcIa(signal?: AbortSignal): Promise<PcIaAnalysis> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException("Tempo de análise excedido", "TimeoutError"));
  }, PC_IA_TIMEOUT_MS);

  try {
    const response = await fetch(resolvePcIaUrl(), {
      method: "POST",
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as
      | PcIaAnalysis
      | { error?: string; retryAfterSeconds?: number }
      | null;
    if (!response.ok) {
      const retryAfterHeader = Number(response.headers.get("Retry-After"));
      const retryAfterSeconds = body && "retryAfterSeconds" in body && Number.isFinite(body.retryAfterSeconds)
        ? Number(body.retryAfterSeconds)
        : Number.isFinite(retryAfterHeader)
          ? retryAfterHeader
          : 0;
      const message = body && "error" in body && body.error ? body.error : "Análise IA indisponível.";
      throw new PcIaError(message, response.status, retryAfterSeconds);
    }
    if (!isPcIaAnalysis(body)) {
      throw new PcIaError("Resposta inválida do servidor local.", response.status);
    }
    return body;
  } catch (cause) {
    if (cause instanceof PcIaError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new PcIaError("Tempo de análise excedido. Tente novamente.", 0);
    }
    throw new PcIaError("Servidor local indisponível. Rode o daemon (porta 3002).", 0);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
