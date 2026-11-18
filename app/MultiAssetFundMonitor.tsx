"use client";

import { useEffect, useMemo, useState } from "react";
import {
  analyzeBrakeRadar,
  BRAKE_ASSETS,
  fetchBrakeKlines,
  type BrakeAssetSymbol,
  type BrakeKlinesSnapshot,
} from "../lib/brake-radar";
import { analyzeTopRadar } from "../lib/top-radar";

const REFRESH_MS = 60_000;
const fundPillLabel: Record<string, string> = {
  REACTION: "COMPRA",
  REBOUND: "OBSERVAR",
  SLOWING: "OBSERVAR",
  ACCELERATING: "QUEDA",
  UNSTABLE: "QUEDA",
  NO_DROP: "NEUTRO",
  UNAVAILABLE: "SEM DADOS",
};
const topPillLabel: Record<string, string> = {
  EXHAUSTION_CONFIRMED: "EXAUSTÃO",
  TOP_WATCH: "TOPO",
  DECELERATING: "DESACELERA",
  STRONG_UPTREND: "ALTA",
  ORIGIN_LOST: "ORIGEM",
  NEUTRAL: "NEUTRO",
  UNAVAILABLE: "SEM DADOS",
};

const EMPTY_SNAPSHOT: BrakeKlinesSnapshot = { h1: [], m15: [], fetchedAt: null };

export function MultiAssetFundMonitor({ btcSnapshot, now, radar, onSelect }: { btcSnapshot: BrakeKlinesSnapshot | null; now: number; radar: "fundos" | "topos"; onSelect: (symbol: BrakeAssetSymbol, snapshot: BrakeKlinesSnapshot | null) => void }) {
  const [snapshots, setSnapshots] = useState<Partial<Record<BrakeAssetSymbol, BrakeKlinesSnapshot>>>({});
  const [selected, setSelected] = useState<BrakeAssetSymbol>("BTCUSDT");

  // O BTC nunca é copiado para o estado local: a pílula lê o mesmo btcSnapshot
  // entregue ao radar principal, sem defasagem de um render e sem risco de
  // exibir status antigo quando a leitura ainda não chegou.
  const effectiveSnapshots = useMemo<Partial<Record<BrakeAssetSymbol, BrakeKlinesSnapshot>>>(() => {
    const next = { ...snapshots };
    if (btcSnapshot) next.BTCUSDT = btcSnapshot;
    else delete next.BTCUSDT;
    return next;
  }, [btcSnapshot, snapshots]);

  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running) return;
      running = true;
      const assets = BRAKE_ASSETS.filter(({ symbol }) => symbol !== "BTCUSDT");
      const results = await Promise.allSettled(assets.map(({ symbol }) => fetchBrakeKlines(controller.signal, symbol)));
      if (active) setSnapshots((current) => {
        const next = { ...current };
        results.forEach((result, index) => { if (result.status === "fulfilled") next[assets[index].symbol] = result.value; });
        return next;
      });
      running = false;
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, []);

  // O ativo pode ser selecionado antes de o primeiro polling terminar. Mantém o
  // radar principal sincronizado quando o snapshot desse ativo ficar disponível.
  useEffect(() => {
    onSelect(selected, effectiveSnapshots[selected] ?? null);
  }, [effectiveSnapshots, onSelect, selected]);

  // As pílulas seguem o modo ativo: Caça-Fundos usa analyzeBrakeRadar e
  // Caça-Topos usa analyzeTopRadar, sempre sobre a mesma fonte de candles.
  const fundReadings = useMemo(() => Object.fromEntries(BRAKE_ASSETS.map(({ symbol }) => [symbol, analyzeBrakeRadar({ ...(effectiveSnapshots[symbol] ?? EMPTY_SNAPSHOT), now })])), [effectiveSnapshots, now]);
  const topReadings = useMemo(() => Object.fromEntries(BRAKE_ASSETS.map(({ symbol }) => [symbol, analyzeTopRadar({ ...(effectiveSnapshots[symbol] ?? EMPTY_SNAPSHOT), now })])), [effectiveSnapshots, now]);
  const readings = radar === "fundos" ? fundReadings : topReadings;
  const labels = radar === "fundos" ? fundPillLabel : topPillLabel;

  return <div className="rrAssetTabs" role="tablist" aria-label="Selecionar ativo do radar">
      {BRAKE_ASSETS.map(({ symbol }) => {
        const reading = readings[symbol];
        return <button type="button" role="tab" key={symbol} aria-selected={selected === symbol} className={`rrAssetPill tone-${reading.tone} ${selected === symbol ? "active" : ""}`} onClick={() => setSelected(symbol)}>
          <i aria-hidden="true" />
          <span><b>{symbol.replace("USDT", "")}</b><small>{labels[reading.state] ?? "—"}</small></span>
        </button>;
      })}
  </div>;
}
