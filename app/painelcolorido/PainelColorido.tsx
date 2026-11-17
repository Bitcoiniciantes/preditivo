"use client";
// app/painelcolorido/PainelColorido.tsx — PAINEL COLORIDO (rota experimental).
// Dashboard observacional no estilo da referência visual: header, sidebar,
// cards de regime/fluxo/derivativos, placeholder de gráfico, microestrutura,
// feed de alertas do sistema, divergências, saúde, timeline e banners.
//
// Fontes (todas existentes, sem nada novo): mesmo WebSocket via
// useMarketStreamContext; public/painel-status.json; glossario.ts;
// useSessionMetrics + lib/painelcolorido-session.ts (agregações visuais
// client-side). Sem métrica/fórmula/threshold novos. Sem linguagem preditiva.
// Não altera nenhum painel existente.

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMarketStreamContext } from "../MarketStreamProvider";
import { useSessionMetrics, fmtSignedM } from "../../lib/useSessionMetrics";
import { usePainelColoridoSeries, fmtPcUsd } from "../../lib/painelcolorido-session";
import type { PcTf } from "../../lib/painelcolorido-klines";
import { PainelColoridoChart } from "./PainelColoridoChart";
import { fmtOiDelta } from "../../lib/oi-delta";
import {
  COR_TOM,
  rotuloRegime,
  rotuloFlow,
  rotuloAbsorcao,
  rotuloDivergencia,
  rotuloFunding,
  acaoEvento,
  rotuloDestinoEvento,
} from "../glossario";

type HistEvento = { t: string; type: string; from: string | null; to: string; price: number; confidence: number };
type Hist = {
  updatedAt: string;
  snapshots: number;
  regimeEvents: number;
  regimeChanges24h: number;
  regimeChanges7d: number;
  durations: Record<string, { count: number; totalMs: number; avgMin: number }>;
  recent: HistEvento[];
};

function basePrefix(): string {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/preditivo")) return "/preditivo";
  return "";
}

function haQuanto(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m ${s % 60}s`;
  return `há ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Variante com segundos, exclusiva do feed de Alertas Ativos: eventos distintos
// dentro do mesmo minuto pareciam duplicados com hora:minuto.
function fmtHoraS(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Sparkline puramente visual (prefixo pc-, escopada à rota).
function PcSpark({ values, w = 120, h = 34 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="pc-spark" aria-hidden="true" />;
  const mn = Math.min(...values), mx = Math.max(...values);
  const span = mx - mn || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - mn) / span) * (h - 6)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="pc-spark" aria-hidden="true" preserveAspectRatio="none">
      <polyline points={pts} fill="none" strokeWidth="1.5" stroke={up ? COR_TOM.bull : COR_TOM.bear} />
    </svg>
  );
}

// Gauge circular puramente visual (índice 0–100, sem unidade física).
// O número central é um ÍNDICE normalizado, não porcentagem.
function PcGauge({ value, tone }: { value: number; tone: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 42 42" className="pc-gauge" role="img" aria-label={`índice ${v.toFixed(0)} de 100`}>
      <circle cx="21" cy="21" r="15.9155" fill="none" strokeWidth="4" className="pc-gauge-track" />
      <circle cx="21" cy="21" r="15.9155" fill="none" strokeWidth="4" strokeDasharray={`${v} 100`} strokeLinecap="round" stroke={tone} transform="rotate(-90 21 21)" />
      <text x="21" y="21" textAnchor="middle" dominantBaseline="central" className="pc-gauge-text">{v.toFixed(0)}</text>
    </svg>
  );
}

type AlertaNivel = "ATENÇÃO" | "OBSERVAÇÃO" | "ENCERRADO" | "INFORMATIVO";
type Alerta = { nivel: AlertaNivel; titulo: string; detalhe: string; quando: string; ativo: boolean };

// Feed de alertas do SISTEMA (derivação de apresentação sobre estados já
// existentes — severidade = estado observado, nunca urgência de ação).
function derivarAlertas(data: ReturnType<typeof useMarketStreamContext>["data"], hist: Hist | null, now: number): Alerta[] {
  const out: Alerta[] = [];
  if (data) {
    if (data.divergence !== "NONE") out.push({ nivel: "ATENÇÃO", titulo: "Divergência de Fluxo", detalhe: rotuloDivergencia(data.divergence).label, quando: "agora", ativo: true });
    if (data.absorption_state !== "NONE") out.push({ nivel: "ATENÇÃO", titulo: "Absorção em acompanhamento", detalhe: rotuloAbsorcao(data.absorption_state).label, quando: "agora", ativo: true });
    if (Math.abs(data.imb) > 0.7) out.push({ nivel: "OBSERVAÇÃO", titulo: "Imbalance elevado", detalhe: `${(data.imb * 100).toFixed(1)}%`, quando: "agora", ativo: true });
    if (data.funding_class === "extreme") out.push({ nivel: "OBSERVAÇÃO", titulo: "Funding extremo", detalhe: `${(data.funding * 100).toFixed(4)}%`, quando: "agora", ativo: true });
  }
  if (hist) {
    for (const e of hist.recent.slice(0, 12)) {
      const mins = (now - new Date(e.t).getTime()) / 60_000;
      const quando = fmtHoraS(new Date(e.t).getTime());
      const acao = acaoEvento(e.type) ?? e.type;
      if (e.type === "regime_change") out.push({ nivel: "OBSERVAÇÃO", titulo: "Mudança de Regime", detalhe: `${rotuloRegime(e.from ?? "").label} → ${rotuloRegime(e.to).label}`, quando, ativo: mins < 60 });
      else if (e.type === "absorption_triggered" || e.type === "divergence") out.push({ nivel: "ATENÇÃO", titulo: acao, detalhe: rotuloDestinoEvento(e.type, e.to), quando, ativo: mins < 60 });
      else if (e.type.endsWith("_resolved") || e.type.endsWith("_failed") || e.type.endsWith("_interrupted")) out.push({ nivel: "ENCERRADO", titulo: acao, detalhe: rotuloDestinoEvento(e.type, e.to), quando, ativo: false });
      else out.push({ nivel: "INFORMATIVO", titulo: acao, detalhe: rotuloDestinoEvento(e.type, e.to), quando, ativo: false });
    }
  }
  return out;
}

const TABS = ["TODOS", "ATIVOS", "ENCERRADOS", "INFO"] as const;

// Análise IA (local-only): carregada sob demanda, sem SSR — o componente usa
// localStorage e o stream do browser, inexistentes na compilação estática.
// Só monta quando NEXT_PUBLIC_PC_AI_ENABLED === "1" (ausente no pages.dev).
const PainelColoridoIa = dynamic(
  () => import("./PainelColoridoIa").then((m) => m.PainelColoridoIa),
  { ssr: false },
);

const PC_AI_ENABLED = process.env.NEXT_PUBLIC_PC_AI_ENABLED === "1";
const PC_HISTORY_ENABLED = process.env.NEXT_PUBLIC_PC_HISTORY_ENABLED !== "0";
const HIST_PAUSADO = "Histórico pausado";

// Timeframe do gráfico → período efetivo da API Long/Short (contas).
// 1m e 1W não existem na API: usam 5m e 1d. 30m fica no cache do daemon
// para uso futuro (sem botão no gráfico nesta tarefa).
const PC_TF_TO_LS: Record<PcTf, string> = {
  "1m": "5m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1D": "1d",
  "1W": "1d",
};

// Stale Long/Short: poll a cada 60s; idade > 120s = desatualizado.
const LS_STALE_MS = 120_000;

export function PainelColorido() {
  const { data, status } = useMarketStreamContext();
  const [hist, setHist] = useState<Hist | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<(typeof TABS)[number]>("TODOS");
  // Timeframe compartilhado com o gráfico (antes era estado local do chart).
  const [pcTf, setPcTf] = useState<PcTf>("15m");
  const sess = useSessionMetrics(data);
  const pc = usePainelColoridoSeries(data);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!PC_HISTORY_ENABLED) {
      setHist(null);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`${basePrefix()}/painel-status.json`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as Hist;
        if (active) setHist(body);
      } catch { /* mantém "—" */ }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const live = status === "live" && !!data;
  const quality = data?.quality ?? { ws: "UNKNOWN", oi: "UNKNOWN", funding: "UNKNOWN" };
  const regime = rotuloRegime(data?.regime);
  const flow = rotuloFlow(data?.flow_regime);
  const divergence = rotuloDivergencia(data?.divergence);
  const absorption = rotuloAbsorcao(data?.absorption_state);
  const imbPct = data ? data.imb * 100 : null;
  const imbPos = data ? ((data.imb + 1) / 2) * 100 : 50;
  // Long/Short — Contas: período efetivo da API + estado (sem cores direcionais).
  // Stale mede a SAÚDE DO FEED (fetchedAt = última coleta válida do daemon),
  // nunca a idade do bucket Binance (updatedAt), que chega a horas/dia.
  const lsPeriod = PC_TF_TO_LS[pcTf];
  const ls = data?.longShort?.[lsPeriod] ?? null;
  const lsFetchedAt = ls ? (ls.fetchedAt ?? ls.updatedAt) : null;
  const lsAge = lsFetchedAt !== null ? now - lsFetchedAt : null;
  const lsStale = lsAge !== null && lsAge > LS_STALE_MS;
  const alertas = derivarAlertas(data, PC_HISTORY_ENABLED ? hist : null, now);
  const visiveis = alertas.filter((a) =>
    tab === "TODOS" ? true : tab === "ATIVOS" ? a.ativo : tab === "ENCERRADOS" ? a.nivel === "ENCERRADO" : a.nivel === "INFORMATIVO");
  // Subseção "Últimas divergências" (somente apresentação): filtra o hist.recent
  // já carregado em memória. Sem fetch novo, sem agrupamento por episódio
  // (cada evento é uma linha), duração histórica sempre "—" (extra não chega
  // ao frontend — painel-status.mjs não seleciona a coluna).
  const divHistorico = hist
    ? hist.recent.filter((e) => e.type === "divergence" || e.type === "divergence_resolved" || e.type === "divergence_failed").slice(0, 5)
    : null;

  return (
    <div className="pc-root">
      <div className="pc-layout">
        {/* Sidebar */}
        <nav className="pc-side" aria-label="Navegação do painel colorido">
          <div className="pc-asset"><span className="pc-btc-mini">₿</span><div><b>BTCUSDT</b><small>Bitcoin / TetherUS</small></div></div>
          <div className="pc-sideinfo">
            <div className="pc-price"><b>{data ? `$${data.p.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}</b><small>{live && data ? `Atualizado ${haQuanto(data.ts, now)}` : "sem dados do stream"}</small></div>
            <div className="pc-conn"><span className={live ? "pc-live-on" : "pc-live-off"}>{live ? "● LIVE" : "● OFFLINE"}</span><small>Conexão {quality.ws} · Stream {live ? "ativo" : "inativo"}</small></div>
          </div>
          <span className="pc-label">NAVEGAÇÃO</span>
          <a href="#pc-regime">Regime</a>
          <a href="#pc-fluxo">Fluxo</a>
          <a href="#pc-derivativos">Derivativos</a>
          <a href="#pc-grafico">Gráfico</a>
          <a href="#pc-micro">Microestrutura</a>
          <a href="#pc-alertas">Alertas</a>
          <a href="#pc-divergencias">Divergências</a>
          <a href="#pc-saude">Saúde</a>
          <a href="#pc-timeline">Timeline</a>
          <Link href="/definitivo">Definitivo <em>histórico</em></Link>
          {PC_AI_ENABLED && (
            <PainelColoridoIa
              live={live}
              snapshotTs={live && data ? data.ts : null}
              snapshotAgeSec={live && data ? (now - data.ts) / 1000 : null}
            />
          )}
        </nav>

        <div className="pc-main">
          {/* Linha 1: Regime / Fluxo / Derivativos */}
          <div className="pc-row3">
            <section className="pc-card" id="pc-regime">
              <span className="pc-label">REGIME DE PREÇO</span>
              <b className="pc-badge" style={{ color: COR_TOM[regime.tone], borderColor: COR_TOM[regime.tone] }}>{regime.label}</b>
              <div className="pc-gauges">
                <div><PcGauge value={data?.regime_confidence ?? 0} tone={COR_TOM[regime.tone]} /><small title="Índice relativo ao threshold do detector, não porcentagem física.">Força do Movimento (índice)</small></div>
                <div><PcGauge value={data ? Math.min(100, data.regime_volatility * 1000) : 0} tone={COR_TOM.range} /><small title="Índice visual normalizado (volatilidade × 1000), não porcentagem física.">Volatilidade (índice)</small></div>
              </div>
              <div className="pc-kv"><span>Tempo no Estado</span><b>{sess.since.regime ? haQuanto(sess.since.regime, now) : "—"}</b></div>
              <div className="pc-kv"><span>Duração média</span><b>{!PC_HISTORY_ENABLED ? HIST_PAUSADO : hist?.durations?.[data?.regime ?? ""] ? (hist.durations[data?.regime ?? ""].avgMin < 1 ? "<1min" : `~${hist.durations[data?.regime ?? ""].avgMin}min`) : "—"}</b></div>
              <div className="pc-kv"><span>Mudanças (24h)</span><b>{!PC_HISTORY_ENABLED ? HIST_PAUSADO : hist ? hist.regimeChanges24h : "—"}</b></div>
            </section>

            <section className="pc-card" id="pc-fluxo">
              <span className="pc-label">FLUXO E ESTRUTURA</span>
              <div className="pc-imbbar" role="img" aria-label={`Book imbalance: ${imbPct !== null ? imbPct.toFixed(1) : "—"}%`}>
                <div className="pc-imbtrack"><i style={{ left: `${imbPos}%` }} /><b style={{ left: `${imbPos}%` }}>{imbPct !== null ? `${imbPct.toFixed(1)}%` : "—"}</b></div>
                <div className="pc-imbscale"><span>VENDA</span><span>COMPRA</span></div>
              </div>
              <div className="pc-kv"><span>Regime de fluxo</span><b style={{ color: data ? COR_TOM[flow.tone] : undefined }}>{flow.label}</b></div>
              <div className="pc-kv"><span>CVD Total</span><b>{data ? fmtPcUsd(data.cvd) : "—"}</b></div>
              <PcSpark values={pc.series.cvd} />
              <div className="pc-kv"><span>CVD Whale</span><b>{data ? fmtPcUsd(data.cvd_whale) : "—"}</b></div>
              <PcSpark values={pc.series.whale} />
              <div className="pc-kv"><span>CVD Δ15m</span><b>{fmtSignedM(sess.cvdDelta)}</b></div>
              <div className="pc-kv"><span>Divergência</span><b style={{ color: data ? COR_TOM[divergence.tone] : undefined }}>{divergence.label}</b></div>
              <div className="pc-kv"><span>Score do motor</span><b>{data ? `${data.score > 0 ? "+" : ""}${data.score}` : "—"}</b></div>
            </section>

            <section className="pc-card" id="pc-derivativos">
              <span className="pc-label">DERIVATIVOS</span>
              <div className="pc-kv"><span>Open Interest (OI)</span><b>{data ? `${data.oi.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} contratos` : "—"}</b></div>
              <div className="pc-kv"><span>ΔOI / 1min (contratos)</span><b>{sess.oiDelta ? fmtOiDelta(sess.oiDelta) : "—"}</b></div>
              <PcSpark values={pc.series.oi} />
              <div className="pc-kv"><span>Funding Rate</span><b>{data ? `${(data.funding * 100).toFixed(4)}%` : "—"}</b></div>
              <div className="pc-kv"><span>Classe de Funding</span><b>{data ? rotuloFunding(data.funding_class) : "—"}</b></div>
              <PcSpark values={pc.series.funding} />
              <div className="pc-kv"><span>Viés</span><b style={{ color: data ? (data.funding > 0 ? COR_TOM.bull : data.funding < 0 ? COR_TOM.bear : undefined) : undefined }}>{!data ? "—" : data.funding > 0 ? "Mais longs" : data.funding < 0 ? "Mais shorts" : "Equilibrado"}</b></div>
              <span className="pc-hint">Quem paga funding indica o lado mais posicionado; não é direção futura.</span>
              <small className="pc-sub">Long/Short — Contas <span className="pc-hint" title="Proporção de contas com posição líquida long e short no mercado. Não representa volume nem tamanho das posições. É diferente do Viés, que é derivado do funding.">ⓘ</span></small>
              {ls ? (
                <>
                  <div className="pc-kv"><span>Ratio (contas)</span><b>{ls.ratio.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</b></div>
                  <div className="pc-kv"><span>Contas</span><b>Long {(ls.longPct * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% · Short {(ls.shortPct * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b></div>
                  <div className="pc-kv"><span>Período: {lsPeriod}</span><b>{lsFetchedAt !== null && (lsStale ? `desatualizado há ${haQuanto(lsFetchedAt, now).replace("há ", "")}` : `atualizado ${haQuanto(lsFetchedAt, now)}`)}</b></div>
                </>
              ) : (
                <>
                  <div className="pc-kv"><span>Ratio (contas)</span><b>—</b></div>
                  <span className="pc-hint">aguardando dados</span>
                </>
              )}
            </section>
          </div>

          {/* Linha 2: gráfico (placeholder) + micro + alertas */}
          <div className="pc-row-chart">
            <section className="pc-card pc-chart" id="pc-grafico">
              <PainelColoridoChart price={live && data ? data.p : null} priceTs={live && data ? data.ts : null} tf={pcTf} onTfChange={setPcTf} />
            </section>

            <section className="pc-card" id="pc-micro">
              <span className="pc-label">MICROESTRUTURA</span>
              <small className="pc-sub">PRESSÃO OBSERVADA</small>
              <div className="pc-kv"><span>Churn (h)</span><b>{pc.churn.churnH}</b></div>
              <div className="pc-kv"><span>Transições &lt;1min</span><b>{pc.churn.transitions1min}</b></div>
              <small className="pc-sub">LIQUIDEZ / ABSORÇÃO</small>
              <div className="pc-kv"><span>Absorção</span><b style={{ color: data ? COR_TOM[absorption.tone] : undefined }}>{absorption.label}</b></div>
              <div className="pc-kv"><span>Imbalance</span><b>{imbPct !== null ? `${imbPct.toFixed(1)}%` : "—"}</b></div>
              <small className="pc-sub">DIVERGÊNCIA</small>
              <div className="pc-kv"><span>Status</span><b style={{ color: data ? COR_TOM[divergence.tone] : undefined }}>{divergence.label}</b></div>
              <div className="pc-kv"><span>Whale sessão</span><b>{sess.whaleBuy + sess.whaleSell > 0 ? `${sess.whaleBuy}×C / ${sess.whaleSell}×V` : "—"}</b></div>
            </section>

            <section className="pc-card" id="pc-alertas">
              <span className="pc-label">ALERTAS ATIVOS <em className="pc-count">{visiveis.length}</em></span>
              <div className="pc-tabs" role="tablist" aria-label="Filtro de alertas">{TABS.map((t) => (<button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>))}</div>
              <div className="pc-feed">
                {visiveis.length === 0 ? <span className="pc-empty">Nenhum alerta neste filtro.</span> : visiveis.slice(0, 8).map((a, i) => (
                  <div className="pc-alert" key={i}><em className={`pc-sev-${a.nivel}`}>{a.nivel}</em><div><b>{a.titulo}</b><small>{a.detalhe} · {a.quando}</small></div></div>
                ))}
              </div>
            </section>
          </div>

          {/* Linha 3: divergências + saúde */}
          <div className="pc-row2">
            <section className="pc-card" id="pc-divergencias">
              <span className="pc-label pc-label-ico"><svg viewBox="0 0 16 16" className="pc-ico" aria-hidden="true"><path d="M2 5h8m0 0L7.5 2.5M10 5L7.5 7.5" fill="none" strokeWidth="1.6" stroke={COR_TOM.bull} strokeLinecap="round" strokeLinejoin="round" /><path d="M14 11H6m0 0l2.5-2.5M6 11l2.5 2.5" fill="none" strokeWidth="1.6" stroke={COR_TOM.bear} strokeLinecap="round" strokeLinejoin="round" /></svg>DIVERGÊNCIAS</span>
              {data && data.divergence !== "NONE" ? (
                <table className="pc-table"><thead><tr><th>TIPO</th><th>DURAÇÃO</th><th>INÍCIO</th><th>STATUS</th></tr></thead>
                  <tbody><tr><td>Fluxo vs Preço</td><td className="pc-div-dur">{sess.since.div ? haQuanto(sess.since.div, now) : "—"}</td><td>{sess.since.div ? fmtHora(sess.since.div) : "—"}</td><td className="pc-div-status">ATIVA</td></tr></tbody></table>
              ) : <span className="pc-empty">Nenhuma divergência ativa.</span>}
              {!PC_HISTORY_ENABLED ? (
                <span className="pc-empty">{HIST_PAUSADO}.</span>
              ) : divHistorico !== null && (
                divHistorico.length > 0 ? (
                  <>
                    <span className="pc-sub">ÚLTIMAS DIVERGÊNCIAS</span>
                    <table className="pc-table"><thead><tr><th>TIPO</th><th>HORA</th><th>DURAÇÃO</th><th>STATUS</th></tr></thead>
                      <tbody>{divHistorico.map((e, i) => (
                        <tr key={i}><td>{rotuloDestinoEvento(e.type, e.to)}</td><td>{fmtHoraS(new Date(e.t).getTime())}</td><td className="pc-div-dur">—</td><td>{acaoEvento(e.type) ?? e.type}</td></tr>
                      ))}</tbody></table>
                  </>
                ) : <span className="pc-empty">Sem registros recentes no histórico.</span>
              )}
            </section>

            <section className="pc-card" id="pc-saude">
              <span className="pc-label">SAÚDE DA COLETA</span>
              <div className="pc-kv"><span>Conexão</span><b>{quality.ws}</b></div>
              <div className="pc-kv"><span>Stream</span><b>{live ? "Ativo" : "Inativo"}</b></div>
              <div className="pc-kv"><span>Snapshots</span><b>{!PC_HISTORY_ENABLED ? HIST_PAUSADO : data?.dbStats ? data.dbStats.snapshots.toLocaleString("pt-BR") : "—"}</b></div>
              <div className="pc-kv"><span>Gaps &gt;3min</span><b>{!PC_HISTORY_ENABLED ? HIST_PAUSADO : data?.dbStats ? data.dbStats.gaps3min : "—"}</b></div>
              <div className="pc-kv"><span>Idade dos dados</span><b>{live && data ? haQuanto(data.ts, now) : "—"}</b></div>
            </section>
          </div>

          {/* Timeline horizontal */}
          <section className="pc-card" id="pc-timeline">
            <span className="pc-label">TIMELINE DE EVENTOS</span>
            <div className="pc-tl">
              {!PC_HISTORY_ENABLED ? (
                <span className="pc-empty">{HIST_PAUSADO}.</span>
              ) : hist && hist.recent.length > 0 ? hist.recent.slice(0, 14).map((e, i) => (
                <div className="pc-tlitem" key={i}><b>{fmtHora(new Date(e.t).getTime())}</b><span>{acaoEvento(e.type) ?? e.type}</span><small>{rotuloDestinoEvento(e.type, e.to)}</small></div>
              )              ) : <span className="pc-empty">Aguardando histórico…</span>}
            </div>
          </section>

          {/* Complementar + experimento */}
          <div className="pc-row2">
            <section className="pc-card"><span className="pc-label">VISÃO COMPLEMENTAR</span><span className="pc-hint">O painel Definitivo está disponível como histórico e referência.</span><Link className="pc-btn" href="/definitivo">Acessar Definitivo →</Link></section>
            <section className="pc-card pc-exp"><span className="pc-label">EXPERIMENTO V1 — ENCERRADO</span><span className="pc-hint">Hipótese não validada. Funcionalidade preditiva desativada.</span><span className="pc-hint">Dados observacionais em tempo real, sem interpretação preditiva.</span></section>
          </div>

          <p className="pc-foot">Painel observacional — nenhuma probabilidade preditiva é exibida. Mostra o que os dados indicam agora, nunca o que acontecerá depois. <span>Ativo · Atenção · Observação · Informativo</span></p>
        </div>
      </div>
    </div>
  );
}
