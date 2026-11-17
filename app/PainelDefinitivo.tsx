"use client";
// PAINEL DEFINITIVO — seção operacional de leitura do sistema (fase
// volatilityFactor 5.0 + histerese 3→5). Só APRESENTA o que o motor já calcula:
//
// - tempo real: consome o MESMO WebSocket do MarketStreamProvider (nenhum socket
//   próprio) — regime, indicadores, qualidade, dbStats, timestamp do broadcast;
// - histórico de mudanças de regime: lê public/painel-status.json (ARTEFATO
//   GERADO por scripts/painel-status.mjs, refresh 60s) — nunca toca no banco.
//
// Regra dura: nenhuma probabilidade preditiva, nenhum cálculo estatístico, nenhum
// parâmetro alterado. Painel observacional — mesma disciplina do MarketObservatory.
// Refinamento visual: cores semânticas pontuais + hierarquia; o texto/estado segue
// sempre explícito (nunca só cor).
import { useEffect, useState } from "react";
import { useMarketStreamContext } from "./MarketStreamProvider";
import {
  rotuloRegime,
  rotuloFlow,
  rotuloDivergencia,
  rotuloAbsorcao,
  acaoEvento,
  tomEvento,
} from "./glossario";

const REFRESH_MS = 60_000;
const RECENT_SHOWN = 12;
const PC_HISTORY_ENABLED = process.env.NEXT_PUBLIC_PC_HISTORY_ENABLED !== "0";

// Paleta semântica (mesmos tokens do restante do painel; âmbar/roxo como literais
// já usados em MarketPanel/predictive — nada novo inventado).
const C = {
  bull: "var(--lime)",
  bear: "var(--red)",
  range: "#f0ad4e",
  neutral: "var(--muted)",
  info: "var(--cyan)",
  absorption: "#9b70ed",
  steady: "#8ea3b7",
} as const;

type Tone = keyof typeof C;

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

function basePrefix(): string {
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/preditivo")) return "/preditivo";
  return "";
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function agoMs(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m ${s % 60}s`;
  return `há ${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ── Rótulos canônicos (glossario.ts, Fase 1A) — sem duplicar nomenclatura local ──

function regimeLook(regime: string | undefined): { tone: Tone; label: string } {
  return rotuloRegime(regime);
}

function flowLook(flow: string | undefined): { tone: Tone; label: string } {
  return rotuloFlow(flow);
}

function divergenceLook(div: string | undefined): { tone: Tone; label: string } {
  return rotuloDivergencia(div);
}

function absorptionLook(abs: string | undefined): { tone: Tone; label: string } {
  return rotuloAbsorcao(abs);
}

// Cor do ponto de saúde a partir dos estados JÁ existentes no stream.
// UNKNOWN/UNAVAILABLE = "aguardando" (cinza, sem alarme); STALE = atenção (âmbar).
function healthLook(s: string): { color: string; hint: string } {
  if (s === "LIVE") return { color: C.bull, hint: "normal" };
  if (s === "STALE") return { color: C.range, hint: "atenção" };
  if (s === "UNKNOWN" || s === "UNAVAILABLE") return { color: C.neutral, hint: "aguardando" };
  return { color: C.bear, hint: s };
}

// Tom do marcador do histórico (glossário canônico).
function eventTone(e: PainelStatus["recent"][number]): Tone {
  return tomEvento(e.type, e.to);
}

// Ação textual do evento (glossário canônico; "divergence_resolved" =
// "Divergência confirmada" — sem segunda nomenclatura local).
function eventAction(type: string): string | null {
  return acaoEvento(type);
}

function eventLabel(e: PainelStatus["recent"][number]): string {
  if (e.type === "regime_change") return `${regimeLook(e.from ?? "").label} → ${regimeLook(e.to).label}`;
  const action = eventAction(e.type);
  if (!action) return `${e.type} → ${e.to}`;
  // Mantém o valor `to` à direita, traduzido com o rótulo conhecido de cada domínio.
  const toLabel = e.type === "flow_change"
    ? flowLook(e.to).label
    : e.type.startsWith("absorption")
      ? absorptionLook(e.to).label
      : e.type === "divergence"
        ? divergenceLook(e.to).label
        : regimeLook(e.to).label;
  return `${action} → ${toLabel}`;
}

export function PainelDefinitivo() {
  const { data, status } = useMarketStreamContext();
  const [hist, setHist] = useState<PainelStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch(`${basePrefix()}/painel-status.json`, { cache: "no-store" });
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
  const quality = data?.quality ?? { ws: "UNKNOWN", oi: "UNKNOWN", funding: "UNKNOWN" };

  // Estado operacional — só o `status` já existente do stream (sem threshold novo).
  const op = !live
    ? status === "connecting" || status === "reconnecting"
      ? { cls: "warn", title: "● ATENÇÃO — COLETA ATRASADA" }
      : { cls: "bad", title: "● PROBLEMA — COLETA INDISPONÍVEL" }
    : { cls: "ok", title: "● SISTEMA OPERACIONAL" };

  const regime = regimeLook(data?.regime);
  const flow = flowLook(data?.flow_regime);
  const divergence = divergenceLook(data?.divergence);
  const absorption = absorptionLook(data?.absorption_state);

  return (
    <article className="card obsCard" id="painel-definitivo">
      <div className="cardTitle">
        <div>
          <span>PAINEL DEFINITIVO</span>
          <b>Leitura operacional do sistema</b>
        </div>
      </div>

      {/* 1. Estado operacional da coleta */}
      <div className={`pdefStatus ${op.cls}`} role="status" aria-live="polite">
        <b>{op.title}</b>
        <span>
          {live && data
            ? `Coleta ativa · último dado ${agoMs(data.ts, now)} (${fmtTime(data.ts)})`
            : data
              ? `Último dado ${agoMs(data.ts, now)} · histórico: ${hist ? fmtIso(hist.updatedAt) : "gerador ainda não rodou…"}`
              : "Sem dados do stream · verifique o daemon local"}
        </span>
      </div>

      <div className="obsGrid">
        {/* 2 + 3. Regime atual, confiança e volatilidade */}
        <div className="obsCell">
          <span className="obsLabel">REGIME ATUAL</span>
          <span className={`pdefBadge tone-${regime.tone}`} style={{ color: C[regime.tone] }}>
            {regime.label}
          </span>
          <div className="obsState"><span>Confiança</span><b>{data ? `${data.regime_confidence}%` : "—"}</b></div>
          {data && (
            <div className="pdefBarTrack" aria-hidden="true">
              <i className="pdefBarFill" style={{ width: `${data.regime_confidence}%`, background: C[regime.tone] }} />
            </div>
          )}
          <span className="obsHint">confiança do regime · não é probabilidade de acerto</span>
          <div className="obsState"><span>Volatilidade</span><b>{data ? `${data.regime_volatility.toFixed(4)}%` : "—"}</b></div>
          <div className="obsState"><span>Score / qualidade</span><b>{data ? `${data.score} / ${data.score_quality}` : "—"}</b></div>
        </div>

        {/* 4. Fluxo e estrutura */}
        <div className="obsCell">
          <span className="obsLabel">FLUXO E ESTRUTURA</span>
          <div className="obsState"><span>Flow</span><b style={{ color: data ? C[flow.tone] : undefined }}>{flow.label}</b></div>
          <div className="obsState"><span>Força do fluxo</span><b>{data ? data.flow_strength.toFixed(1) : "—"}</b></div>
          <div className="obsState"><span>Divergência</span><b style={{ color: data ? C[divergence.tone] : undefined }}>{divergence.label}</b></div>
          <div className="obsState"><span>Absorção</span><b style={{ color: data ? C[absorption.tone] : undefined }}>{absorption.label}</b></div>
          <div className="obsState"><span>Intensidade</span><b>{data ? `${(data.absorption_intensity * 100).toFixed(0)}%` : "—"}</b></div>
        </div>

        {/* 5. Saúde da coleta */}
        <div className="obsCell">
          <span className="obsLabel">SAÚDE DA COLETA</span>
          <div className="obsQuality">
            {(["ws", "oi", "funding"] as const).map((k) => {
              const h = healthLook(quality[k]);
              return (
                <span key={k} title={`${k.toUpperCase()}: ${quality[k]} (${h.hint})`}>
                  <i style={{ background: h.color }} />{k.toUpperCase()}
                </span>
              );
            })}
          </div>
          <div className="obsState"><span>Snapshots</span><b>{db ? db.snapshots.toLocaleString("pt-BR") : "—"}</b></div>
          <div className="obsState"><span>Uptime efetivo</span><b>{db ? `${db.uptimeH.toFixed(1)}h` : "—"}</b></div>
          <div className="obsState"><span>Segmentos</span><b>{db ? db.segments : "—"}</b></div>
          <div className="obsState"><span>Gaps &gt;3min</span><b>{db ? `${db.gaps3min} total` : "—"}</b></div>
          <div className="obsState"><span>Regime events (total)</span><b>{hist ? hist.regimeEvents.toLocaleString("pt-BR") : "—"}</b></div>
          <span className="obsHint">histórico: {hist ? fmtIso(hist.updatedAt) : "gerador ainda não rodou…"}</span>
        </div>

        {/* 6. CVD / Book / Derivativos */}
        <div className="obsCell">
          <span className="obsLabel">CVD / BOOK / DERIVATIVOS</span>
          <div className="obsState"><span>CVD total</span><b>{data ? data.cvd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</b></div>
          <div className="obsState"><span>CVD whale</span><b>{data ? data.cvd_whale.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</b></div>
          <div className="obsState"><span>Imbalance</span><b>{data ? `${((data.imb ?? 0) * 100).toFixed(1)}%` : "—"}</b></div>
          <div className="obsState"><span>OI / ΔOI</span><b>{data ? `${data.oi.toLocaleString("en-US", { maximumFractionDigits: 0 })} / ${(data.oi_delta * 100).toFixed(3)}%` : "—"}</b></div>
          <div className="obsState"><span>Funding</span><b>{data ? `${(data.funding * 100).toFixed(4)}% (${data.funding_class})` : "—"}</b></div>
        </div>

        {/* 7a. Mudanças de regime */}
        <div className="obsCell">
          <span className="obsLabel">MUDANÇAS DE REGIME</span>
          {!PC_HISTORY_ENABLED ? (
            <span className="obsHint">Histórico pausado — JSON de {histDate}</span>
          ) : (
            <>
              <div className="obsState"><span>Últimas 24h</span><b>{hist ? `${hist.regimeChanges24h} mudanças` : "—"}</b></div>
              <div className="obsState"><span>Últimos 7d</span><b>{hist ? `${hist.regimeChanges7d} mudanças` : "—"}</b></div>
              {hist && Object.keys(hist.durations).length > 0 ? (
                Object.entries(hist.durations).map(([reg, d]) => (
                  <div className="obsState" key={reg}>
                    <span>{regimeLook(reg).label}</span>
                    <b>{d.count} {d.count === 1 ? "mudança" : "mudanças"} · {d.avgMin < 1 ? "<1min" : `~${d.avgMin}min`}</b>
                  </div>
                ))
              ) : (
                <span className="obsHint">aguardando artefato do gerador…</span>
              )}
              {hist && Object.keys(hist.durations).length > 0 && (
                <span className="obsHint">base: mudanças de regime entre os últimos 50 eventos</span>
              )}
            </>
          )}
        </div>

        {/* 7b. Histórico recente */}
        <div className="obsCell">
          <span className="obsLabel">HISTÓRICO RECENTE</span>
          {!PC_HISTORY_ENABLED ? (
            <span className="obsHint">Histórico pausado — JSON de {histDate}</span>
          ) : (
            <>
              <span className="obsHint">atualizado {hist ? `${agoMs(Date.parse(hist.updatedAt), now)} · ${fmtIso(hist.updatedAt)}` : "—"}</span>
              {hist && hist.recent.length > 0 ? (
                hist.recent.slice(0, RECENT_SHOWN).map((e, i) => {
                  const tone = eventTone(e);
                  const isRegime = e.type === "regime_change";
                  return (
                    <div className={`obsState pdefHist tone-${tone}${isRegime ? " is-regime" : ""}`} key={i}>
                      <i style={{ background: C[tone] }} />
                      <span>{fmtIso(e.t)}</span>
                      <b>{eventLabel(e)}</b>
                    </div>
                  );
                })
              ) : (
                <span className="obsHint">aguardando artefato do gerador…</span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="obsSummary">
        <p className="obsFoot">Painel observacional — nenhuma probabilidade preditiva é exibida (gate da Fase 1). Histórico gerado por scripts/painel-status.mjs (leitura read-only).</p>
      </div>
    </article>
  );
}
