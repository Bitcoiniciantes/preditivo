"use client";
// PAINEL OBSERVACIONAL (Fase 1) — mostra o estado do mercado em tempo real a partir do
// stream do daemon local. Nada aqui é preditivo: são observações (preço, CVD Δ, OI,
// imbalance, regime, flow, absorção, divergência, whale events, persistência, churn,
// sequência temporal, gaps/qualidade). Probabilidades preditivas ficam fora deste card.
import { useEffect, useRef, useState } from "react";
import { useMarketStreamContext } from "./MarketStreamProvider";

const WINDOW_MS = 15 * 60_000; // últimos 15 minutos
const MAX_TIMELINE = 14;
const SPARK_POINTS = 90;

type TimelineEvent = { t: number; label: string; tone: "buy" | "sell" | "state" };

type Obs = {
  priceBuf: { t: number; p: number }[];
  cvdBuf: { t: number; cvd: number; cw: number }[];
  spark: number[];
  sparkUp: boolean;
  cvdDelta: number | null;
  cvdWhaleDelta: number | null;
  sessionMin: number;
  whaleBuy: number;
  whaleSell: number;
  whaleMagBuy: number;
  whaleMagSell: number;
  lastWhales: { type: string; magnitude: number; direction: string; timestamp: number }[];
  since: { regime: number; flow: number; div: number; abs: number };
  transitions: number;
  churnPerHour: number;
  timeline: TimelineEvent[];
  gaps: number;
  sinceLastMsg: number;
  lastMsgAt: number;
};

const zero: Obs = {
  priceBuf: [],
  cvdBuf: [],
  spark: [],
  sparkUp: true,
  cvdDelta: null,
  cvdWhaleDelta: null,
  sessionMin: 0,
  whaleBuy: 0,
  whaleSell: 0,
  whaleMagBuy: 0,
  whaleMagSell: 0,
  lastWhales: [],
  since: { regime: 0, flow: 0, div: 0, abs: 0 },
  transitions: 0,
  churnPerHour: 0,
  timeline: [],
  gaps: 0,
  sinceLastMsg: 0,
  lastMsgAt: 0,
};

function ago(since: number, now: number): string {
  if (!since) return "—";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m ${s % 60}s`;
  return `há ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Formatação adaptativa (P2-01): $K para milhares, $M para milhões — nunca "$0.0M".
function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function downsample(points: { p: number }[], n: number): number[] {
  if (points.length <= n) return points.map((x) => x.p);
  const step = points.length / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(points[Math.min(points.length - 1, Math.floor(i * step))].p);
  return out;
}

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <div className="obsSparkEmpty">acumulando 15 min…</div>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const W = 220, H = 44;
  const pts = points
    .map((p, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - 3 - ((p - min) / span) * (H - 6)).toFixed(1)}`)
    .join(" ");
  const color = up ? "var(--lime)" : "var(--red)";
  return (
    <svg className="obsSpark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

export function MarketObservatory() {
  const { data, status } = useMarketStreamContext();
  const [obs, setObs] = useState<Obs>(zero);
  const ref = useRef<Obs>(zero);
  const sessionStart = useRef<number>(0);
  const lastState = useRef<{ regime: string; flow: string; div: string; abs: string }>({ regime: "", flow: "", div: "", abs: "" });

  useEffect(() => {
    if (!data) return;
    const now = data.ts;
    if (!sessionStart.current) sessionStart.current = now;
    const r = ref.current;
    const nowMs = Date.now();

    // buffers de preço/CVD (últimos 15 min)
    r.priceBuf.push({ t: now, p: data.p });
    r.cvdBuf.push({ t: now, cvd: data.cvd, cw: data.cvd_whale });
    while (r.priceBuf.length && now - r.priceBuf[0].t > WINDOW_MS) r.priceBuf.shift();
    while (r.cvdBuf.length && now - r.cvdBuf[0].t > WINDOW_MS) r.cvdBuf.shift();

    // whale events da sessão (payload do ciclo de broadcast)
    for (const ev of data.events ?? []) {
      if (ev.direction === "bullish") { r.whaleBuy++; r.whaleMagBuy += ev.magnitude; }
      else if (ev.direction === "bearish") { r.whaleSell++; r.whaleMagSell += ev.magnitude; }
      r.lastWhales.unshift(ev);
      if (r.lastWhales.length > 5) r.lastWhales.pop();
      r.timeline.unshift({ t: now, label: `${ev.type === "whale_buy" ? "WHALE COMPRA" : "WHALE VENDA"} ${fmtUsd(ev.magnitude)}`, tone: ev.direction === "bullish" ? "buy" : "sell" });
      if (r.timeline.length > MAX_TIMELINE) r.timeline.pop();
    }

    // persistência: tempo desde a última mudança de estado
    const states: [keyof Obs["since"], string][] = [
      ["regime", data.regime],
      ["flow", data.flow_regime],
      ["div", data.divergence],
      ["abs", data.absorption_state],
    ];
    for (const [key, value] of states) {
      if (lastState.current[key] !== value) {
        if (lastState.current[key] !== "") {
          r.transitions++;
          r.timeline.unshift({ t: now, label: `${key.toUpperCase()} ${lastState.current[key]} → ${value}`, tone: "state" });
          if (r.timeline.length > MAX_TIMELINE) r.timeline.pop();
        }
        lastState.current[key] = value;
        r.since[key] = nowMs;
      }
    }

    // gaps de broadcast (sem mensagem por > 5s)
    if (r.lastMsgAt && nowMs - r.lastMsgAt > 5_000) r.gaps++;
    r.lastMsgAt = nowMs;

    // CVD Δ 15m com guarda de reset (>50% de queda em 1 passo = sessão reiniciada)
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

    const sessionMin = (nowMs - sessionStart.current) / 60_000;
    const churnPerHour = sessionMin > 0 ? (r.transitions / sessionMin) * 60 : 0;

    setObs({
      ...r,
      spark: downsample(r.priceBuf, SPARK_POINTS),
      sparkUp: r.priceBuf.length >= 2 ? r.priceBuf[r.priceBuf.length - 1].p >= r.priceBuf[0].p : true,
      cvdDelta,
      cvdWhaleDelta,
      sessionMin,
      churnPerHour,
      sinceLastMsg: nowMs - r.lastMsgAt,
    });
  }, [data]);

  const db = data?.dbStats ?? null;
  const price = data?.p ?? 0;
  const fmtPrice = price ? price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—";
  const fmtMoney = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}$${(v / 1e6).toFixed(2)}M`);
  const quality = data?.quality ?? { ws: "UNKNOWN", oi: "UNKNOWN", funding: "UNKNOWN" };
  const dot = (s: string) => (s === "LIVE" ? "var(--lime)" : s === "STALE" ? "#f0ad4e" : "var(--red)");

  return (
    <article className="card obsCard">
      <div className="cardTitle">
        <div>
          <span>OBSERVATÓRIO</span>
          <b>Estado do mercado em tempo real</b>
        </div>
        <span className={`marketStatus ${status === "live" ? "" : "off"}`}>{status === "live" ? "AO VIVO" : status.toUpperCase()}</span>
      </div>

      <div className="obsGrid">
        <div className="obsCell obsPriceCell">
          <span className="obsLabel">PREÇO ATUAL</span>
          <span className="obsPrice">${fmtPrice}</span>
          <Sparkline points={obs.spark} up={obs.sparkUp} />
          <span className="obsHint">últimos 15 min ({obs.priceBuf.length} ticks)</span>
        </div>

        <div className="obsCell">
          <span className="obsLabel">CVD Δ 15m</span>
          <span className="obsValue" style={{ color: (obs.cvdDelta ?? 0) > 0 ? "var(--lime)" : (obs.cvdDelta ?? 0) < 0 ? "var(--red)" : "var(--muted)" }}>
            {fmtMoney(obs.cvdDelta)}
          </span>
          <span className="obsLabel">CVD WHALE Δ 15m</span>
          <span className="obsValue" style={{ color: (obs.cvdWhaleDelta ?? 0) > 0 ? "var(--lime)" : (obs.cvdWhaleDelta ?? 0) < 0 ? "var(--red)" : "var(--muted)" }}>
            {fmtMoney(obs.cvdWhaleDelta)}
          </span>
        </div>

        <div className="obsCell">
          <span className="obsLabel">OI (BTC) / ΔOI</span>
          <span className="obsValue">{(data?.oi ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          <span className="obsValue" style={{ color: (data?.oi_delta ?? 0) > 0 ? "var(--lime)" : (data?.oi_delta ?? 0) < 0 ? "var(--red)" : "var(--muted)" }}>
            {(data?.oi_delta ?? 0) > 0 ? "+" : ""}{((data?.oi_delta ?? 0) * 100).toFixed(3)}%
          </span>
          <span className="obsLabel">BOOK IMBALANCE</span>
          <span className="obsValue" style={{ color: (data?.imb ?? 0) > 0 ? "var(--lime)" : (data?.imb ?? 0) < 0 ? "var(--red)" : "var(--muted)" }}>
            {(data?.imb ?? 0) > 0 ? "+" : ""}{((data?.imb ?? 0) * 100).toFixed(1)}%
          </span>
        </div>

        <div className="obsCell obsStateCell">
          <span className="obsLabel">ESTADOS (persistência)</span>
          <div className="obsState"><span>REGIME</span><b>{data?.regime ?? "—"}</b><em>{ago(obs.since.regime, Date.now())}</em></div>
          <div className="obsState"><span>FLOW</span><b>{data?.flow_regime ?? "—"}</b><em>{ago(obs.since.flow, Date.now())}</em></div>
          <div className="obsState"><span>ABSORÇÃO</span><b>{data?.absorption_state ?? "—"}</b><em>{ago(obs.since.abs, Date.now())}</em></div>
          <div className="obsState"><span>DIVERGÊNCIA</span><b>{data?.divergence ?? "—"}</b><em>{ago(obs.since.div, Date.now())}</em></div>
        </div>

        <div className="obsCell">
          <span className="obsLabel">WHALE EVENTS (sessão)</span>
          <div className="obsWhale"><span style={{ color: "var(--lime)" }}>▲ {obs.whaleBuy} compras</span><b style={{ color: "var(--lime)" }}>${(obs.whaleMagBuy / 1e6).toFixed(1)}M</b></div>
          <div className="obsWhale"><span style={{ color: "var(--red)" }}>▼ {obs.whaleSell} vendas</span><b style={{ color: "var(--red)" }}>${(obs.whaleMagSell / 1e6).toFixed(1)}M</b></div>
          <span className="obsLabel">HISTÓRICO GERAL (snapshots, desde início da coleta)</span>
          <span className="obsValue">{db ? `${db.uptimeH.toFixed(1)}h efetivas · ${db.snapshots.toLocaleString("pt-BR")} snaps` : "—"}</span>
          <span className="obsLabel">HISTÓRICO WHALE EVENTS (desde ativação do saveEvent — 2026-08-25 23:07Z)</span>
          <span className="obsValue">{db ? `${db.whaleEvents.toLocaleString("pt-BR")} eventos · span ${db.whaleSpanMin.toFixed(0)} min` : "—"}</span>
        </div>

        <div className="obsCell">
          <span className="obsLabel">CHURN DE ESTADOS</span>
          <span className="obsValue">{obs.transitions} transições</span>
          <span className="obsValue">{obs.churnPerHour.toFixed(1)}/h na sessão</span>
          <span className="obsLabel">QUALIDADE / GAPS</span>
          <div className="obsQuality">
            {(["ws", "oi", "funding"] as const).map((k) => (
              <span key={k}><i style={{ background: dot(quality[k]) }} />{k.toUpperCase()}</span>
            ))}
          </div>
          <span className="obsHint">gaps de broadcast (sessão): {obs.gaps} · DB: {db ? `${db.gaps3min} gaps / ${db.segments} segmentos` : "—"}</span>
        </div>
      </div>

      <div className="obsBottom">
        <div className="obsTimeline">
          <span className="obsLabel">SEQUÊNCIA TEMPORAL DOS EVENTOS</span>
          {obs.timeline.length === 0 ? (
            <div className="obsEmpty">aguardando eventos…</div>
          ) : (
            obs.timeline.map((e, i) => (
              <div className={`obsEvent ${e.tone}`} key={i}>
                <i />
                <span>{e.label}</span>
                <em>{fmtTime(e.t)}</em>
              </div>
            ))
          )}
        </div>
        <div className="obsSummary">
          <span className="obsLabel">ESTADO ATUAL DO MERCADO</span>
          <p>
            BTC ≈ ${fmtPrice} · {data?.regime ?? "—"} · FLOW {data?.flow_regime ?? "—"} · ABS {data?.absorption_state ?? "—"} · DIV {data?.divergence ?? "—"} · SCORE {data?.score ?? "—"}
          </p>
          <p className="obsFoot">Painel observacional — nenhuma probabilidade preditiva é exibida (gate da Fase 1).</p>
        </div>
      </div>
    </article>
  );
}
