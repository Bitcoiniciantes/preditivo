"use client";
// app/RadarMiniChart.tsx — minigráfico de 15M do RADAR DE REVERSÃO.
//
// Componente puramente visual/informativo:
// - usa os candles fechados de 15m já presentes no snapshot do Radar;
// - exibe até 36 candles (9h), com adaptação para 30 em telas estreitas;
// - alterna LINHA/CANDLE sem recarregar e sem alterar os dados;
// - projeta EMA9 sempre e mínimas de 12h/24h quando relevantes;
// - não interfere em sinais, DCA, percentuais ou cálculos do Radar.

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrakeKline } from "../lib/brake-radar";

const WIDE_CANDLES = 48;
const MAX_CANDLES = 36;
const COMPACT_CANDLES = 30;
const WIDE_WIDTH = 430;
const COMPACT_WIDTH = 360;
const VIEW_W = 380;
const VIEW_H = 68;
const PAD_X = 6;
const PAD_Y = 7;
const MIN_VISIBLE_DISTANCE_PCT = 1.5;

type ChartMode = "line" | "candle";
type ChartTone = "up" | "down" | "flat";

type ChartPoint = {
  open: number;
  high: number;
  low: number;
  close: number;
};

function variationTone(value: number): ChartTone {
  const rounded = Math.round(value * 100) / 100;
  if (rounded > 0) return "up";
  if (rounded < 0) return "down";
  return "flat";
}

function formatVariation(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const absolute = Math.abs(rounded).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (rounded > 0) return `+${absolute}%`;
  if (rounded < 0) return `−${absolute}%`;
  return `${absolute}%`;
}

function formatWindow(candles: number): string {
  const minutes = candles * 15;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours}h`;
  return `${hours}h${rest}`;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.floor(Math.log10(Math.abs(value) || 1));
  const digits = Math.max(2, Math.min(8, 2 - magnitude));
  return `US$ ${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function toneColor(tone: ChartTone): string {
  if (tone === "up") return "#10b981";
  if (tone === "down") return "#ef4444";
  return "#8a9892";
}

function trendGlyph(tone: ChartTone): string {
  if (tone === "up") return "↗";
  if (tone === "down") return "↘";
  return "→";
}

function percentGlyph(tone: ChartTone): string {
  if (tone === "up") return "▲";
  if (tone === "down") return "▼";
  return "■";
}

function sanitizeCandles(candles: BrakeKline[]): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const bar of candles) {
    if (
      ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
      || bar.open <= 0
      || bar.high <= 0
      || bar.low <= 0
      || bar.close <= 0
    ) {
      continue;
    }
    out.push({ open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  }
  return out;
}

export function RadarMiniChart({
  candles,
  symbol,
  minimum = null,
  maximum = null,
  ema9 = null,
  state = "ready",
}: {
  candles: BrakeKline[];
  symbol?: string;
  /** Mínima da queda 12h informada pelo Radar (referência horizontal). */
  minimum?: number | null;
  /** Máxima monitorada informada pelo Radar (referência horizontal). */
  maximum?: number | null;
  /** EMA9 de 15m já calculada pelo Radar (referência horizontal). */
  ema9?: number | null;
  state?: "loading" | "ready" | "failed" | "stale";
}) {
  const [mode, setMode] = useState<ChartMode>("line");
  const [limit, setLimit] = useState(MAX_CANDLES);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width >= WIDE_WIDTH) setLimit(WIDE_CANDLES);
      else if (width > 0 && width < COMPACT_WIDTH) setLimit(COMPACT_CANDLES);
      else setLimit(MAX_CANDLES);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const allPoints = useMemo(() => sanitizeCandles(candles), [candles]);
  const points = useMemo(() => allPoints.slice(-limit), [allPoints, limit]);
  const available = points.length >= 12;

  // Mínima 24h calculada a partir dos candles fechados de 15m já carregados.
  const minimum24h = useMemo(() => {
    const window24h = allPoints.slice(-96);
    if (window24h.length === 0) return null;
    let min = Infinity;
    for (const p of window24h) if (p.low < min) min = p.low;
    return Number.isFinite(min) && min > 0 ? min : null;
  }, [allPoints]);

  const variation = useMemo(() => {
    if (!available) return null;
    const first = points[0].close;
    const last = points[points.length - 1].close;
    if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return null;
    return (last / first - 1) * 100;
  }, [available, points]);

  const tone = variation !== null ? variationTone(variation) : "flat";
  const color = toneColor(tone);

  const geometry = useMemo(() => {
    if (!available) return null;
    const lastClose = points[points.length - 1].close;
    const emaValid = ema9 !== null && Number.isFinite(ema9) && ema9 > 0;
    const min12Valid = minimum !== null && Number.isFinite(minimum) && minimum > 0;
    const maxValid = maximum !== null && Number.isFinite(maximum) && maximum > 0;
    const min24Valid = !maxValid && minimum24h !== null && Number.isFinite(minimum24h) && minimum24h > 0;
    const sameMin = min12Valid && min24Valid && Math.abs(minimum - minimum24h) <= Math.max(minimum, minimum24h) * 0.00001;

    const min12DistancePct = min12Valid && lastClose > 0 ? ((minimum - lastClose) / lastClose) * 100 : null;
    const maxDistancePct = maxValid && lastClose > 0 ? ((maximum - lastClose) / lastClose) * 100 : null;
    const min24DistancePct = min24Valid && lastClose > 0 ? ((minimum24h - lastClose) / lastClose) * 100 : null;
    const min12Near = min12DistancePct !== null && Math.abs(min12DistancePct) <= MIN_VISIBLE_DISTANCE_PCT;
    const maxNear = maxDistancePct !== null && Math.abs(maxDistancePct) <= MIN_VISIBLE_DISTANCE_PCT;

    // Escala por percentis 3/97 dos preços da janela (high/low), + EMA9, com margem ~8%.
    // Faixa mínima: 0,6% do preço para evitar zoom excessivo em microvariações.
    const scaleValues: number[] = [];
    for (const p of points) scaleValues.push(p.high, p.low);
    const p3 = percentile(scaleValues, 0.03);
    const p97 = percentile(scaleValues, 0.97);
    let min = p3;
    let max = p97;
    if (emaValid) {
      min = Math.min(min, ema9);
      max = Math.max(max, ema9);
    }
    if (!(max > min)) {
      const mid = (max + min) / 2 || lastClose || 1;
      const pad = Math.max(Math.abs(mid) * 0.003, 1e-8);
      min = mid - pad;
      max = mid + pad;
    }
    const baseSpan = max - min;
    const margin = baseSpan * 0.08;
    min -= margin;
    max += margin;
    const minSpan = Math.max(Math.abs(lastClose), 1) * 0.006;
    if ((max - min) < minSpan) {
      const mid = (max + min) / 2;
      min = mid - minSpan / 2;
      max = mid + minSpan / 2;
    }

    const showMin12Line = min12Valid && ((minimum >= min && minimum <= max) || min12Near);
    const showMaxLine = maxValid && ((maximum >= min && maximum <= max) || maxNear);
    const showMin24Line = min24Valid && !sameMin && (minimum24h >= min && minimum24h <= max);

    const span = max - min || 1;
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const yRaw = (value: number) => PAD_Y + ((max - value) / span) * innerH;
    const clampY = (value: number) => Math.max(PAD_Y, Math.min(PAD_Y + innerH, value));
    const y = (value: number) => clampY(yRaw(value));
    const step = innerW / points.length;
    const candleW = Math.max(1.8, step * 0.58);

    const bars = points.map((p, index) => {
      const cx = PAD_X + (index + 0.5) * step;
      const clipTop = p.high > max;
      const clipBottom = p.low < min;
      const clipCloseTop = p.close > max;
      const clipCloseBottom = p.close < min;
      return {
        key: index,
        cx,
        openY: y(p.open),
        closeY: y(p.close),
        highY: y(p.high),
        lowY: y(p.low),
        clipTop,
        clipBottom,
        clipCloseTop,
        clipCloseBottom,
        up: p.close >= p.open,
        last: index === points.length - 1,
      };
    });

    const linePoints = bars.map((b) => `${b.cx.toFixed(2)},${b.closeY.toFixed(2)}`).join(" ");

    return {
      linePoints,
      bars,
      lastBar: bars[bars.length - 1],
      candleW,
      min12Y: showMin12Line ? y(minimum) : null,
      maxY: showMaxLine ? y(maximum) : null,
      min24Y: showMin24Line ? y(minimum24h) : null,
      emaY: emaValid ? y(ema9) : null,
      min12DistancePct,
      maxDistancePct,
      min24DistancePct,
      showMin12Line,
      showMaxLine,
      showMin24Line,
      sameMin,
      min24Value: min24Valid ? minimum24h : null,
      maxValue: maxValid ? maximum : null,
    };
  }, [available, points, minimum, maximum, minimum24h, ema9]);

  const windowText = formatWindow(available ? points.length : limit);

  const minQuedaLabel = useMemo(() => {
    if (minimum === null || !Number.isFinite(minimum) || minimum <= 0) return null;
    return `Mín. queda ${formatUsd(minimum)}`;
  }, [minimum]);

  const maxRefLabel = useMemo(() => {
    if (maximum === null || !Number.isFinite(maximum) || maximum <= 0) return null;
    return `Máx. monitorada ${formatUsd(maximum)}`;
  }, [maximum]);

  const ema9Label = useMemo(() => {
    if (ema9 === null || !Number.isFinite(ema9) || ema9 <= 0) return null;
    return `EMA9 ${formatUsd(ema9)}`;
  }, [ema9]);

  const hasChart = available && variation !== null;
  const label = hasChart
    ? `Minigráfico 15M de ${symbol ?? "ativo"}: ${points.length} candles fechados (${windowText}), variação de ${formatVariation(variation)} em ${windowText}.`
    : `Gráfico de 15M indisponível para ${symbol ?? "ativo"}.`;

  return (
    <div className="brMiniChart" ref={rootRef} aria-label={label}>
      <div className="brMiniHead">
        <div className="brMiniHeadLeft">
          <span className="brMiniTf">
            15M <em>· {windowText.toUpperCase()}</em>
          </span>
          <span className="brMiniLastHead" title="Último candle de 15M fechado">últ. fech. 15M</span>
        </div>
        <div className="brMiniModes" role="group" aria-label="Visualização do minigráfico de 15M">
          <button type="button" className="brMiniModeBtn" aria-pressed={mode === "line"} onClick={() => setMode("line")}>LINHA</button>
          <span className="brMiniModeDivider" aria-hidden="true" />
          <button type="button" className="brMiniModeBtn" aria-pressed={mode === "candle"} onClick={() => setMode("candle")}>CANDLE</button>
        </div>
      </div>

      {hasChart && geometry ? (
        <>
          <div className="brMiniBody">
            <span className={`brMiniChange brMini-${tone}`}>
              <span className="brMiniChangeMain">
                <i aria-hidden="true">{percentGlyph(tone)}</i>
                {formatVariation(variation)}
              </span>
              <span className="brMiniChangeWindow">· {windowText}</span>
            </span>
            <svg
              className="brMiniSvg"
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Gráfico de ${mode === "line" ? "linha" : "candles"} dos últimos ${points.length} candles de 15 minutos`}
            >
              {geometry.min24Y !== null && (
                <line x1={PAD_X} x2={VIEW_W - PAD_X} y1={geometry.min24Y} y2={geometry.min24Y} stroke="#ef4444" strokeWidth={0.7} opacity={0.32} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
              )}
              {geometry.min12Y !== null && (
                <line x1={PAD_X} x2={VIEW_W - PAD_X} y1={geometry.min12Y} y2={geometry.min12Y} stroke="#ef4444" strokeWidth={0.8} opacity={0.55} vectorEffect="non-scaling-stroke" />
              )}
              {geometry.maxY !== null && (
                <line x1={PAD_X} x2={VIEW_W - PAD_X} y1={geometry.maxY} y2={geometry.maxY} stroke="#ef4444" strokeWidth={0.8} opacity={0.55} vectorEffect="non-scaling-stroke" />
              )}
              {geometry.emaY !== null && (
                <line x1={PAD_X} x2={VIEW_W - PAD_X} y1={geometry.emaY} y2={geometry.emaY} stroke="#f5c542" strokeWidth={0.7} opacity={0.45} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
              )}
              {mode === "line" ? (
                <>
                  <polyline points={geometry.linePoints} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  {geometry.bars.map((bar) => (bar.clipCloseTop || bar.clipCloseBottom) ? (
                    <polygon
                      key={`clip-${bar.key}`}
                      points={bar.clipCloseTop
                        ? `${bar.cx - 2.5},${PAD_Y + 3.5} ${bar.cx + 2.5},${PAD_Y + 3.5} ${bar.cx},${PAD_Y}`
                        : `${bar.cx - 2.5},${VIEW_H - PAD_Y - 3.5} ${bar.cx + 2.5},${VIEW_H - PAD_Y - 3.5} ${bar.cx},${VIEW_H - PAD_Y}`}
                      fill={color}
                      opacity={0.75}
                    />
                  ) : null)}
                  {geometry.lastBar && !geometry.lastBar.clipCloseTop && !geometry.lastBar.clipCloseBottom && (
                    <>
                      <circle cx={geometry.lastBar.cx} cy={geometry.lastBar.closeY} r={5} fill={color} opacity={0.18} />
                      <circle cx={geometry.lastBar.cx} cy={geometry.lastBar.closeY} r={2.4} fill={color} stroke="#0a110f" strokeWidth={1} />
                    </>
                  )}
                </>
              ) : (
                geometry.bars.map((bar) => (
                  <g key={bar.key}>
                    {bar.last && <rect x={bar.cx - geometry.candleW / 2 - 1.4} y={PAD_Y} width={geometry.candleW + 2.8} height={VIEW_H - PAD_Y * 2} fill="#ffffff" opacity={0.06} rx={1} />}
                    <line x1={bar.cx} x2={bar.cx} y1={bar.highY} y2={bar.lowY} stroke={bar.up ? "#10b981" : "#ef4444"} strokeWidth={bar.last ? 1.4 : 1} vectorEffect="non-scaling-stroke" />
                    <rect x={bar.cx - geometry.candleW / 2} y={Math.min(bar.openY, bar.closeY)} width={geometry.candleW} height={Math.max(Math.abs(bar.closeY - bar.openY), 1.2)} fill={bar.up ? "#10b981" : "#ef4444"} stroke={bar.last ? "#dbe5e0" : "none"} strokeWidth={bar.last ? 0.8 : 0} rx={0.6} />
                    {bar.clipTop && <polygon points={`${bar.cx - 2.5},${PAD_Y + 3.5} ${bar.cx + 2.5},${PAD_Y + 3.5} ${bar.cx},${PAD_Y}`} fill={bar.up ? "#10b981" : "#ef4444"} opacity={0.75} />}
                    {bar.clipBottom && <polygon points={`${bar.cx - 2.5},${VIEW_H - PAD_Y - 3.5} ${bar.cx + 2.5},${VIEW_H - PAD_Y - 3.5} ${bar.cx},${VIEW_H - PAD_Y}`} fill={bar.up ? "#10b981" : "#ef4444"} opacity={0.75} />}
                  </g>
                ))
              )}
            </svg>
            <span className={`brMiniTrend brMini-${tone}`} aria-hidden="true">{trendGlyph(tone)}</span>
          </div>
          {state === "stale" && <small className="brMiniStale">desatualizado</small>}
          <div className="brMiniFoot">
            <span className="brMiniLegend" aria-hidden="true">
              {minQuedaLabel && (
                <span className={`brMiniLegendItem ${geometry.showMin12Line || geometry.sameMin ? "brMiniLegendMin" : "brMiniLegendMinAway"}`}>
                  {(geometry.showMin12Line || geometry.sameMin) && <i />}
                  <span className="brMiniLegendLabel">Mín. queda</span>
                  <span className="brMiniLegendValue">
                    {geometry.showMin12Line || geometry.sameMin
                      ? formatUsd(minimum as number)
                      : (() => {
                          const pct = geometry.min12DistancePct;
                          if (pct === null || !Number.isFinite(pct)) return formatUsd(minimum as number);
                          const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
                          const abs = Math.abs(pct).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                          const arrow = pct < 0 ? "↓" : pct > 0 ? "↑" : "•";
                          return `${sign}${abs}% ${arrow}`;
                        })()}
                  </span>
                </span>
              )}
              {maxRefLabel && (
                <span className={`brMiniLegendItem ${geometry.showMaxLine ? "brMiniLegendMin" : "brMiniLegendMinAway"}`}>
                  {geometry.showMaxLine && <i />}
                  <span className="brMiniLegendLabel">Máx. monitorada</span>
                  <span className="brMiniLegendValue">
                    {geometry.showMaxLine
                      ? formatUsd(maximum as number)
                      : (() => {
                          const pct = geometry.maxDistancePct;
                          if (pct === null || !Number.isFinite(pct)) return formatUsd(maximum as number);
                          const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
                          const abs = Math.abs(pct).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                          const arrow = pct < 0 ? "↓" : pct > 0 ? "↑" : "•";
                          return `${sign}${abs}% ${arrow}`;
                        })()}
                  </span>
                </span>
              )}
              {ema9Label && (
                <span className="brMiniLegendItem brMiniLegendEma">
                  <i />
                  <span className="brMiniLegendLabel">EMA9</span>
                  <span className="brMiniLegendValue">{formatUsd(ema9 as number)}</span>
                </span>
              )}
            </span>
            <span className="brMiniLast brMiniLastFoot" title="Último candle de 15M fechado">últ. fech. 15M</span>
          </div>
        </>
      ) : (
        <div className="brMiniUnavailable" aria-live="polite">{state === "loading" ? "Carregando gráfico…" : "Gráfico indisponível"}</div>
      )}
    </div>
  );
}

export default RadarMiniChart;
