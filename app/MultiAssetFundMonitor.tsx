"use client";

import { useEffect, useState } from "react";
import {
  BRAKE_ASSETS,
  fetchBrakeKlines,
  type BrakeAssetSymbol,
  type BrakeKlinesSnapshot,
} from "../lib/brake-radar";

const REFRESH_MS = 60_000;
export function MultiAssetFundMonitor({ btcSnapshot, onSelect }: { btcSnapshot: BrakeKlinesSnapshot | null; onSelect: (symbol: BrakeAssetSymbol, snapshot: BrakeKlinesSnapshot | null) => void }) {
  const [snapshots, setSnapshots] = useState<Partial<Record<BrakeAssetSymbol, BrakeKlinesSnapshot>>>({});
  const [selected, setSelected] = useState<BrakeAssetSymbol>("BTCUSDT");

  useEffect(() => {
    if (btcSnapshot) setSnapshots((current) => ({ ...current, BTCUSDT: btcSnapshot }));
  }, [btcSnapshot]);

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

  return <div className="rrAssetTabs" role="tablist" aria-label="Selecionar ativo do Caça-Fundos">
      {BRAKE_ASSETS.map(({ symbol }) => <button type="button" role="tab" key={symbol} aria-selected={selected === symbol} className={selected === symbol ? "active" : ""} onClick={() => { setSelected(symbol); onSelect(symbol, symbol === "BTCUSDT" ? btcSnapshot : snapshots[symbol] ?? null); }}>{symbol.replace("USDT", "")}</button>)}
  </div>;
}
