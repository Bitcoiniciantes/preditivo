"use client";

import { useEffect, useMemo, useState } from "react";
import { completedCandles } from "../lib/analysis";
import { fetchReverseRsiMarket } from "../lib/api";
import { provisionalReverseRsiReading, projectReverseRsi, reverseRsiReading } from "../lib/reverse-rsi";
import type { MarketData } from "../lib/types";

type Category = "stock" | "crypto";
type PanelConfig = { category: Category; initialTicker: string; periods: string[]; targets: number[]; initialTarget: number };
const PANELS: PanelConfig[] = [
  { category: "stock", initialTicker: "NVDA", periods: ["1H", "4H", "1D", "1S"], targets: [10, 16, 20, 25, 30, 40, 50, 60, 70], initialTarget: 25 },
  { category: "crypto", initialTicker: "BTC", periods: ["15M", "1H", "4H", "1D"], targets: [16, 20, 25, 30, 40, 50, 60, 70, 80], initialTarget: 16 },
];
const REFERENCE_LABELS: Record<string, string> = { "15M": "15 min", "1H": "1 hora", "4H": "4 horas", "1D": "diária", "1S": "semanal" };
const REFRESH_MS = 10_000;

function cleanTicker(value: string, category: Category) {
  const ticker = value.trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "");
  return category === "crypto" ? ticker.replace(/USDT$/, "") : ticker;
}
function formatNumber(value: number, digits = 2) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function formatPrice(value: number | null, currency: string) {
  if (value === null) return "Cenário inviável";
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : 10;
  const formatted = value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: digits });
  return `${currency}\u00A0${formatted}`;
}
function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}%`;
}
function ProjectionPanel({ config }: { config: PanelConfig }) {
  const [ticker, setTicker] = useState(config.initialTicker);
  const [query, setQuery] = useState(config.initialTicker);
  const [period, setPeriod] = useState("1D");
  const [target, setTarget] = useState(config.initialTarget);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const currency = "US$";
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    setStatus("loading");
    setMarket(null);
    const load = async (initial: boolean) => {
      if (fetching) return;
      fetching = true;
      try {
        const data = await fetchReverseRsiMarket(ticker, period, config.category, controller.signal);
        if (!controller.signal.aborted) { setMarket(data); setStatus("ready"); }
      } catch {
        if (!controller.signal.aborted && initial) setStatus("unavailable");
      } finally {
        fetching = false;
      }
    };
    void load(true);
    const timer = window.setInterval(() => { void load(false); }, REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [ticker, period, config.category]);
  const closed = useMemo(() => market ? completedCandles(market.candles, period) : [], [market, period]);
  const closedReading = useMemo(() => reverseRsiReading(closed), [closed]);
  const quote = market?.candles.at(-1)?.close ?? null;
  const hasFormingCandle = market !== null && market.candles.length > closed.length;
  const reading = useMemo(() => {
    if (!closedReading) return null;
    return hasFormingCandle && quote !== null && Number.isFinite(quote) && quote > 0
      ? provisionalReverseRsiReading(closedReading, quote)
      : closedReading;
  }, [closedReading, hasFormingCandle, quote]);
  const projections = useMemo(() => reading ? [1, 3, 6].map((candles) => projectReverseRsi(reading, target, candles)) : [], [reading, target]);
  const averageProjection = useMemo(() => {
    if (projections.length !== 3 || projections.some((projection) => projection.price === null)) {
      return { price: null, change: null };
    }
    const price = projections.reduce((sum, projection) => sum + projection.price!, 0) / projections.length;
    const change = quote !== null && quote > 0 ? (price / quote - 1) * 100 : null;
    return { price, change };
  }, [projections, quote]);
  const submit = () => { const next = cleanTicker(query, config.category); if (next) { setTicker(next); setQuery(next); } };
  const unavailable = status === "unavailable" || (status === "ready" && !reading);
  const roundedAverageChange = averageProjection.change === null ? null : Number(averageProjection.change.toFixed(2));
  const averageTrend = roundedAverageChange === null || roundedAverageChange === 0 ? "neutral" : roundedAverageChange > 0 ? "up" : "down";
  const categoryLabel = config.category === "stock" ? "STOCKS" : "CRIPTO";
  const referenceLabel = REFERENCE_LABELS[period] ?? period;
  return <article className={`reverseRsiPanel ${config.category}`} aria-busy={status === "loading"}>
    <div className="reverseRsiControls">
      <span className="reverseRsiCategory">{categoryLabel}</span>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="reverseRsiSearch">
        <label htmlFor={`reverse-rsi-${config.category}`}>BUSCAR ATIVO</label>
        <div><input id={`reverse-rsi-${config.category}`} value={query} onChange={(event) => setQuery(event.target.value)} spellCheck={false} autoCapitalize="characters" /><button type="submit">Analisar</button></div>
      </form>
      <div className="reverseRsiTimeframes" aria-label={`Timeframe ${categoryLabel}`}>{config.periods.map((item) => <button type="button" key={item} className={period === item ? "selected" : ""} onClick={() => setPeriod(item)}>{item === "1S" ? "1W" : item}</button>)}</div>
    </div>
    <div className="reverseRsiTargets"><b>RSI <small>(alvo)</small></b><div>{config.targets.map((item) => <button type="button" key={item} className={target === item ? "selected" : ""} onClick={() => setTarget(item)}>{item}</button>)}</div></div>
    {status === "loading" ? <div className="reverseRsiMessage">Carregando dados…</div> : unavailable ? <div className="reverseRsiMessage">Dados indisponíveis</div> : <>
      <div className="reverseRsiSummary">
        <div className="reverseRsiQuote">
          <span className="reverseRsiLabel">COTAÇÃO ATUAL</span>
          <strong className="reverseRsiQuoteValue">{formatPrice(quote, currency)}</strong>
          <small className="reverseRsiReferenceInline">Ref. {referenceLabel}: {formatPrice(closedReading!.referencePrice, currency)}</small>
          <div className="reverseRsiRsiLine">RSI <strong>{formatNumber(reading!.rsi)}</strong> <span aria-hidden="true">→</span> ALVO <strong>{formatNumber(target)}</strong></div>
        </div>
        <div className={`reverseRsiFeatured ${averageTrend}`}>
          <span className="reverseRsiLabel">PREÇO PROJETADO MÉDIO</span>
          <strong className="reverseRsiFeaturedValue">{formatPrice(averageProjection.price, "$")}</strong>
          <b className="reverseRsiFeaturedChange">{averageTrend !== "neutral" && <span aria-hidden="true">{averageTrend === "up" ? "↑" : "↓"}</span>}{formatPercent(averageProjection.change)}</b>
        </div>
      </div>
    </>}
  </article>;
}
export default function ReverseRsiCard() {
  return <section className="reverseRsiCard" aria-label="RSI Projetado Reverse RSI"><header><span aria-hidden="true">▂▅▇</span><h2>TERMÔMETRO <b>PREDITIVO</b> <em>— RSI PROJETADO (REVERSE RSI)</em></h2></header><div className="reverseRsiPanels">{PANELS.map((config) => <ProjectionPanel key={config.category} config={config} />)}</div><p>Cotação ao vivo • RSI Wilder 14 • Média das projeções de 1, 3 e 6 candles.</p></section>;
}
