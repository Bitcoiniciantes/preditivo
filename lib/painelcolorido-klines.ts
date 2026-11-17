// lib/painelcolorido-klines.ts — histórico OHLC de BTCUSDT (rota painelcolorido.*).
// Fonte pública Binance Futures (fapi), com fallback para o endpoint spot
// público (vision). Somente leitura de preço — sem motor, sem cálculo do
// produto. Não altera nenhum módulo existente.

export const PC_TFS = ["1m", "5m", "15m", "1h", "4h", "1D", "1W"] as const;
export type PcTf = (typeof PC_TFS)[number];

export const PC_TF_MS: Record<PcTf, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1D": 86_400_000,
  "1W": 7 * 86_400_000,
};

const PC_BINANCE_TF: Record<PcTf, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1D": "1d",
  "1W": "1w",
};

export type PcBar = { t: number; o: number; h: number; l: number; c: number; v: number };

const LIMIT = 300;

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

function parse(rows: RawKline[]): PcBar[] {
  return rows
    .map((k) => ({
      t: Math.floor(k[0] / 1000),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    }))
    .filter((b) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

export type PcSource = "futures" | "spot";
export type PcKlines = { bars: PcBar[]; source: PcSource };

export async function fetchPcKlines(tf: PcTf, signal?: AbortSignal): Promise<PcKlines> {
  const iv = PC_BINANCE_TF[tf];
  const urls: { url: string; source: PcSource }[] = [
    { url: `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${iv}&limit=${LIMIT}`, source: "futures" },
    { url: `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${iv}&limit=${LIMIT}`, source: "spot" },
  ];
  let lastErr: unknown = null;
  for (const { url, source } of urls) {
    try {
      const res = await fetch(url, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bars = parse((await res.json()) as RawKline[]);
      if (bars.length >= 2) return { bars, source };
      throw new Error("resposta sem candles suficientes");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("klines indisponíveis");
}

// SMA simples sobre fechamentos — linha de contexto visual, sem leitura de sinal.
export function sma(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i + 1 < period) return null;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += closes[j];
    return s / period;
  });
}

// RSI clássico (período 14, suavização de Wilder) sobre fechamentos.
// Retorno alinhado aos índices das barras, com null enquanto há dados
// insuficientes. Mercado plano (sem ganhos nem perdas) = 50 (neutro).
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
