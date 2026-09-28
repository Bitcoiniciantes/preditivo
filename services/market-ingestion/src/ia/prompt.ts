// src/ia/prompt.ts — allowlist estrita do snapshot + construção do prompt.
// A IA recebe SOMENTE os campos listados em PcIaEstado. Séries históricas,
// OHLC/klines, hist, timeline e dbStats nunca saem daqui.
import type { MarketSnapshot } from '../types/index.js';

export type PcIaLongShort = {
  periodo: string;
  ratio: number;
  longPct: number;
  shortPct: number;
  idade_seg: number;
} | null;

export type PcIaEstado = {
  preco: number;
  ts: number;
  idade_seg: number;
  regime: string;
  regime_confidence: number;
  regime_volatility: number;
  flow_regime: string;
  flow_strength: number;
  imb_pct: number;
  cvd_total: number;
  cvd_whale: number;
  cvd_delta_15m: number | null;
  oi_contratos: number;
  oi_delta_1min: number;
  funding: number;
  funding_class: string;
  divergencia: string;
  absorcao_estado: string;
  absorcao_intensidade: number;
  score: number;
  score_quality: number;
  longShort_efetivo: PcIaLongShort;
  quality: { ws: string; oi: string; funding: string };
  churn_h: number | null;
  transicoes_1min: number | null;
};

export const PC_IA_SYSTEM_PROMPT =
  'Você é um analista quantitativo de microestrutura de mercado cripto. ' +
  'Analise os dados em JSON. Seja direto, técnico e sem saudações. ' +
  'Quando houver combinação relevante entre regime, imbalance e OI, descreva ' +
  'explicitamente a combinação e sua possível interpretação técnica da ' +
  'microestrutura, sem presumir armadilhas. ' +
  'Nunca sugira alavancagem ou faça previsões financeiras.';

const LS_PERIODOS_PREFERIDOS = ['15m', '5m', '1h', '4h', '1d'];

function pickLongShort(snapshot: MarketSnapshot, now: number): PcIaLongShort {
  const table = snapshot.longShort;
  if (!table) return null;
  const keys = [...LS_PERIODOS_PREFERIDOS, ...Object.keys(table)];
  for (const periodo of keys) {
    const entry = table[periodo];
    if (entry && Number.isFinite(entry.ratio)) {
      const fetchedAt = Number.isFinite(entry.fetchedAt) ? entry.fetchedAt : entry.updatedAt;
      return {
        periodo,
        ratio: entry.ratio,
        longPct: entry.longPct,
        shortPct: entry.shortPct,
        idade_seg: Math.max(0, Math.round((now - fetchedAt) / 1000)),
      };
    }
  }
  return null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = 'UNKNOWN'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function buildPcIaEstado(snapshot: MarketSnapshot, now: number): PcIaEstado {
  return {
    preco: num(snapshot.p),
    ts: num(snapshot.ts),
    idade_seg: Math.max(0, Math.round((now - num(snapshot.ts, now)) / 1000)),
    regime: str(snapshot.regime),
    regime_confidence: num(snapshot.regime_confidence),
    regime_volatility: num(snapshot.regime_volatility),
    flow_regime: str(snapshot.flow_regime),
    flow_strength: num(snapshot.flow_strength),
    imb_pct: num(snapshot.imb) * 100,
    cvd_total: num(snapshot.cvd),
    cvd_whale: num(snapshot.cvd_whale),
    // O daemon não mantém janela de 15m de CVD nem contadores de churn de
    // estados (métricas de sessão calculadas no frontend). null = indisponível.
    cvd_delta_15m: null,
    oi_contratos: num(snapshot.oi),
    oi_delta_1min: num(snapshot.oi_delta),
    funding: num(snapshot.funding),
    funding_class: str(snapshot.funding_class),
    divergencia: str(snapshot.divergence, 'NONE'),
    absorcao_estado: str(snapshot.absorption_state, 'NONE'),
    absorcao_intensidade: num(snapshot.absorption_intensity),
    score: num(snapshot.score),
    score_quality: num(snapshot.score_quality),
    longShort_efetivo: pickLongShort(snapshot, now),
    quality: {
      ws: str(snapshot.quality?.ws),
      oi: str(snapshot.quality?.oi),
      funding: str(snapshot.quality?.funding),
    },
    churn_h: null,
    transicoes_1min: null,
  };
}

export function buildPcIaUserPayload(estado: PcIaEstado): string {
  return JSON.stringify(estado);
}
