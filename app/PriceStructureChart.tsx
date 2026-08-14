"use client";

import { useMemo, useState } from "react";
import { buildPriceGeometry } from "../lib/chart";
import type { Candle } from "../lib/types";

type Props = {
  asset: string;
  candles: Candle[];
  currentPrice: number;
  currency: string;
  loading: boolean;
  period: string;
  resistance: number;
  support: number;
};

function formatPriceNumber(value: number) {
  const maximumFractionDigits = value >= 1 ? 2 : 6;
  return value.toLocaleString("pt-BR", { maximumFractionDigits });
}

function formatPrice(value: number, currency: string) {
  return `${currency} ${formatPriceNumber(value)}`;
}

function formatDate(time: number, period: string) {
  const options: Intl.DateTimeFormatOptions = period === "1H" || period === "4H"
    ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "2-digit" };
  return new Date(time).toLocaleString("pt-BR", { ...options, timeZone: "America/Sao_Paulo" });
}

export default function PriceStructureChart({ asset, candles, currentPrice, currency, loading, period, resistance, support }: Props) {
  const geometry = useMemo(() => buildPriceGeometry(candles, 48), [candles]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!geometry) {
    return <div className="priceChart priceChartEmpty" aria-busy={loading}>
      <span>{loading ? "Carregando candles reais…" : "Histórico insuficiente para desenhar o gráfico"}</span>
    </div>;
  }

  const selectedIndex = Math.min(hoveredIndex ?? geometry.candles.length - 1, geometry.candles.length - 1);
  const selected = geometry.candles[selectedIndex];
  const first = geometry.candles[0];
  const middle = geometry.candles[Math.floor(geometry.candles.length / 2)];
  const last = geometry.candles.at(-1)!;
  const selectedTone = selected.direction === "up" ? "up" : "down";
  const level = (value: number) => `${geometry.scale(value)}%`;

  return <div className="priceChart realPriceChart">
    <div className="chartIdentity" aria-hidden="true"><b>{asset}</b><span>{period} · OHLC REAL</span></div>
    <div className={`chartOhlc ${selectedTone}`} aria-live="polite">
      <span>{formatDate(selected.time, period)}</span>
      <dl>
        <div><dt>A</dt><dd>{formatPrice(selected.open, currency)}</dd></div>
        <div><dt>Máx</dt><dd>{formatPrice(selected.high, currency)}</dd></div>
        <div><dt>Mín</dt><dd>{formatPrice(selected.low, currency)}</dd></div>
        <div><dt>F</dt><dd>{formatPrice(selected.close, currency)}</dd></div>
      </dl>
    </div>
    <div className="chartAxis" aria-hidden="true">
      <span>{formatPrice(geometry.max, currency)}</span>
      <span>{formatPrice(geometry.mid, currency)}</span>
      <span>{formatPrice(geometry.min, currency)}</span>
    </div>
    <div className="candlePlot" onMouseLeave={() => setHoveredIndex(null)}>
      {resistance > 0 && <div className="priceLevel resistanceLevel" style={{ top: level(resistance) }}><span>Resistência</span></div>}
      {support > 0 && <div className="priceLevel supportLevel" style={{ top: level(support) }}><span>Suporte</span></div>}
      {currentPrice > 0 && <div className="priceLevel currentPriceLevel" style={{ top: level(currentPrice) }}><span>{formatPriceNumber(currentPrice)}</span></div>}
      {geometry.candles.map((candle, index) => <button
        type="button"
        key={`${candle.time}-${index}`}
        className={`realCandle ${candle.direction} ${index === geometry.candles.length - 1 ? "forming" : ""}`}
        style={{ left: `${index / geometry.candles.length * 100}%`, width: `${100 / geometry.candles.length}%` }}
        onMouseEnter={() => setHoveredIndex(index)}
        onFocus={() => setHoveredIndex(index)}
        onBlur={() => setHoveredIndex(null)}
        aria-label={`${formatDate(candle.time, period)}: abertura ${formatPrice(candle.open, currency)}, máxima ${formatPrice(candle.high, currency)}, mínima ${formatPrice(candle.low, currency)}, fechamento ${formatPrice(candle.close, currency)}`}
      >
        <i className="candleWick" style={{ top: `${candle.wickTop}%`, height: `${candle.wickHeight}%` }}/>
        <b className="candleBody" style={{ top: `${candle.bodyTop}%`, height: `${candle.bodyHeight}%` }}/>
      </button>)}
    </div>
    <div className="chartDates" aria-hidden="true"><span>{formatDate(first.time, period)}</span><span>{formatDate(middle.time, period)}</span><span>{formatDate(last.time, period)}</span></div>
  </div>;
}