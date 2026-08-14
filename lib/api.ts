import { displayAsset, intervals, rsiPeriods, staticAssets } from "./config";
import { completedCandles, wilderRsi } from "./analysis";
import { mapSettledWithConcurrency } from "./concurrency";
import { latestNuplReading } from "./nupl";
import type { Candle, MarketData, MultiRsi, NuplReading, StaticSnapshot } from "./types";

const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAYS_MS = [500, 1_500];
const NUPL_URL = "https://bitcoiniciantes.github.io/estudebitcoin/dados/nupl.json";
const STOCK_WORKER_URL = "https://bitcoiniciantes-ia.bitcoiniciantes.workers.dev/api/candles";

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Operação cancelada", "AbortError"));
      },
      { once: true },
    );
  });
}

function errorMessage(body: unknown, fallback: string) {
  if (
    body &&
    typeof body === "object" &&
    "msg" in body &&
    typeof body.msg === "string"
  ) {
    return body.msg;
  }
  return fallback;
}

async function fetchJson(
  url: string,
  options: RequestInit = {},
  retryDelays = RETRY_DELAYS_MS,
): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(new DOMException("Tempo de consulta excedido", "TimeoutError")),
      REQUEST_TIMEOUT_MS,
    );
    const abortParent = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortParent, { once: true });

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;

      const retryable = response.status === 429 || response.status >= 500;
      const message = errorMessage(body, `Fonte respondeu HTTP ${response.status}`);
      if (!retryable || attempt === retryDelays.length) throw new Error(message);
      lastError = new Error(message);
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException("Operação cancelada", "AbortError");
      }
      lastError = error;
      if (attempt === retryDelays.length) throw error;
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortParent);
    }

    await abortableDelay(retryDelays[attempt], options.signal ?? undefined);
  }

  throw lastError instanceof Error ? lastError : new Error("Fonte indisponível");
}

function parseCandles(body: unknown): Candle[] {
  if (!Array.isArray(body)) throw new Error("Resposta de mercado inválida");

  const candles = body.flatMap((row): Candle[] => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const values = row.slice(0, 6).map(Number);
    if (!values.every(Number.isFinite)) return [];
    const [time, open, high, low, close, volume] = values;
    const takerBuyVolume = Number(row[9]);
    return [{
      time,
      open,
      high,
      low,
      close,
      volume,
      ...(Number.isFinite(takerBuyVolume) ? { takerBuyVolume } : {}),
    }];
  });

  if (candles.length < 55) throw new Error("Histórico de mercado insuficiente");
  return candles;
}

function parseStaticSnapshot(body: unknown): StaticSnapshot {
  if (!body || typeof body !== "object") throw new Error("Snapshot de mercado inválido");
  const snapshot = body as Partial<StaticSnapshot>;
  if (
    typeof snapshot.source !== "string" ||
    !Number.isFinite(snapshot.updatedAt) ||
    !snapshot.periods ||
    typeof snapshot.periods !== "object"
  ) {
    throw new Error("Snapshot de mercado incompleto");
  }
  return snapshot as StaticSnapshot;
}

function staticBasePath() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/termometro")
    ? "/termometro"
    : "";
}

async function fetchStaticSnapshot(
  asset: string,
  signal?: AbortSignal,
): Promise<StaticSnapshot> {
  const config = staticAssets[asset];
  if (!config) throw new Error("Ativo pré-cadastrado não localizado");
  const body = await fetchJson(
    `${staticBasePath()}/data/${config.file}.json?v=${Math.floor(Date.now() / 60_000)}`,
    { signal, cache: "no-store" },
    [500],
  );
  return parseStaticSnapshot(body);
}

export async function fetchStaticAsset(
  asset: string,
  period: string,
  signal?: AbortSignal,
): Promise<MarketData> {
  const config = staticAssets[asset];
  if (!config) throw new Error("Ativo pré-cadastrado não localizado");
  const snapshot = await fetchStaticSnapshot(asset, signal);
  const candles = snapshot.periods[period] ?? [];
  if (candles.length < 55) {
    throw new Error(`Histórico de ${displayAsset(asset)} insuficiente em ${period}`);
  }
  return {
    asset,
    pair: `${asset}/${config.currency}`,
    source: snapshot.source,
    updatedAt: snapshot.updatedAt,
    period,
    candles,
  };
}

export async function fetchMarket(
  asset: string,
  period: string,
  signal?: AbortSignal,
): Promise<MarketData> {
  if (staticAssets[asset]) return fetchStaticAsset(asset, period, signal);
  const symbol = `${asset}USDT`;
  const url =
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}` +
    `&interval=${intervals[period] || "1d"}&limit=120`;
  const body = await fetchJson(url, { signal });
  const candles = parseCandles(body);
  return {
    asset,
    pair: `${asset}/USDT`,
    source: "Binance Public Market Data",
    updatedAt: Date.now(),
    period,
    candles,
  };
}

export async function fetchLiveStockMarket(
  asset: string,
  period: string,
  signal?: AbortSignal,
): Promise<MarketData> {
  const url = `${STOCK_WORKER_URL}?asset=${encodeURIComponent(asset)}&period=${encodeURIComponent(period)}`;
  const body = await fetchJson(url, { signal }, []);
  if (!body || typeof body !== "object" || !Array.isArray((body as { candles?: unknown }).candles)) {
    throw new Error(`Dados de ${displayAsset(asset)} temporariamente indisponíveis`);
  }
  const candles = ((body as { candles: Candle[] }).candles).filter(
    (c) => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close),
  );
  if (candles.length < 55) {
    throw new Error(`Histórico de ${displayAsset(asset)} insuficiente em ${period}`);
  }
  return {
    asset,
    pair: `${asset}/USD`,
    source: "Yahoo Finance",
    updatedAt: Date.now(),
    period,
    candles,
  };
}

export async function fetchBitcoinNupl(signal?: AbortSignal): Promise<NuplReading> {
  const body = await fetchJson(
    `${NUPL_URL}?v=${Math.floor(Date.now() / 600_000)}`,
    { signal, cache: "no-store" },
    [500],
  );
  return latestNuplReading(body);
}
async function loadBinanceOrStockCandles(asset: string, config: { interval: string; period: string }, signal?: AbortSignal): Promise<Candle[]> {
  try {
    const body = await fetchJson(
      `https://data-api.binance.vision/api/v3/klines?symbol=${asset}USDT` +
        `&interval=${config.interval}&limit=240`,
      { signal },
    );
    return parseCandles(body);
  } catch {
    return (await fetchLiveStockMarket(asset, config.period, signal)).candles;
  }
}

export async function fetchMultiRsi(
  asset: string,
  signal?: AbortSignal,
): Promise<MultiRsi> {
  const staticSnapshot = staticAssets[asset]
    ? await fetchStaticSnapshot(asset, signal).catch(() => null)
    : null;
  const settled = await mapSettledWithConcurrency(rsiPeriods, 3, async (config) => {
    let candles: Candle[];
    if (staticSnapshot) {
      candles = staticSnapshot.periods[config.period] ?? [];
    } else if (staticAssets[asset]) {
      candles = (await fetchStaticAsset(asset, config.period, signal)).candles;
    } else {
      candles = await loadBinanceOrStockCandles(asset, config, signal);
    }
    const reading = wilderRsi(completedCandles(candles, config.period).map((candle) => candle.close));
    if (!reading) throw new Error("Histórico insuficiente");
    return { label: config.label, ...reading };
  });

  const rows = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!rows.length) throw new Error("RSI indisponível");

  const active = rsiPeriods.filter((config) =>
    rows.some((row) => row.label === config.label),
  );
  const totalWeight = active.reduce((sum, config) => sum + config.weight, 0);
  const weighted = (key: "value" | "previous") =>
    active.reduce(
      (sum, config) =>
        sum + rows.find((row) => row.label === config.label)![key] * config.weight,
      0,
    ) / totalWeight;
  const general = weighted("value");
  const previousGeneral = weighted("previous");
  const bullCount = rows.filter((row) => row.value >= 50).length;
  const bearCount = rows.length - bullCount;
  const signalText =
    general >= 80
      ? "FORÇA EXTREMA"
      : general <= 25
        ? "FRAQUEZA EXTREMA"
        : bullCount >= 4 && general >= 55
          ? "VIÉS DE ALTA"
          : bearCount >= 4 && general <= 45
            ? "VIÉS DE BAIXA"
            : "SEM VANTAGEM CLARA";

  return {
    rows,
    general,
    previousGeneral,
    bullCount,
    bearCount,
    signal: signalText,
  };
}
