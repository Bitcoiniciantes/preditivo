"use client";
// SUPER PAINEL UNIFICADO — consolidação observacional (Fase Pós-V1 + evolução visual).
// Fontes (todas existentes, sem nada novo):
// - MESMO WebSocket via useMarketStreamContext (nenhum socket próprio);
// - public/painel-status.json a cada 60s (mesmo artefato do Definitivo/Único);
// - AlertPanel (instância única, movida para cá);
// - glossario.ts (vocabulário canônico).
// Sem métrica/fórmula/threshold/agregação novos. Sem linguagem preditiva.
// Visual (sidebar, gauges, sparklines, barras, badges) é só apresentação:
// sparkline = preços de `recent[]`; gauge = confidence 0–100; barra = imb ±1.
import { useEffect, useState } from "react";
import { useMarketStreamContext } from "./MarketStreamProvider";
import { AlertPanel } from "./AlertPanel";
import { useSessionMetrics, fmtUsd as fmtUsdAdapt, fmtSignedM } from "../lib/useSessionMetrics";
import { fmtOiDelta } from "../lib/oi-delta";
import {
  COR_TOM,
  rotuloRegime,
  rotuloFlow,
  rotuloAbsorcao,
  rotuloDivergencia,
  rotuloFunding,
  acaoEvento,
  rotuloDestinoEvento,
  tomEvento,
  type Tom,
} from "./glossario";
const REFRESH_MS = 60_000;
const RECENT_SHOWN = 14;
const PC_HISTORY_ENABLED = process.env.NEXT_PUBLIC_PC_HISTORY_ENABLED !== "0";

type PainelStatus = {
  updatedAt: string;
  snapshots: number;
  lastSnapshotAt: string | null;
  regimeEvents: number;
  regimeChanges24h: number;
  regimeChanges7d: number;
  durations: Record<string, { count: number; totalMs: number; avgMin: number }>;
  recent: { t: string; type: string; from: string | null; to: string; price: number; confidence: number }[];
};

function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function haQuanto(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m ${s % 60}s`;
  return `há ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function fmtUSD(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Severidade = ESTADO DO EVENTO OBSERVADO (nunca urgência de ação).
// ATENÇÃO: evento estrutural em acompanhamento · OBSERVAÇÃO: mudança de rotina
// para acompanhar · ENCERRADO: evento concluído · INFORMATIVO: atualização normal.
function severidadeEvento(type: string): { nivel: "ATENÇÃO" | "OBSERVAÇÃO" | "ENCERRADO" | "INFORMATIVO"; tone: Tom } {
  if (type === "absorption_triggered" || type === "divergence") return { nivel: "ATENÇÃO", tone: "range" };
  if (type === "regime_change") return { nivel: "OBSERVAÇÃO", tone: "steady" };
  if (
    type === "absorption_resolved" || type === "absorption_failed" ||
    type === "absorption_interrupted" || type === "divergence_resolved" ||
    type === "divergence_failed"
  ) return { nivel: "ENCERRADO", tone: "neutral" };
  return { nivel: "INFORMATIVO", tone: "info" };
}

function rotuloEvento(type: string, from: string | null, to: string): string {
  if (type === "regime_change") return `${rotuloRegime(from ?? "").label} → ${rotuloRegime(to).label}`;
  const acao = acaoEvento(type);
  if (!acao) return `${type} → ${to}`;
  return `${acao} → ${rotuloDestinoEvento(type, to)}`;
}

function tomDe(t: Tom): string {
  return COR_TOM[t];
}

// Gauge circular puramente visual (valor 0–100 já existente).
function Gauge({ value, tone, label }: { value: number; tone: Tom; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 15.9155;
  return (
    <div className="spuGauge" role="img" aria-label={`${label}: ${v.toFixed(0)} de 100`}>
      <svg viewBox="0 0 42 42">
        <circle cx="21" cy="21" r={r} fill="none" strokeWidth="5" className="spuGaugeTrack" />
        <circle
          cx="21" cy="21" r={r} fill="none" strokeWidth="5"
          strokeDasharray={`${v} 100`} strokeLinecap="round"
          style={{ stroke: tomDe(tone) }} transform="rotate(-90 21 21)"
        />
        <text x="21" y="24" textAnchor="middle" className="spuGaugeText">{v.toFixed(0)}</text>
      </svg>
      <span>{label}</span>
    </div>
  );
}

// Sparkline puramente visual de uma série já existente (ex.: preços de recent[]).
function Spark({ values }: { values: number[] }) {
  const w = 100, h = 32;
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className="spuSpark" aria-hidden="true" />;
  const mn = Math.min(...values), mx = Math.max(...values);
  const span = mx - mn || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 3 - ((v - mn) / span) * (h - 6)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spuSpark" aria-hidden="true" preserveAspectRatio="none">
      <polyline points={pts} fill="none" strokeWidth="1.5" style={{ stroke: up ? tomDe("bull") : tomDe("bear") }} />
    </svg>
  );
}

// Modo leigo: somente troca de rótulo de estado-atual (useState local, sem
// backend — conceito herdado do MarketPanel). As frases interpretativas do
// MarketPanel (getImbalancePhrase/getCvdPhrase/getOiPhrase/getFundingPhrase,
// ex. "pressão institucional", "grandes players descarregando") NÃO foram
// portadas: atribuíam intenção/motivo ao dado bruto. Aqui o leigo descreve
// somente onde a métrica ESTÁ, nunca o que fará ou por quê.
function rotuloSimplesRegime(codigo: string | undefined): string {
  switch (codigo) {
    case "BULL_TREND":
      return "Mercado subindo";
    case "BEAR_TREND":
      return "Mercado caindo";
    case "RANGE":
      return "Mercado parado";
    default:
      return codigo || "—";
  }
}

function rotuloSimplesFlow(codigo: string | undefined): string {
  switch (codigo) {
    case "BULL_FLOW":
      return "Mais compras executando";
    case "BEAR_FLOW":
      return "Mais vendas executando";
    case "NEUTRAL_FLOW":
      return "Sem direção no fluxo";
    default:
      return codigo || "—";
  }
}

function rotuloSimplesAbsorcao(codigo: string | undefined): string {
  switch (codigo) {
    case "BULL_ABSORPTION":
      return "Ofertas de venda sendo absorvidas";
    case "BEAR_ABSORPTION":
      return "Ofertas de compra sendo absorvidas";
    case "NONE":
      return "Nenhuma";
    default:
      return codigo || "—";
  }
}

function rotuloSimplesDivergencia(codigo: string | undefined): string {
  switch (codigo) {
    case "DIVERGENCE_BULL":
    case "DIVERGENCE_BEAR":
      return "Preço e fluxo em direções opostas";
    case "NONE":
      return "Nenhuma";
    default:
      return codigo || "—";
  }
}

function rotuloSimplesFunding(codigo: string | undefined): string {
  switch (codigo) {
    case "positive":
      return "positiva";
    case "negative":
      return "negativa";
    case "neutral":
      return "neutra";
    case "extreme":
      return "extrema";
    default:
      return codigo || "—";
  }
}

export function SuperPainelUnificado() {
  const { data, status } = useMarketStreamContext();
  const [hist, setHist] = useState<PainelStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [leigo, setLeigo] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("painel-status.json", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as PainelStatus;
        if (active) setHist(body);
      } catch {
        /* gerador ainda não rodou — mantém "—" */
      }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const live = status === "live" && !!data;
  const histDate = hist ? fmtIso(hist.updatedAt) : "—";
  const db = data?.dbStats ?? null;
  const imbRaw = data ? data.imb : null;
  const imbPct = imbRaw !== null ? imbRaw * 100 : null;
  const imbPos = imbRaw !== null ? ((imbRaw + 1) / 2) * 100 : 50;
  const quality = data?.quality ?? { ws: "UNKNOWN", oi: "UNKNOWN", funding: "UNKNOWN" };
  const regime = rotuloRegime(data?.regime);
  const flow = rotuloFlow(data?.flow_regime);
  const divergence = rotuloDivergencia(data?.divergence);
  const absorption = rotuloAbsorcao(data?.absorption_state);
  // Série de preços dos eventos recentes (ordem cronológica) — só visual.
  const priceSeries = PC_HISTORY_ENABLED && hist ? [...hist.recent].reverse().map((e) => e.price).filter((p) => Number.isFinite(p)) : [];
  // Métricas de sessão compartilhadas (mesmo cálculo do Observatório).
  const sess = useSessionMetrics(data);

  return (
    <article className="card obsCard spu" id="painel-unificado">
      <div className="cardTitle">
        <div>
          <span>{leigo ? "FLUXO DO MERCADO" : "PAINEL BTCUSDT — MICROESTRUTURA & FLUXO"}</span>
          <b>{leigo ? "O que está acontecendo agora" : "Super Painel Unificado"}</b>
        </div>
        <button
          type="button"
          className="marketToggle"
          onClick={() => setLeigo((v) => !v)}
          title={leigo ? "Modo técnico" : "Modo leigo"}
        >
          {leigo ? "LEIGO" : "TÉCNICO"}
        </button>
      </div>

      <div className="spuLayout">
        {/* Sidebar de navegação (só âncoras e rotas existentes) */}
        <nav className="spuSide" aria-label="Navegação do painel">
          <span className="obsLabel">NAVEGAÇÃO</span>
          <a href="#spu-regime">Regime</a>
          <a href="#spu-fluxo">Fluxo</a>
          <a href="#spu-derivativos">Derivativos</a>
          <a href="#spu-micro">Microestrutura</a>
          <a href="#spu-whale">Whale</a>
          <a href="#spu-divergencias">Divergências</a>
          <a href="#spu-saude">Saúde</a>
          <a href="#spu-timeline">Timeline</a>
          <a href="#spu-alertas">Alertas</a>
          <a href="/definitivo">Definitivo <em>histórico</em></a>
          <a href="#experimento-v1-encerrado" className="spuSideClosed">Experimento V1 <em>encerrado</em></a>
        </nav>

        <div className="spuMain">
          {/* A. Cabeçalho: ativo, preço, sparkline, conexão, regime */}
          <div className="spuHead" role="status" aria-live="polite">
            <div className="spuPrice">
              <span className="obsLabel">BTCUSDT · PREÇO ATUAL</span>
              <b>{data ? `$${data.p.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}</b>
              <Spark values={priceSeries} />
              <span className="obsHint">{live && data ? `atualizado ${haQuanto(data.ts, now)} (${fmtHora(data.ts)})` : "sem dados do stream · verifique o daemon local"}</span>
            </div>
            <div className="spuConn">
              <span className={`spuLiveBadge spu-${live ? "green" : status === "connecting" || status === "reconnecting" ? "orange" : "red"}`}>
                <i />{live ? "AO VIVO" : "OFFLINE"}
              </span>
              <span className="spuSrcDots" title={`WS: ${quality.ws} · OI: ${quality.oi} · Funding: ${quality.funding}`}>
                {(["ws", "oi", "funding"] as const).map((k) => (
                  <em key={k} title={`${k.toUpperCase()}: ${quality[k]}`}>
                    <i style={{ background: quality[k] === "LIVE" ? tomDe("bull") : quality[k] === "STALE" ? tomDe("range") : tomDe("neutral") }} />{k.toUpperCase()}
                  </em>
                ))}
              </span>
              <span className="obsHint">stream :3001 · {status}</span>
            </div>
            <div className="spuRegime">
              <span className="obsLabel">REGIME ATUAL</span>
              <b className="spuBadge" style={{ color: tomDe(regime.tone), borderColor: tomDe(regime.tone) }}>{leigo ? rotuloSimplesRegime(data?.regime) : regime.label}</b>
              <span className="obsHint">neste estado {haQuanto(sess.since.regime, now)}</span>
            </div>
          </div>

          <div className="obsGrid">
            {/* B. Regime de preço */}
            <div className="obsCell" id="spu-regime">
              <span className="obsLabel">REGIME DE PREÇO</span>
              <Gauge value={data ? data.regime_confidence : 0} tone={regime.tone} label="Força do movimento (60s)" />
              <span className="obsHint">tamanho do movimento · não é probabilidade de acerto</span>
              <div className="obsState"><span>Volatilidade</span><b>{data ? `${data.regime_volatility.toFixed(4)}%` : "—"}</b></div>
              <div className="obsState"><span>Mudanças 24h / 7d</span><b>{hist ? `${hist.regimeChanges24h} / ${hist.regimeChanges7d}` : "—"}</b></div>
              {hist && Object.keys(hist.durations).length > 0 && Object.entries(hist.durations).map(([reg, d]) => (
                <div className="obsState" key={reg}>
                  <span>{rotuloRegime(reg).label}</span>
                  <b>{d.count} {d.count === 1 ? "mudança" : "mudanças"} · {d.avgMin < 1 ? "<1min" : `~${d.avgMin}min`}</b>
                </div>
              ))}
            </div>

            {/* C. Fluxo e estrutura */}
            <div className="obsCell" id="spu-fluxo">
              <span className="obsLabel">FLUXO E ESTRUTURA</span>
              <div className="spuImbBar" role="img" aria-label={`Book imbalance: ${imbPct !== null ? imbPct.toFixed(1) : "—"}%`}>
                <div className="spuImbTrack">
                  <i style={{ left: `${imbPos}%` }} />
                  <b className="spuImbPin" style={{ left: `${imbPos}%` }}>{imbPct !== null ? `${imbPct.toFixed(1)}%` : "—"}</b>
                </div>
                <div className="spuImbScale"><span>VENDA</span><span>COMPRA</span></div>
              </div>
              <div className="obsState"><span>{leigo ? "Fluxo" : "Regime de fluxo"}</span><b>{leigo ? rotuloSimplesFlow(data?.flow_regime) : flow.label}</b></div>
              <span className="obsHint">neste estado {haQuanto(sess.since.flow, now)}</span>
              <div className="obsState"><span>CVD</span><b>{data ? fmtUSD(data.cvd) : "—"}</b></div>
              <div className="obsState"><span>CVD whale</span><b>{data ? fmtUSD(data.cvd_whale) : "—"}</b></div>
              <div className="obsState"><span>CVD Δ15m</span><b style={{ color: (sess.cvdDelta ?? 0) > 0 ? tomDe("bull") : (sess.cvdDelta ?? 0) < 0 ? tomDe("bear") : tomDe("neutral") }}>{fmtSignedM(sess.cvdDelta)}</b></div>
              <div className="obsState"><span>CVD whale Δ15m</span><b style={{ color: (sess.cvdWhaleDelta ?? 0) > 0 ? tomDe("bull") : (sess.cvdWhaleDelta ?? 0) < 0 ? tomDe("bear") : tomDe("neutral") }}>{fmtSignedM(sess.cvdWhaleDelta)}</b></div>
              <div className="obsState"><span>Divergência</span><b style={{ color: data ? tomDe(divergence.tone) : undefined }}>{leigo ? rotuloSimplesDivergencia(data?.divergence) : divergence.label}</b></div>
              <div className="obsState"><span>Score do motor</span><b>{data ? `${data.score > 0 ? "+" : ""}${data.score}` : "—"}</b></div>
              <span className="obsHint">Score do motor e Concordância de sinais são variáveis diferentes.</span>
              <div className="obsState"><span>Concordância de sinais</span><b>{data ? `${data.score_quality}` : "—"}</b></div>
            </div>

            {/* D+H. Derivativos (bloco único, sem duplicar).
                ΔOI canônico: janela única de 1min (sess.oiDelta, buffer
                client-side). O valor de 5s do daemon (data.oi_delta) foi
                removido daqui por ser da mesma métrica em janela diferente e
                truncar para 0.000% (ver lib/oi-delta.ts). */}
            <div className="obsCell" id="spu-derivativos">
              <span className="obsLabel">DERIVATIVOS · OI / FUNDING</span>
              <div className="obsState"><span>{leigo ? "Dinheiro no mercado" : "Open Interest"}</span><b>{data ? fmtUSD(data.oi) : "—"}</b></div>
              <div className="obsState"><span>ΔOI / 1min</span><b>{sess.oiDelta ? `${fmtOiDelta(sess.oiDelta)} / 1min` : "—"}</b></div>
              <span className="obsHint">janela única de 1min para número e leitura</span>
              <div className="obsState"><span>{leigo ? "Custo de manutenção" : "Funding"}</span><b>{data ? `${(data.funding * 100).toFixed(4)}%` : "—"}</b></div>
              <div className="obsState"><span>Classe funding</span><b>{data ? (leigo ? rotuloSimplesFunding(data.funding_class) : rotuloFunding(data.funding_class)) : "—"}</b></div>
            </div>

            {/* F. Microestrutura */}
            <div className="obsCell" id="spu-micro">
              <span className="obsLabel">MICROESTRUTURA</span>
              <div className="obsState"><span>Absorção</span><b style={{ color: data ? tomDe(absorption.tone) : undefined }}>{leigo ? rotuloSimplesAbsorcao(data?.absorption_state) : absorption.label}</b></div>
              <span className="obsHint">neste estado {haQuanto(sess.since.abs, now)}</span>
              <div className="obsState"><span>Intensidade</span><b>{data ? `${(data.absorption_intensity * 100).toFixed(0)}%` : "—"}</b></div>
              <div className="obsState"><span>Imbalance</span><b>{data ? `${(data.imb * 100).toFixed(1)}%` : "—"}</b></div>
              <div className="obsState"><span>Divergência</span><b>{leigo ? rotuloSimplesDivergencia(data?.divergence) : divergence.label}</b></div>
              <span className="obsHint">neste estado {haQuanto(sess.since.div, now)}</span>
              <span className="obsHint">churn e transições por sessão no Observatório · sem duplicação de cálculo</span>
            </div>

            {/* W. Whale na sessão (mesma agregação do Observatório) */}
            <div className="obsCell" id="spu-whale">
              <span className="obsLabel">WHALE NA SESSÃO</span>
              <div className="obsWhale"><span style={{ color: "var(--lime)" }}>▲ {sess.whaleBuy} compras</span><b style={{ color: "var(--lime)" }}>{fmtUsdAdapt(sess.whaleMagBuy)}</b></div>
              <div className="obsWhale"><span style={{ color: "var(--red)" }}>▼ {sess.whaleSell} vendas</span><b style={{ color: "var(--red)" }}>{fmtUsdAdapt(sess.whaleMagSell)}</b></div>
            </div>

            {/* I. Saúde da coleta */}
            <div className="obsCell" id="spu-saude">
              <span className="obsLabel">SAÚDE DA COLETA</span>
              <div className="obsQuality">
                {(["ws", "oi", "funding"] as const).map((k) => (
                  <span key={k} title={`${k.toUpperCase()}: ${quality[k]}`}>
                    <i style={{ background: quality[k] === "LIVE" ? tomDe("bull") : quality[k] === "STALE" ? tomDe("range") : tomDe("neutral") }} />{k.toUpperCase()}
                  </span>
                ))}
              </div>
              {!PC_HISTORY_ENABLED ? (
                <span className="obsHint">Histórico pausado — JSON de {histDate}</span>
              ) : (
                <>
                  <div className="obsState"><span>Snapshots</span><b>{db ? db.snapshots.toLocaleString("pt-BR") : "—"}</b></div>
                  <div className="obsState"><span>Uptime efetivo</span><b>{db ? `${db.uptimeH.toFixed(1)}h` : "—"}</b></div>
                  <div className="obsState"><span>Gaps &gt;3min</span><b>{db ? `${db.gaps3min} total` : "—"}</b></div>
                  <span className="obsHint">histórico: {hist ? fmtIso(hist.updatedAt) : "gerador ainda não rodou…"}</span>
                </>
              )}
            </div>

            {/* G+J. Divergências + timeline */}
            <div className="obsCell spuWide" id="spu-divergencias">
              <span className="obsLabel">DIVERGÊNCIAS E EVENTOS RECENTES</span>
              <div className="obsState"><span>Divergência atual</span><b style={{ color: data ? tomDe(divergence.tone) : undefined }}>{divergence.label}</b></div>
              <div id="spu-timeline">
              {!PC_HISTORY_ENABLED ? (
                <span className="obsHint">Histórico pausado — JSON de {histDate}</span>
              ) : hist && hist.recent.length > 0 ? (
                hist.recent.slice(0, RECENT_SHOWN).map((e, i) => {
                  const sev = severidadeEvento(e.type);
                  return (
                <div className="obsState spuEvent" key={i}>
                  <i style={{ background: tomDe(sev.tone) }} />
                  <span>{fmtIso(e.t)}</span>
                  <b>{rotuloEvento(e.type, e.from, e.to)}</b>
                  <em style={{ color: tomDe(sev.tone) }}>{sev.nivel}</em>
                </div>
                  );
                })
              ) : (
                <span className="obsHint">aguardando artefato do gerador…</span>
              )}
              </div>
            </div>
          </div>

          {/* Card Visão Complementar */}
          <div className="obsCell spuWide">
            <span className="obsLabel">VISÃO COMPLEMENTAR</span>
            <div className="obsState"><span>Histórico detalhado e fallback</span><b><a href="/definitivo">Abrir o Definitivo</a> — rota de histórico, não a tela principal</b></div>
          </div>

          {/* K. Alertas (instância única do AlertPanel) */}
          <div className="obsCell spuWide" id="spu-alertas">
            <span className="obsLabel">ALERTAS — EVENTOS E CONDIÇÕES OBSERVADAS</span>
            <AlertPanel currency="USDT" />
          </div>

          <p className="obsFoot">Painel observacional — nenhuma probabilidade preditiva é exibida. Mostra o que os dados indicam agora, nunca o que acontecerá depois.</p>
          <p className="obsFoot spuLegend">Severidade do evento observado — ATENÇÃO: evento estrutural em acompanhamento · OBSERVAÇÃO: mudança de rotina para acompanhar · ENCERRADO: evento concluído · INFORMATIVO: atualização normal de estado.</p>
        </div>
      </div>
    </article>
  );
}
