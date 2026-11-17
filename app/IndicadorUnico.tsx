"use client";
// app/IndicadorUnico.tsx — INDICADOR ÚNICO (Fase 1A).
//
// Consolida, sem redundância e SÓ com apresentação, os dados operacionais já
// existentes nos cinco painéis (Preditiva, Observatório, Confluência,
// Fluxo do Mercado, Painel Definitivo). Referência visual: Painel Definitivo.
//
// Fontes (as mesmas já existentes, sem nada novo):
// - tempo real: `useMarketStreamContext` (o WebSocket único do provider);
// - histórico/contagens: `public/painel-status.json` (artefato gerado pelo
//   script; leitura com a mesma cadência dos consumidores existentes).
//
// Regras duras: nenhum cálculo novo; dado ausente => "indisponível";
// nenhuma probabilidade preditiva; sem texto de ação ou projeção;
// vocabulário canônico vem de `./glossario`.
import { useEffect, useState } from "react";
import { useMarketStreamContext } from "./MarketStreamProvider";
import {
  COR_TOM,
  acaoEvento,
  rotuloAbsorcao,
  rotuloDestinoEvento,
  rotuloDivergencia,
  rotuloFlow,
  rotuloFunding,
  rotuloRegime,
  tomEvento,
} from "./glossario";

const REFRESH_MS = 60_000;
const RECENT_SHOWN = 12;
const PC_HISTORY_ENABLED = process.env.NEXT_PUBLIC_PC_HISTORY_ENABLED !== "0";

type HistoricoStatus = {
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

function fmtHora(t: number): string {
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

// Ponto de saúde a partir dos estados já existentes no snapshot.
// UNKNOWN/UNAVAILABLE = "pendente" (cinza, sem alarme); STALE = atenção.
function visualSaude(s: string): { color: string; hint: string } {
  if (s === "LIVE") return { color: COR_TOM.bull, hint: "normal" };
  if (s === "STALE") return { color: COR_TOM.range, hint: "atenção" };
  if (s === "UNKNOWN" || s === "UNAVAILABLE") return { color: COR_TOM.neutral, hint: "pendente" };
  return { color: COR_TOM.bear, hint: s };
}

function rotuloEvento(type: string, from: string | null, to: string): string {
  if (type === "regime_change") return `${rotuloRegime(from ?? "").label} → ${rotuloRegime(to).label}`;
  const acao = acaoEvento(type);
  if (!acao) return `${type} → ${to}`;
  return `${acao} → ${rotuloDestinoEvento(type, to)}`;
}

export function IndicadorUnico() {
  const { data, status } = useMarketStreamContext();
  const [hist, setHist] = useState<HistoricoStatus | null>(null);
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
        const body = (await res.json()) as HistoricoStatus;
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

  // Faixa de status — só o `status` já existente do stream (sem threshold novo).
  const op = !live
    ? status === "connecting" || status === "reconnecting"
      ? { cls: "warn", title: "● ATENÇÃO — COLETA ATRASADA" }
      : { cls: "bad", title: "● PROBLEMA — COLETA INDISPONÍVEL" }
    : { cls: "ok", title: "● SISTEMA OPERACIONAL" };

  const regime = rotuloRegime(data?.regime);
  const flow = rotuloFlow(data?.flow_regime);
  const absorcao = rotuloAbsorcao(data?.absorption_state);
  const divergencia = rotuloDivergencia(data?.divergence);
  const intensidade = data?.absorption_intensity;

  return (
    <article className="card obsCard" id="indicador-unico">
      <div className="cardTitle">
        <div>
          <span>INDICADOR ÚNICO</span>
          <b>Leitura operacional consolidada</b>
        </div>
      </div>

      {/* 1. Faixa de status */}
      <div className={`iuStatus ${op.cls}`} role="status" aria-live="polite">
        <b>{op.title}</b>
        <span>
          {live && data
            ? `Dados ao vivo · último dado ${haQuanto(data.ts, now)} (${fmtHora(data.ts)})`
            : data
              ? `Último dado ${haQuanto(data.ts, now)} · histórico: ${hist ? fmtIso(hist.updatedAt) : "—"}`
              : "Sem dados do stream · verifique o daemon local"}
        </span>
      </div>

      <div className="obsGrid">
        {/* 2. Regime */}
        <div className="obsCell">
          <span className="obsLabel">REGIME</span>
          <span className="iuBadge" style={{ color: COR_TOM[regime.tone] }}>
            {regime.label}
          </span>
          <div className="obsState"><span>Força do movimento (60s)</span><b>{data ? `${data.regime_confidence}%` : "—"}</b></div>
          {data && (
            <div className="iuBarTrack" aria-hidden="true">
              <i className="iuBarFill" style={{ width: `${data.regime_confidence}%`, background: COR_TOM[regime.tone] }} />
            </div>
          )}
          <span className="obsHint">tamanho do movimento · não é probabilidade de acerto</span>
          <div className="obsState"><span>Volatilidade</span><b>{data ? `${data.regime_volatility.toFixed(4)}%` : "—"}</b></div>
          <div className="obsState"><span>Score do motor</span><b>{data ? `${data.score > 0 ? "+" : ""}${data.score}` : "—"}</b></div>
          <div className="obsState"><span>Concordância de sinais</span><b>{data ? `${data.score_quality} / 100` : "—"}</b></div>
          <span className="obsHint">Score do motor e Concordância de sinais são variáveis diferentes</span>
        </div>

        {/* 3. Fluxo e estrutura */}
        <div className="obsCell">
          <span className="obsLabel">FLUXO E ESTRUTURA</span>
          <div className="obsState" title="O regime de fluxo é uma classificação composta por múltiplos sinais. Imbalance elevado pode coexistir com fluxo neutro — isso não significa que um sinal esteja anulando o outro."><span>Regime de fluxo</span><b style={{ color: data ? COR_TOM[flow.tone] : undefined }}>{flow.label}</b></div>
          <div className="obsState"><span>Book imbalance (instantâneo)</span><b>{data ? `${(data.imb >= 0 ? "+" : "")}${(data.imb * 100).toFixed(1)}%` : "—"}</b></div>
          <div className="obsState"><span>Absorção</span><b style={{ color: data ? COR_TOM[absorcao.tone] : undefined }}>{absorcao.label}</b></div>
          <div className="obsState"><span>Divergência</span><b style={{ color: data ? COR_TOM[divergencia.tone] : undefined }}>{divergencia.label}</b></div>
          <div className="obsState"><span>Intensidade</span><b>{intensidade === undefined || intensidade === null || !data ? "indisponível" : `${(intensidade * 100).toFixed(0)}%`}</b></div>
        </div>

        {/* 4. CVD / OI / Funding */}
        <div className="obsCell">
          <span className="obsLabel">CVD / OI / FUNDING</span>
          <div className="obsState"><span>CVD total</span><b>{data ? data.cvd.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</b></div>
          <div className="obsState"><span>CVD whale</span><b>{data ? data.cvd_whale.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</b></div>
          <div className="obsState"><span>OI</span><b>{data ? data.oi.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</b></div>
          <div className="obsState"><span>ΔOI</span><b>{data ? `${(data.oi_delta * 100).toFixed(3)}%` : "—"}</b></div>
          <div className="obsState"><span>Funding</span><b>{data ? `${(data.funding * 100).toFixed(4)}%` : "—"}</b></div>
          <div className="obsState"><span>Classe funding</span><b>{data ? rotuloFunding(data.funding_class) : "—"}</b></div>
        </div>

        {/* 5. Saúde da coleta */}
        <div className="obsCell">
          <span className="obsLabel">SAÚDE DA COLETA</span>
          <div className="obsQuality">
            {(["ws", "oi", "funding"] as const).map((k) => {
              const h = visualSaude(quality[k]);
              return (
                <span key={k} title={`${k.toUpperCase()}: ${quality[k]} (${h.hint})`}>
                  <i style={{ background: h.color }} />{k.toUpperCase()}
                </span>
              );
            })}
          </div>
          {!PC_HISTORY_ENABLED ? (
            <span className="obsHint">Histórico pausado — JSON de {histDate}</span>
          ) : (
            <>
              <div className="obsState"><span>Snapshots</span><b>{db ? db.snapshots.toLocaleString("pt-BR") : "—"}</b></div>
              <div className="obsState"><span>Uptime efetivo (snapshots ÷ 60)</span><b>{db ? `${db.uptimeH.toFixed(1)}h` : "—"}</b></div>
              <div className="obsState"><span>Segmentos</span><b>{db ? db.segments : "—"}</b></div>
              <div className="obsState"><span>Gaps &gt;3min</span><b>{db ? `${db.gaps3min} total` : "—"}</b></div>
            </>
          )}
        </div>

        {/* 6. Mudanças de regime + histórico */}
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
                    <span>{rotuloRegime(reg).label}</span>
                    <b>{d.count} {d.count === 1 ? "mudança" : "mudanças"} · {d.avgMin < 1 ? "<1min" : `~${d.avgMin}min`}</b>
                  </div>
                ))
              ) : (
                <span className="obsHint">aguardando artefato do gerador…</span>
              )}
              <span className="obsHint">base: mudanças de regime entre os últimos 50 eventos</span>
            </>
          )}
        </div>

        <div className="obsCell">
          <span className="obsLabel">HISTÓRICO RECENTE</span>
          {!PC_HISTORY_ENABLED ? (
            <span className="obsHint">Histórico pausado — JSON de {histDate}</span>
          ) : (
            <>
              <span className="obsHint">atualizado {hist ? `${haQuanto(Date.parse(hist.updatedAt), now)} · ${fmtIso(hist.updatedAt)}` : "—"}</span>
              {hist && hist.recent.length > 0 ? (
                hist.recent.slice(0, RECENT_SHOWN).map((e, i) => {
                  const tone = tomEvento(e.type, e.to);
                  const isRegime = e.type === "regime_change";
                  return (
                    <div className={`obsState iuHist tone-${tone}${isRegime ? " is-regime" : ""}`} key={i}>
                      <i style={{ background: COR_TOM[tone] }} />
                      <span>{fmtIso(e.t)}</span>
                      <b>{rotuloEvento(e.type, e.from, e.to)}</b>
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
        <p className="obsFoot">Probabilidade preditiva: bloqueada — gate Fase 1. Histórico gerado por scripts/painel-status.mjs (leitura read-only).</p>
      </div>
    </article>
  );
}
