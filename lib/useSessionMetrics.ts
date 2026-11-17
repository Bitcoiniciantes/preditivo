"use client";
// lib/useSessionMetrics.ts — métricas de sessão compartilhadas (extração sem
// mudança de comportamento: mesma lógica antes inline em MarketObservatory; agora consumida pelo Observatório
// E pelo Super Painel, sem duplicação e sem nenhum cálculo novo).
//
// Conteúdo: buffers de 15 min (preço/CVD) e 120 s (OI), CVD Δ15m com guarda de
// reset (>50% de queda em 1 passo = sessão reiniciada), ΔOI/1min via
// computeOiDelta, persistência de estado (instante da última mudança, relógio
// local) e agregação de whale events da sessão (contagem + volume por lado).
// sparkline, timeline, churn e gaps permanecem exclusivos do Observatório.
import { useEffect, useRef, useState } from "react";
import { computeOiDelta, type OiDelta } from "./oi-delta";
import type { MarketStreamData } from "./useMarketStream";

const WINDOW_MS = 15 * 60_000; // últimos 15 minutos
const OI_WINDOW_MS = 60_000; // ΔOI sobre 1 min (material)
const OI_BUF_MS = 120_000; // buffer de OI p/ calcular o ΔOI

export type SessionMetrics = {
  cvdDelta: number | null;
  cvdWhaleDelta: number | null;
  oiDelta: OiDelta;
  since: { regime: number; flow: number; div: number; abs: number };
  whaleBuy: number;
  whaleSell: number;
  whaleMagBuy: number;
  whaleMagSell: number;
};

const zero: SessionMetrics = {
  cvdDelta: null,
  cvdWhaleDelta: null,
  oiDelta: null,
  since: { regime: 0, flow: 0, div: 0, abs: 0 },
  whaleBuy: 0,
  whaleSell: 0,
  whaleMagBuy: 0,
  whaleMagSell: 0,
};

// Formatação adaptativa: $K para milhares, $M para milhões — nunca "$0.0M".
export function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// Delta assinado em $M (ex.: "+$2.14M"); null vira "—".
export function fmtSignedM(v: number | null): string {
  return v === null ? "—" : `${v >= 0 ? "+" : ""}$${(v / 1e6).toFixed(2)}M`;
}

export function useSessionMetrics(data: MarketStreamData | null): SessionMetrics {
  const [m, setM] = useState<SessionMetrics>(zero);
  const ref = useRef({
    cvdBuf: [] as { t: number; cvd: number; cw: number }[],
    oiBuf: [] as { ts: number; oi: number }[],
    since: { regime: 0, flow: 0, div: 0, abs: 0 },
    whaleBuy: 0,
    whaleSell: 0,
    whaleMagBuy: 0,
    whaleMagSell: 0,
  });
  const lastState = useRef<{ regime: string; flow: string; div: string; abs: string }>({ regime: "", flow: "", div: "", abs: "" });

  useEffect(() => {
    if (!data) return;
    const now = data.ts;
    const nowMs = Date.now();
    const r = ref.current;

    r.cvdBuf.push({ t: now, cvd: data.cvd, cw: data.cvd_whale });
    r.oiBuf.push({ ts: now, oi: data.oi });
    while (r.cvdBuf.length && now - r.cvdBuf[0].t > WINDOW_MS) r.cvdBuf.shift();
    while (r.oiBuf.length && now - r.oiBuf[0].ts > OI_BUF_MS) r.oiBuf.shift();

    for (const ev of data.events ?? []) {
      if (ev.direction === "bullish") { r.whaleBuy++; r.whaleMagBuy += ev.magnitude; }
      else if (ev.direction === "bearish") { r.whaleSell++; r.whaleMagSell += ev.magnitude; }
    }

    const states: ["regime" | "flow" | "div" | "abs", string][] = [
      ["regime", data.regime],
      ["flow", data.flow_regime],
      ["div", data.divergence],
      ["abs", data.absorption_state],
    ];
    for (const [key, value] of states) {
      if (lastState.current[key] !== value) {
        lastState.current[key] = value;
        r.since[key] = nowMs;
      }
    }

    let cvdDelta: number | null = null;
    let cvdWhaleDelta: number | null = null;
    if (r.cvdBuf.length >= 2) {
      let reset = false;
      for (let i = 1; i < r.cvdBuf.length; i++) {
        const prev = r.cvdBuf[i - 1].cvd;
        if (prev > 0 && r.cvdBuf[i].cvd < prev * 0.5) { reset = true; break; }
      }
      if (!reset) {
        cvdDelta = r.cvdBuf[r.cvdBuf.length - 1].cvd - r.cvdBuf[0].cvd;
        cvdWhaleDelta = r.cvdBuf[r.cvdBuf.length - 1].cw - r.cvdBuf[0].cw;
      }
    }

    setM({
      cvdDelta,
      cvdWhaleDelta,
      oiDelta: computeOiDelta(r.oiBuf, OI_WINDOW_MS, now),
      since: { ...r.since },
      whaleBuy: r.whaleBuy,
      whaleSell: r.whaleSell,
      whaleMagBuy: r.whaleMagBuy,
      whaleMagSell: r.whaleMagSell,
    });
  }, [data]);

  return m;
}
