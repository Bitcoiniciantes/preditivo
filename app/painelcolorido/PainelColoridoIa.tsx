"use client";
// app/painelcolorido/PainelColoridoIa.tsx — Análise IA (local-only).
// Botão compacto na sidebar + resultado em popup (modal). Executa SOMENTE
// mediante clique explícito em "PEDIR ANÁLISE". Sem polling, sem auto-run,
// sem atualização por tick: a análise congela no snapshot da solicitação.
// O botão desabilita quando o stream não está LIVE, o snapshot tem mais de
// 15s, há requisição em andamento ou o cooldown local vigora.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PcIaError,
  fetchPcIa,
  readCachedPcIa,
  writeCachedPcIa,
  type PcIaAnalysis,
} from "../../lib/painelcolorido-ai";

type Status = "idle" | "loading" | "ok" | "erro";

const MAX_SNAPSHOT_AGE_S = 15;
const COOLDOWN_MS = 60_000;

function fmtHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}

function fmtSnapshotTs(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PainelColoridoIa({
  live,
  snapshotTs,
  snapshotAgeSec,
}: {
  live: boolean;
  snapshotTs: number | null;
  snapshotAgeSec: number | null;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [analysis, setAnalysis] = useState<PcIaAnalysis | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [open, setOpen] = useState(false);
  const cooldownUntil = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const hasAnalysisRef = useRef(false);

  useEffect(() => () => {
    requestRef.current?.abort();
  }, []);

  // Hidrata leitura salva (5min) sem disparar rede: cache antigo nunca finge
  // ser atual — a origem "LEITURA SALVA" e o horário de geração ficam visíveis.
  useEffect(() => {
    const cached = readCachedPcIa();
    if (cached) {
      hasAnalysisRef.current = true;
      setAnalysis(cached);
      setFromCache(true);
      setStatus("ok");
    }
  }, []);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setTimeout(() => setRetryAfter((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = window.setTimeout(() => {
      const left = Math.max(0, Math.ceil((cooldownUntil.current - Date.now()) / 1000));
      setCooldownLeft(left);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownLeft]);

  // Popup: Esc fecha + trava o scroll do fundo enquanto aberto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open ]);

  const stale = snapshotAgeSec === null || snapshotAgeSec > MAX_SNAPSHOT_AGE_S;
  const cooling = cooldownLeft > 0;
  const loading = status === "loading";
  const disabled = !live || stale || loading || cooling;

  const motivoBloqueio = !live
    ? "Aguardando stream LIVE."
    : stale
      ? "Snapshot desatualizado (>15s)."
      : cooling
        ? `Aguarde ${cooldownLeft}s para nova análise.`
        : "";

  const pedir = useCallback(async () => {
    if (requestRef.current || Date.now() < cooldownUntil.current) return;
    setError("");
    setRetryAfter(0);
    setFromCache(false);
    setStatus("loading");
    const controller = new AbortController();
    requestRef.current = controller;
    let ok = false;
    try {
      const result = await fetchPcIa(controller.signal);
      if (controller.signal.aborted) return;
      hasAnalysisRef.current = true;
      setAnalysis(result);
      writeCachedPcIa(result);
      ok = true;
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "Análise IA indisponível.";
      setError(message);
      setRetryAfter(cause instanceof PcIaError ? cause.retryAfterSeconds : 0);
    } finally {
      cooldownUntil.current = Date.now() + COOLDOWN_MS;
      setCooldownLeft(Math.ceil(COOLDOWN_MS / 1000));
      if (requestRef.current === controller) requestRef.current = null;
      // Mantém a última leitura válida visível quando a nova tentativa falha.
      setStatus(ok || hasAnalysisRef.current ? "ok" : "erro");
    }
  }, []);

  // Clique único na sidebar: abre o popup e já dispara a análise (clique
  // explícito). Com leitura em cache, o popup abre mostrando-a.
  const abrir = useCallback(() => {
    setOpen(true);
    if (!hasAnalysisRef.current) void pedir();
  }, [pedir]);

  return (
    <>
      <div className="pc-ia-side">
        <span className="pc-label">ANÁLISE IA</span>
        <button
          type="button"
          className="pc-ia-side-btn"
          onClick={abrir}
          title={motivoBloqueio || (analysis ? "Ver leitura da IA" : "Pedir leitura da IA")}
        >
          {loading ? "ANALISANDO…" : "🤖 PEDIR ANÁLISE"}
        </button>
        {motivoBloqueio && !loading && <small className="pc-hint">{motivoBloqueio}</small>}
        {analysis && !motivoBloqueio && !loading && (
          <small className="pc-hint">Leitura disponível — clique para ver.</small>
        )}
      </div>

      {open && (
        <div
          className="pc-ia-overlay"
          onClick={() => {
            if (!loading) setOpen(false);
          }}
        >
          <div
            className="pc-ia-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Análise IA da microestrutura"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pc-ia-modal-head">
              <div>
                <span className="pc-label">ANÁLISE IA · MICROESTRUTURA</span>
              </div>
              <button
                type="button"
                className="pc-ia-close"
                onClick={() => setOpen(false)}
                aria-label="Fechar análise"
                autoFocus
              >
                ×
              </button>
            </div>

            <div className="pc-ia-modal-body">
              <p className="pc-hint">
                Leitura assistida do snapshot atual do motor (preço, regime, fluxo, imbalance, CVD, OI, funding,
                divergência, absorção). Congelada no momento da solicitação.
              </p>

              <div className="pc-ia-actions">
                <button
                  type="button"
                  className="pc-btn pc-ia-btn"
                  onClick={() => void pedir()}
                  disabled={disabled}
                  title={motivoBloqueio || "Solicitar leitura da IA"}
                >
                  {loading ? "ANALISANDO…" : cooling ? `AGUARDE ${cooldownLeft}s` : "PEDIR ANÁLISE"}
                </button>
                {motivoBloqueio && !loading && <small className="pc-hint">{motivoBloqueio}</small>}
              </div>

              {status === "loading" && !analysis && (
                <p className="pc-hint" role="status">
                  Consultando a IA local…
                </p>
              )}

              {analysis && (
                <div className="pc-ia-result">
                  <small className="pc-ia-source" role="status">
                    {fromCache ? "LEITURA SALVA" : "LEITURA CONCLUÍDA"} • GERADA EM{" "}
                    {fmtHora(analysis.geradoEm).toUpperCase()}
                  </small>
                  <p className="pc-ia-snapshot">
                    Snapshot analisado: {fmtSnapshotTs(analysis.snapshotTs)} (idade {analysis.snapshotIdadeSeg}s no
                    envio)
                    {snapshotTs !== null && snapshotTs !== analysis.snapshotTs && (
                      <span> • painel agora em {fmtSnapshotTs(snapshotTs)} (leitura congelada acima)</span>
                    )}
                  </p>
                  <p className="pc-ia-text">{analysis.texto}</p>
                  <small className="pc-hint">Modelo: {analysis.modelo}</small>
                </div>
              )}

              {error && (
                <small className="pc-ia-error" role="alert">
                  {retryAfter > 0 ? `Limite temporário atingido. Aguarde ${retryAfter}s.` : error}
                </small>
              )}

              <p className="pc-ia-disclaimer">
                Leitura assistida da microestrutura. Não é recomendação de investimento.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
