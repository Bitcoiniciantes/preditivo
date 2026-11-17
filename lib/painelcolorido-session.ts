"use client";
// lib/painelcolorido-session.ts — agregações VISUAIS client-side exclusivas da
// rota painelcolorido.* (buffers de ticks p/ sparklines, churn de estados).
//
// Regras: nenhum backend, nenhum socket próprio, nenhum cálculo do motor;
// só reorganiza dados já presentes no snapshot do stream para apresentação.
// Não altera nenhum módulo existente.

import { useEffect, useRef, useState } from "react";
import type { MarketStreamData } from "./useMarketStream";

const MAX_PTS = 240; // ~4 min de ticks a ~1/s; suficiente p/ sparklines
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

export type PcSeries = {
  price: number[];
  cvd: number[];
  whale: number[];
  oi: number[];
  funding: number[];
  imb: number[];
};

export type PcChurn = {
  /** Mudanças de regime/fluxo/divergência/absorção na última hora. */
  churnH: number;
  /** Mudanças dos mesmos estados no último minuto. */
  transitions1min: number;
};

const empty: { series: PcSeries; churn: PcChurn } = {
  series: { price: [], cvd: [], whale: [], oi: [], funding: [], imb: [] },
  churn: { churnH: 0, transitions1min: 0 },
};

function pushCapped(arr: number[], v: number): number[] {
  const next = arr.length >= MAX_PTS ? [...arr.slice(arr.length - MAX_PTS + 1), v] : [...arr, v];
  return next;
}

// Formatação adaptativa $K/$M/$B que trata valores negativos (o fmtUsd
// compartilhado só abrevia positivos; CVD negativo saía por extenso).
// Escopo: somente rota painelcolorido.* — não altera o lib compartilhado.
export function fmtPcUsd(v: number): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export function usePainelColoridoSeries(data: MarketStreamData | null): typeof empty {
  const [snap, setSnap] = useState(empty);
  const ref = useRef({
    series: { price: [] as number[], cvd: [] as number[], whale: [] as number[], oi: [] as number[], funding: [] as number[], imb: [] as number[] },
    changes: [] as number[],
    last: { regime: "", flow: "", div: "", abs: "" },
  });

  useEffect(() => {
    if (!data) return;
    const r = ref.current;
    const nowMs = Date.now();
    r.series = {
      price: pushCapped(r.series.price, data.p),
      cvd: pushCapped(r.series.cvd, data.cvd),
      whale: pushCapped(r.series.whale, data.cvd_whale),
      oi: pushCapped(r.series.oi, data.oi),
      funding: pushCapped(r.series.funding, data.funding),
      imb: pushCapped(r.series.imb, data.imb),
    };
    const cur = { regime: data.regime, flow: data.flow_regime, div: data.divergence, abs: data.absorption_state };
    if (r.last.regime !== "" && (r.last.regime !== cur.regime || r.last.flow !== cur.flow || r.last.div !== cur.div || r.last.abs !== cur.abs)) {
      r.changes.push(nowMs);
    }
    r.last = cur;
    while (r.changes.length && nowMs - r.changes[0] > HOUR_MS) r.changes.shift();
    setSnap({
      series: { ...r.series },
      churn: {
        churnH: r.changes.length,
        transitions1min: r.changes.filter((t) => nowMs - t <= MIN_MS).length,
      },
    });
  }, [data]);

  return snap;
}
