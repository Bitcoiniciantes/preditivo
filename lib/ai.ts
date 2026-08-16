import type { MultiRsi, Signal } from "./types";

export type AiAnalysisRequest = {
  asset: string;
  period: string;
  currentPrice: number;
  score: number;
  confidence: number;
  change: number;
  support: number;
  resistance: number;
  entry: number;
  stop: number;
  target: number;
  volumeRatio: number;
  multiRsi: Pick<MultiRsi, "general" | "bullCount" | "bearCount" | "signal"> | null;
  signals: Pick<Signal, "title" | "summary" | "score" | "group" | "context">[];
  localPreview?: AiAnalysisResponse;
};

export type AiAnalysisResponse = {
  headline: string;
  scenario: "ALTA" | "BAIXA" | "NEUTRO" | "RISCO ELEVADO";
  summary: string;
  strategy: string[];
  risks: string[];
  invalidation: string;
  generatedAt: string;
  provider?: "groq" | "gemini" | "mimo";
};

const AI_CACHE_TTL_MS = 5 * 60_000;
const NEWS_CACHE_TTL_MS = 5 * 60_000;
const AI_REQUEST_TIMEOUT_MS = 20_000;
const NEWS_REQUEST_TIMEOUT_MS = 12_000;
const WORKER_BASE_URL = "https://bitcoiniciantes-ia.bitcoiniciantes.workers.dev";
const validScenarios = new Set<AiAnalysisResponse["scenario"]>(["ALTA", "BAIXA", "NEUTRO", "RISCO ELEVADO"]);

function abortableFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Tempo de consulta excedido", "TimeoutError")),
    timeoutMs,
  );
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  });
}

function price(value: number) {
  return value > 0 ? value.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "não calculado";
}

export function buildLocalAiPreview(payload: AiAnalysisRequest): AiAnalysisResponse {
  const scenario: AiAnalysisResponse["scenario"] = payload.score >= 20
    ? "ALTA"
    : payload.score <= -20
      ? "BAIXA"
      : "NEUTRO";
  const direction = scenario === "ALTA" ? "viés de alta" : scenario === "BAIXA" ? "pressão de baixa" : "equilíbrio técnico";
  const strategy = scenario === "ALTA"
    ? [
        `Observar confirmação acima da resistência em ${price(payload.resistance)}, preferencialmente com aumento de volume.`,
        `Usar o suporte em ${price(payload.support)} como referência para acompanhar a sustentação do movimento.`,
      ]
    : scenario === "BAIXA"
      ? [
          `Acompanhar a reação do preço no suporte em ${price(payload.support)} antes de considerar melhora do cenário.`,
          `Uma recuperação acima da resistência em ${price(payload.resistance)} reduziria a pressão vendedora atual.`,
        ]
      : [
          `Aguardar rompimento confirmado da resistência em ${price(payload.resistance)} ou perda do suporte em ${price(payload.support)}.`,
          "Evitar antecipar direção enquanto os sinais permanecerem divididos.",
        ];
  if (payload.multiRsi) {
    strategy.push(`Monitorar o RSI geral em ${payload.multiRsi.general.toFixed(1)} para confirmar mudança de força entre os períodos.`);
  }
  const risks: string[] = [];
  if (payload.volumeRatio < 1) risks.push(`Volume em ${payload.volumeRatio.toFixed(2)}× a média reduz a confirmação do movimento.`);
  if (payload.confidence < 60) risks.push(`Concordância de ${payload.confidence}% indica sinais técnicos ainda divididos.`);
  if (Math.abs(payload.change) >= 4) risks.push(`Variação de ${payload.change.toFixed(2)}% aumenta o risco de volatilidade e falsos rompimentos.`);
  if (!risks.length) risks.push("Mudanças rápidas de preço podem invalidar a leitura entre dois fechamentos de candle.");
  const invalidation = scenario === "ALTA"
    ? `A leitura perde força com fechamento abaixo do suporte em ${price(payload.support)}.`
    : scenario === "BAIXA"
      ? `A pressão de baixa é invalidada por fechamento sustentado acima da resistência em ${price(payload.resistance)}.`
      : `O cenário neutro deixa de valer após rompimento confirmado de ${price(payload.resistance)} ou perda de ${price(payload.support)}.`;
  return {
    headline: `${payload.asset} em ${direction} no período ${payload.period}`,
    scenario,
    summary: `${payload.asset} registra nota ${payload.score > 0 ? "+" : ""}${payload.score}, confiança de ${payload.confidence}% e preço atual em ${price(payload.currentPrice)}. Esta é uma pré-análise determinística enquanto a IA refina a interpretação.`,
    strategy,
    risks: risks.slice(0, 3),
    invalidation,
    generatedAt: new Date().toISOString(),
  };
}

function isAiAnalysisResponse(value: unknown): value is AiAnalysisResponse {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Partial<AiAnalysisResponse>;
  return typeof analysis.headline === "string"
    && typeof analysis.scenario === "string"
    && validScenarios.has(analysis.scenario as AiAnalysisResponse["scenario"])
    && typeof analysis.summary === "string"
    && Array.isArray(analysis.strategy)
    && analysis.strategy.every(item => typeof item === "string")
    && Array.isArray(analysis.risks)
    && analysis.risks.every(item => typeof item === "string")
    && typeof analysis.invalidation === "string"
    && typeof analysis.generatedAt === "string";
}

function cacheKey(payload: AiAnalysisRequest) {
  return `termometro-ai-${encodeURIComponent(payload.asset)}-${encodeURIComponent(payload.period)}`;
}

export function readCachedAiAnalysis(payload: AiAnalysisRequest): AiAnalysisResponse | null {
  if (typeof window === "undefined") return null;
  const key = cacheKey(payload);
  try {
    const cached = JSON.parse(window.localStorage.getItem(key) || "null") as { expiresAt?: number; analysis?: unknown } | null;
    if (!cached || !Number.isFinite(cached.expiresAt) || Number(cached.expiresAt) <= Date.now() || !isAiAnalysisResponse(cached.analysis)) {
      window.localStorage.removeItem(key);
      return null;
    }
    return cached.analysis;
  } catch {
    return null;
  }
}

export function writeCachedAiAnalysis(payload: AiAnalysisRequest, analysis: AiAnalysisResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(payload), JSON.stringify({ expiresAt: Date.now() + AI_CACHE_TTL_MS, analysis }));
  } catch {}
}

export class AiAnalysisError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number;

  constructor(message: string, status: number, retryAfterSeconds = 0) {
    super(message);
    this.name = "AiAnalysisError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function fetchAiAnalysis(payload: AiAnalysisRequest, signal?: AbortSignal): Promise<AiAnalysisResponse> {
  const endpoint =
    typeof window !== "undefined" && (window.location.hostname === "bitcoiniciantes.github.io" || window.location.hostname.endsWith(".pages.dev"))
      ? `${WORKER_BASE_URL}/api/ai-analysis`
      : "/api/ai-analysis";
  const response = await abortableFetch(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    },
    AI_REQUEST_TIMEOUT_MS,
  );
  const body = (await response.json().catch(() => null)) as
    | AiAnalysisResponse
    | { error?: string; retryAfterSeconds?: number }
    | null;
  if (!response.ok) {
    const retryAfterHeader = Number(response.headers.get("Retry-After"));
    const retryAfterSeconds = body && "retryAfterSeconds" in body && Number.isFinite(body.retryAfterSeconds)
      ? Number(body.retryAfterSeconds)
      : Number.isFinite(retryAfterHeader)
        ? retryAfterHeader
        : 0;
    throw new AiAnalysisError(
      body && "error" in body && body.error ? body.error : "Análise por IA indisponível.",
      response.status,
      retryAfterSeconds,
    );
  }
  return body as AiAnalysisResponse;
}

export type AssetNewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
};

export type AssetNewsResponse = {
  asset: string;
  updatedAt: string;
  items: AssetNewsItem[];
};

const newsCache = new Map<string, { expiresAt: number; data: AssetNewsResponse }>();

export async function fetchAssetNews(asset: string, signal?: AbortSignal): Promise<AssetNewsResponse> {
  const cached = newsCache.get(asset);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const base =
    typeof window !== "undefined" && (window.location.hostname === "bitcoiniciantes.github.io" || window.location.hostname.endsWith(".pages.dev"))
      ? WORKER_BASE_URL
      : "";
  const response = await abortableFetch(
    base + "/api/asset-news?asset=" + encodeURIComponent(asset),
    { signal },
    NEWS_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error("Notícias indisponíveis.");
  const body = (await response.json()) as AssetNewsResponse;
  const data: AssetNewsResponse = Array.isArray(body.items)
    ? body
    : { asset, updatedAt: new Date().toISOString(), items: [] };
  newsCache.set(asset, { expiresAt: Date.now() + NEWS_CACHE_TTL_MS, data });
  return data;
}

