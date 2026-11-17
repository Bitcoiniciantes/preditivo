"use client";
// app/painelcolorido/PainelColoridoChart.tsx — candlestick BTCUSDT em tempo real.
// Histórico: klines públicas Binance (lib/painelcolorido-klines.ts), 6 timeframes.
// Tempo real: preço do stream interno (props) atualiza o candle em formação;
// ressincronia de klines a cada 30 s (fecha candles + atualiza volume).
// Exibe: candles, volume (toggle), MAs 50/200 (toggle) com marcadores de
// cruzamento golden/death cross (GC/DC) — leitura técnica direta, uso pessoal.
// Mantido proibido aqui: marcadores de entrada/saída, padrões de candle,
// S/R automáticas, RSI/MACD/Bollinger. Nada disso existe neste arquivo.

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPaneApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { PC_TFS, PC_TF_MS, fetchPcKlines, sma, rsi, type PcBar, type PcTf, type PcSource } from "../../lib/painelcolorido-klines";

const UP = "#2ee86b";
const DOWN = "#e5484d";
const MA50 = "#e8a33d";
const MA200 = "#ff2222";
const RSI_LINE = "#a78bfa";
const RSI_REF = "#5b6472";
const RESYNC_MS = 30_000;

function toCandle(b: PcBar) {
  return { time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c };
}
function volColor(b: PcBar) {
  return b.c >= b.o ? "rgba(46,232,107,0.45)" : "rgba(229,72,77,0.45)";
}

function maPoints(bars: PcBar[], vals: (number | null)[]) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = vals[i];
    if (v !== null && Number.isFinite(v)) out.push({ time: bars[i].t as UTCTimestamp, value: v });
  }
  return out;
}

// Cruzamentos MA50 × MA200 sobre fechamentos (golden/death cross) — leitura
// técnica direta para uso pessoal; recalculado sobre dados carregados.
type PcMark = { time: UTCTimestamp; position: "aboveBar" | "belowBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string };
function crossMarkers(bars: PcBar[], m50: (number | null)[], m200: (number | null)[]): PcMark[] {
  const out: PcMark[] = [];
  for (let i = 1; i < bars.length; i++) {
    const p50 = m50[i - 1], p200 = m200[i - 1], c50 = m50[i], c200 = m200[i];
    if (p50 === null || p200 === null || c50 === null || c200 === null) continue;
    if (p50 <= p200 && c50 > c200) out.push({ time: bars[i].t as UTCTimestamp, position: "belowBar", color: UP, shape: "arrowUp", text: "GC" });
    else if (p50 >= p200 && c50 < c200) out.push({ time: bars[i].t as UTCTimestamp, position: "aboveBar", color: DOWN, shape: "arrowDown", text: "DC" });
  }
  return out;
}

export function PainelColoridoChart({ price, priceTs, tf, onTfChange }: { price: number | null; priceTs: number | null; tf: PcTf; onTfChange: (tf: PcTf) => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<{ setMarkers: (markers: PcMark[]) => void } | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiPaneRef = useRef<IPaneApi<Time> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const barsRef = useRef<PcBar[]>([]);
  const [showMA, setShowMA] = useState(true);
  const [showVol, setShowVol] = useState(false);
  const [showRSI, setShowRSI] = useState(true);
  const [estado, setEstado] = useState<"loading" | "live" | "error">("loading");
  const [fonte, setFonte] = useState<PcSource>("futures");
  const [retry, setRetry] = useState(0);
  const showMARef = useRef(showMA);
  const showVolRef = useRef(showVol);
  const showRSIRef = useRef(showRSI);
  showMARef.current = showMA;
  showVolRef.current = showVol;
  showRSIRef.current = showRSI;

  // Cria o gráfico uma vez; recria ao trocar de timeframe.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let dead = false;
    const ctrl = new AbortController();

    // Largura travada no viewport: impede que uma leitura transitória durante o
    // load fixe o canvas gigante e estoure a grade (feedback ResizeObserver).
    const boxW = () => Math.max(50, Math.min(el.clientWidth || 0, window.innerWidth - 32));
    const chart = createChart(el, {
      layout: {
        background: { color: "transparent" },
        textColor: "#8fa3bd",
        fontSize: 11,
        attributionLogo: false,
        panes: {
          enableResize: false,
          separatorColor: "#2a3d58",
          separatorHoverColor: "rgba(42,61,88,0.35)",
        },
      },
      grid: { vertLines: { color: "rgba(27,42,63,0.6)" }, horzLines: { color: "rgba(27,42,63,0.6)" } },
      rightPriceScale: { borderColor: "#2a3d58" },
      timeScale: { borderColor: "#2a3d58", timeVisible: true },
      crosshair: {
        vertLine: { color: "#2a3d58", labelBackgroundColor: "#2a3d58" },
        horzLine: {
          color: "#2a3d58",
          labelBackgroundColor: "#2a3d58",
          style: LineStyle.Dotted,
          visible: true,
          labelVisible: true,
        },
      },
      width: boxW(),
      height: 300,
    });
    chartRef.current = chart;
    const mainPane = chart.panes()[0];
    mainPane.setStretchFactor(4);
    const candles = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false });
    mainPane.priceScale("right").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.45 } });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    mainPane.priceScale("").applyOptions({ scaleMargins: { top: 0.6, bottom: 0.22 } });
    // Painel dedicado ao RSI: garante régua direita visível e crosshair nativo
    // independentes, sem tooltip customizada ou sincronização manual.
    const rsiPane = chart.addPane(true);
    rsiPane.setStretchFactor(1);
    rsiPaneRef.current = rsiPane;
    const rsiSeries = rsiPane.addSeries(LineSeries, { color: RSI_LINE, lineWidth: 1, priceScaleId: "right", priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true });
    rsiPane.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 }, borderColor: "#2a3d58" });
    rsiSeries.createPriceLine({ price: 70, color: RSI_REF, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
    rsiSeries.createPriceLine({ price: 30, color: RSI_REF, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
    rsiSeries.applyOptions({ visible: false });
    const ma50 = chart.addSeries(LineSeries, { color: MA50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ma200 = chart.addSeries(LineSeries, { color: MA200, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    candleRef.current = candles;
    rsiRef.current = rsiSeries;
    markersRef.current = createSeriesMarkers(candles, []);
    volRef.current = vol;
    ma50Ref.current = ma50;
    ma200Ref.current = ma200;

    const ro = new ResizeObserver(() => {
      if (!boxRef.current) return;
      chart.applyOptions({ width: boxW(), height: 300 });
    });
    ro.observe(el);

    const applyAll = (bars: PcBar[]) => {
      barsRef.current = bars;
      candles.setData(bars.map(toCandle));
      if (showVolRef.current) vol.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: volColor(b) })));
      else vol.setData([]);
      const closes = bars.map((b) => b.c);
      const m50 = sma(closes, 50), m200 = sma(closes, 200);
      ma50.setData(showMARef.current ? maPoints(bars, m50) : []);
      ma200.setData(showMARef.current ? maPoints(bars, m200) : []);
      markersRef.current?.setMarkers(showMARef.current ? crossMarkers(bars, m50, m200) : []);
      rsiSeries.setData(showRSIRef.current ? maPoints(bars, rsi(closes, 14)) : []);
      rsiSeries.applyOptions({ visible: showRSIRef.current });
      chart.timeScale().scrollToRealTime();
    };

    setEstado("loading");
    fetchPcKlines(tf, ctrl.signal)
      .then(({ bars, source }) => { if (!dead) { applyAll(bars); setFonte(source); setEstado("live"); } })
      .catch(() => { if (!dead) setEstado("error"); });
    const resync = window.setInterval(() => {
      fetchPcKlines(tf, ctrl.signal).then(({ bars, source }) => { if (!dead) { applyAll(bars); setFonte(source); setEstado("live"); } }).catch(() => {});
    }, RESYNC_MS);

    return () => {
      dead = true;
      ctrl.abort();
      window.clearInterval(resync);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      rsiPaneRef.current = null;
    };
  }, [tf, retry]);

  // Toggles reaplicam overlays sobre os dados já carregados (sem refetch).
  useEffect(() => {
    const bars = barsRef.current;
    if (!bars.length || estado !== "live") return;
    const closes = bars.map((b) => b.c);
    const m50 = sma(closes, 50), m200 = sma(closes, 200);
    ma50Ref.current?.setData(showMA ? maPoints(bars, m50) : []);
    ma200Ref.current?.setData(showMA ? maPoints(bars, m200) : []);
    if (markersRef.current) markersRef.current.setMarkers(showMA ? crossMarkers(bars, m50, m200) : []);
    rsiRef.current?.setData(showRSI ? maPoints(bars, rsi(closes, 14)) : []);
    rsiRef.current?.applyOptions({ visible: showRSI });
    volRef.current?.setData(showVol ? bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: volColor(b) })) : []);
  }, [showMA, showVol, showRSI, estado]);

  // Tick do stream interno atualiza o candle em formação (sem recriar nada).
  useEffect(() => {
    if (estado !== "live" || price === null || priceTs === null) return;
    const bars = barsRef.current;
    if (!bars.length) return;
    const bucketMs = PC_TF_MS[tf];
    const bucket = Math.floor(priceTs / bucketMs) * bucketMs;
    const last = bars[bars.length - 1];
    const lastBucket = last.t * 1000;
    if (bucket > lastBucket) {
      const nb: PcBar = { t: Math.floor(bucket / 1000), o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 };
      bars.push(nb);
      if (bars.length > 400) bars.shift();
      candleRef.current?.update(toCandle(nb));
      volRef.current?.update({ time: nb.t as UTCTimestamp, value: 0, color: volColor(nb) });
      // MAs ganham um ponto novo (linhas de contexto).
      if (showMA) {
        const closes = bars.map((b) => b.c);
        const m50 = sma(closes, 50), m200 = sma(closes, 200);
        const v50 = m50[m50.length - 1], v200 = m200[m200.length - 1];
        if (v50 !== null) ma50Ref.current?.update({ time: nb.t as UTCTimestamp, value: v50 });
        if (v200 !== null) ma200Ref.current?.update({ time: nb.t as UTCTimestamp, value: v200 });
        if (markersRef.current) markersRef.current.setMarkers(crossMarkers(bars, m50, m200));
      }
    } else {
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      last.c = price;
      candleRef.current?.update(toCandle(last));
    }
    if (showRSI) {
      const rv = rsi(bars.map((b) => b.c), 14);
      const lastR = rv[rv.length - 1];
      if (lastR !== null) rsiRef.current?.update({ time: bars[bars.length - 1].t as UTCTimestamp, value: lastR });
    }
  }, [price, priceTs, estado, tf, showMA, showRSI]);

  return (
    <div>
      <div className="pc-charthead">
        <span className="pc-label">BTCUSDT · {tf}{fonte === "spot" && estado === "live" ? " · fonte: spot" : ""}</span>
        <div className="pc-tfs" role="group" aria-label="Timeframe">
          {PC_TFS.map((t) => (
            <button key={t} type="button" className={t === tf ? "on" : ""} aria-pressed={t === tf} onClick={() => onTfChange(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="pc-toggles">
        <label><input type="checkbox" checked={showMA} onChange={(e) => setShowMA(e.target.checked)} /> MA</label>
        <label><input type="checkbox" checked={showVol} onChange={(e) => setShowVol(e.target.checked)} /> Volume</label>
        <label><input type="checkbox" checked={showRSI} onChange={(e) => setShowRSI(e.target.checked)} /> RSI</label>
        <span className="pc-hint">MA 50 e 200 - Setas Golden/Death cross</span>
      </div>
      {estado === "loading" && <div className="pc-chartph"><p>Carregando candles…</p><small>Binance Futures · BTCUSDT · {tf}</small></div>}
      {estado === "error" && (
        <div className="pc-chartph"><p>Dados indisponíveis (Binance)</p><small>O restante do painel segue com o stream interno.</small>
          <button type="button" className="pc-btn" onClick={() => setRetry((r) => r + 1)}>Tentar de novo</button>
        </div>
      )}
      <div ref={boxRef} className="pc-chartbox" style={{ display: estado === "live" ? "block" : "none" }} />
    </div>
  );
}
