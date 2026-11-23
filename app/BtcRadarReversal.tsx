"use client";
// app/BtcRadarReversal.tsx — BITCOIN · RADAR DE REVERSÃO.
//
// Abas exclusivas do Termômetro Preditivo:
// - CAÇA-FUNDOS: mantém integralmente o Radar de Freio da Queda existente;
// - CAÇA-TOPOS: novo Radar de Exaustão de Alta (lib/top-radar.ts).
//
// A aquisição de candles é compartilhada: um único fetch de 1h + 15m alimenta
// as duas abas. Nenhum endpoint novo é usado e nenhuma ordem é executada.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BRAKE_ASSETS,
  BRAKE_EXTRA_STORAGE_KEY,
  BRAKE_MAX_EXTRA_ASSETS,
  brakeAssetName,
  fetchBrakeKlines,
  fetchBrakeSpotQuote,
  isValidBrakeRadarSymbol,
  type BrakeKlinesSnapshot,
  type BrakeSpotQuote,
} from "../lib/brake-radar";
import { BtcBrakeRadar } from "./BtcBrakeRadar";
import { BtcTopRadar } from "./BtcTopRadar";
import { MultiAssetFundMonitor } from "./MultiAssetFundMonitor";

const REFRESH_MS = 60_000;

type RadarTab = "fundos" | "topos";
type RadarMode = "fast" | "conservative";
type RemoteState = "loading" | "ready" | "failed" | "stale";

function readExtraSymbols(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BRAKE_EXTRA_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const base = new Set<string>(BRAKE_ASSETS.map((a) => a.symbol));
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const symbol = item.toUpperCase();
      if (!isValidBrakeRadarSymbol(symbol) || base.has(symbol) || out.includes(symbol)) continue;
      out.push(symbol);
      if (out.length >= BRAKE_MAX_EXTRA_ASSETS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function BtcRadarReversal({
  livePrice = null,
  dailyChangePct = null,
}: {
  livePrice?: number | null;
  dailyChangePct?: number | null;
}) {
  // A página sempre abre no Caça-Fundos, preservando a leitura principal.
  const [tab, setTab] = useState<RadarTab>("fundos");
  const [mode, setMode] = useState<RadarMode>("conservative");
  const [snapshot, setSnapshot] = useState<BrakeKlinesSnapshot | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("BTCUSDT");
  const [selectedSnapshot, setSelectedSnapshot] = useState<BrakeKlinesSnapshot | null>(null);
  const [quote, setQuote] = useState<BrakeSpotQuote | null>(null);
  const [quoteState, setQuoteState] = useState<RemoteState>("loading");
  const [quoteUpdatedAt, setQuoteUpdatedAt] = useState<number | null>(null);
  const [snapshotState, setSnapshotState] = useState<RemoteState>("loading");
  const snapshotRef = useRef<BrakeKlinesSnapshot | null>(null);
  const quoteRef = useRef<BrakeSpotQuote | null>(null);
  const [now, setNow] = useState(0);
  const [extraSymbols, setExtraSymbols] = useState<string[]>([]);

  useEffect(() => {
    setExtraSymbols(readExtraSymbols());
  }, []);

  const handleAddExtra = useCallback((symbol: string) => {
    setExtraSymbols((current) => {
      if (current.includes(symbol) || BRAKE_ASSETS.some((a) => a.symbol === symbol)) return current;
      if (current.length >= BRAKE_MAX_EXTRA_ASSETS) return current;
      const next = [...current, symbol];
      try { window.localStorage.setItem(BRAKE_EXTRA_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const handleRemoveExtra = useCallback((symbol: string) => {
    if (BRAKE_ASSETS.some((a) => a.symbol === symbol)) return;
    setExtraSymbols((current) => {
      if (!current.includes(symbol)) return current;
      const next = current.filter((s) => s !== symbol);
      try { window.localStorage.setItem(BRAKE_EXTRA_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const handleAssetSelect = useCallback((symbol: string, nextSnapshot: BrakeKlinesSnapshot | null) => {
    setSelectedSymbol(symbol);
    setSelectedSnapshot(nextSnapshot);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (snapshot && selectedSymbol === "BTCUSDT") setSelectedSnapshot(snapshot);
  }, [snapshot, selectedSymbol]);

  const selectedAssetName = brakeAssetName(selectedSymbol);

  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();

    const load = async () => {
      if (running) return;
      running = true;
      try {
        const next = await fetchBrakeKlines(controller.signal);
        if (active) {
          snapshotRef.current = next;
          setSnapshot(next);
          setSnapshotState("ready");
        }
      } catch (error) {
        // Mantém a última leitura válida. O analisador bloqueia sinais quando
        // os dados envelhecem além de 2 minutos.
        if ((error as Error)?.name !== "AbortError" && active) {
          setSnapshotState(snapshotRef.current ? "stale" : "failed");
        }
      } finally {
        running = false;
      }
    };

    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  // Cotação spot exclusiva do ativo selecionado: uma chamada ao ticker público
  // do próprio par. O BTC, quando a página já mantém o stream ao vivo, usa esse
  // valor mais recente por cima; jamais reaproveita a cotação de outro ticker.
  useEffect(() => {
    setQuote(null);
    quoteRef.current = null;
    setQuoteState("loading");
    setQuoteUpdatedAt(null);
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const next = await fetchBrakeSpotQuote(selectedSymbol, controller.signal);
        if (active) {
          quoteRef.current = next;
          setQuote(next);
          if (next.price !== null && Number.isFinite(next.price) && next.price > 0) {
            setQuoteState("ready");
            setQuoteUpdatedAt(Date.now());
          } else {
            setQuoteState("failed");
          }
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError" && active) {
          const previous = quoteRef.current;
          setQuoteState(previous?.symbol === selectedSymbol && previous.price !== null && previous.price > 0 ? "stale" : "failed");
        }
      } finally {
        running = false;
      }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [selectedSymbol]);

  const selectedQuote = quote?.symbol === selectedSymbol ? quote : null;
  const parentLivePrice = selectedSymbol === "BTCUSDT" && livePrice !== null && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : null;
  const parentDailyChange = selectedSymbol === "BTCUSDT" && dailyChangePct !== null && Number.isFinite(dailyChangePct)
    ? dailyChangePct
    : null;
  const quotePrice = parentLivePrice ?? selectedQuote?.price ?? null;
  const quoteChangePct = parentDailyChange ?? selectedQuote?.changePct24h ?? null;
  const effectiveQuoteState: RemoteState = parentLivePrice !== null ? "ready" : quoteState;
  const effectiveChartState: RemoteState = selectedSymbol === "BTCUSDT"
    ? snapshotState
    : selectedSnapshot ? "ready" : snapshotState;

  return (
    <section className="radarReversal" id="radar-reversao" aria-label="Bitcoin — Radar de Reversão">
      <div className="rrShell">
        <div className="rrHead">
          <div className="rrHeadMain">
            <span className="rrKicker">CANDLES FECHADOS</span>
            <h3 className="rrTitle">RADAR DE REVERSÃO</h3>
          </div>
          <span className="rrSource">BINANCE SPOT · 15M + 1H</span>
        </div>

        <div className="rrTabs" role="tablist" aria-label="Radar de reversão">
          <button
            type="button"
            role="tab"
            id="rr-tab-fundos"
            aria-controls="rr-panel-fundos"
            aria-selected={tab === "fundos"}
            tabIndex={tab === "fundos" ? 0 : -1}
            className="rrTab"
            onClick={() => setTab("fundos")}
          >
            CAÇA-FUNDOS
          </button>
          <button
            type="button"
            role="tab"
            id="rr-tab-topos"
            aria-controls="rr-panel-topos"
            aria-selected={tab === "topos"}
            tabIndex={tab === "topos" ? 0 : -1}
            className="rrTab"
            onClick={() => setTab("topos")}
          >
            CAÇA-TOPOS
          </button>
          <button type="button" className={`rrModeTab ${mode === "fast" ? "active" : ""}`} onClick={() => setMode("fast")}>RÁPIDO</button>
          <button type="button" className={`rrModeTab ${mode === "conservative" ? "active" : ""}`} onClick={() => setMode("conservative")}>CONSERVADOR</button>
        </div>
        <MultiAssetFundMonitor
          btcSnapshot={snapshot}
          now={now}
          radar={tab}
          extraSymbols={extraSymbols}
          onSelect={handleAssetSelect}
          onAddExtra={handleAddExtra}
          onRemoveExtra={handleRemoveExtra}
        />
      </div>

      <div
        className="rrPanel"
        id="rr-panel-fundos"
        role="tabpanel"
        aria-labelledby="rr-tab-fundos"
        hidden={tab !== "fundos"}
      >
        <BtcBrakeRadar
          symbol={selectedSymbol}
          assetName={selectedAssetName}
          snapshot={selectedSnapshot}
          now={now}
          livePrice={quotePrice}
          dailyChangePct={quoteChangePct}
          quoteState={effectiveQuoteState}
          quoteUpdatedAt={quoteUpdatedAt}
          chartState={effectiveChartState}
          mode={mode}
        />
      </div>

      <div
        className="rrPanel"
        id="rr-panel-topos"
        role="tabpanel"
        aria-labelledby="rr-tab-topos"
        hidden={tab !== "topos"}
      >
        <BtcTopRadar
          symbol={selectedSymbol}
          assetName={selectedAssetName}
          snapshot={selectedSnapshot}
          now={now}
          livePrice={quotePrice}
          dailyChangePct={quoteChangePct}
          quoteState={effectiveQuoteState}
          quoteUpdatedAt={quoteUpdatedAt}
          chartState={effectiveChartState}
        />
      </div>
    </section>
  );
}

export default BtcRadarReversal;
