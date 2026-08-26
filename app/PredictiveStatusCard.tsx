"use client";
// ANÁLISE PREDITIVA — painel de status do gate estatístico da Fase 1.
//
// Regra dura deste componente: nenhuma probabilidade preditiva é exibida enquanto o
// experimento congelado (scripts/fase1-experimento-minimo.mjs) não demonstrar evidência
// fora da amostra (out-of-sample PASS) E o gate abaixo não for explicitamente liberado
// em revisão. O bloco PREDICTIVE SIGNAL existe no código, mas é inalcançável enquanto
// PREDICTIVE_GATE === false.
//
// Gate de amostra (definição registrada em DECISOES.md): o N ≥ 30 POR CLASSE é exigido
// no conjunto onde a probabilidade é exibida — para liberar probabilidades preditivas,
// o TESTE/OOS deve satisfazer N ≥ 30 por classe (N total ≥ 90 com tercis do treino).
// N total ≥ 90 no conjunto inteiro NÃO é suficiente: a distribuição do OOS é o critério.
//
// Estados (vocabulário distinto — não confundir "validação executada sem evidência"
// com "amostra insuficiente"):
//   VALIDAÇÃO EXECUTADA · OOS: NENHUMA EVIDÊNCIA · PREDIÇÃO: BLOQUEADA
//     → quando há OOS suficiente para o gate de classe (≥ 90) e o relatório não replicou;
//   VALIDAÇÃO NÃO EXECUTÁVEL · AMOSTRA INSUFICIENTE (OOS < 90)
//     → quando o OOS ainda não atinge o mínimo por classe (caso atual);
//   PREDICTIVE SIGNAL → apenas com relatório PASS + PREDICTIVE_GATE liberado em revisão.
import { useMarketStreamContext } from "./MarketStreamProvider";
import { useFase1Verdict } from "./Fase1VerdictProvider";

// ── Gate (revisão explícita obrigatória) ──
// Só deve virar true após: (1) reexecutar o experimento congelado; (2) o relatório
// commitado mostrar out-of-sample PASS; (3) decisão registrada em DECISOES.md.
const PREDICTIVE_GATE = false;

// Regra: N ≥ 30 POR CLASSE no conjunto onde a probabilidade é exibida (OOS p/ predição).
// Com classes por tercis do treino (3 classes ~balanceadas): N total ≥ 90 no OOS.
const REQUIRED_PER_CLASS = 30;
const REQUIRED_TOTAL = REQUIRED_PER_CLASS * 3; // 90
const HORIZONS = [5, 15, 30] as const;
// Ativação do saveEvent() (schema v2, commit 1bf6425) — início do histórico de whale events.
const WHALE_HISTORY_START = "2026-08-25 23:07Z";

function fmtH(h: number): string {
  return `${h.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
}

export function PredictiveStatusCard() {
  const { data, status } = useMarketStreamContext();
  const verdict = useFase1Verdict();

  const db = data?.dbStats ?? null;
  const uptimeMin = (db?.uptimeH ?? 0) * 60;
  const estN = (h: number) => Math.floor(uptimeMin / h);

  // N do relatório congelado (autoritativo); fallback para a estimativa por volume.
  const obsOf = (h: number) => verdict?.horizons[String(h)]?.obs ?? estN(h);
  const oosOf = (h: number) => verdict?.horizons[String(h)]?.test ?? estN(h);
  const reportPass = (h: number) =>
    !!verdict?.horizons[String(h)]?.evidence &&
    verdict.horizons[String(h)].evidence !== "nenhuma" &&
    !verdict.horizons[String(h)].evidence.startsWith("?");

  // O gate por classe é medido NO OOS.
  const gateOosMet = (h: number) => oosOf(h) >= REQUIRED_TOTAL;
  const anyGateMet = HORIZONS.some(gateOosMet);
  const anyPass = HORIZONS.some(reportPass);
  const signalReady = PREDICTIVE_GATE && anyPass && anyGateMet;

  const headline = !verdict
    ? "SEM RELATÓRIO — experimento congelado ainda não executado/commitado"
    : verdict.conclusion?.includes("NÃO suportada")
      ? "HIPÓTESE: NÃO SUPORTADA (até aqui)"
      : verdict.conclusion?.includes("evidência preliminar")
        ? "HIPÓTESE: EVIDÊNCIA PRELIMINAR (aguardando gate)"
        : "HIPÓTESE: INDEFINIDA (relatório sem conclusão reconhecida)";

  const badge = signalReady
    ? { label: "PREDICTIVE SIGNAL", tone: "pass" }
    : anyGateMet
      ? { label: "VALIDAÇÃO EXECUTADA · OOS: NENHUMA EVIDÊNCIA · PREDIÇÃO: BLOQUEADA", tone: "valid" }
      : { label: "VALIDAÇÃO NÃO EXECUTÁVEL · AMOSTRA INSUFICIENTE (OOS < 90)", tone: "inconcl" };

  const sampleLabel = db
    ? anyGateMet
      ? `OOS com N total ≥ ${REQUIRED_TOTAL} (⇒ ≈${REQUIRED_PER_CLASS} por classe) em ao menos um horizonte — gate de classe no OOS atendido`
      : `OOS < ${REQUIRED_TOTAL} em todos os horizontes ⇒ gate de classe no OOS NÃO atendido (insuficiente para exibir probabilidades)`
    : "—";

  return (
    <article className="card predictiveCard">
      <div className="cardTitle">
        <div>
          <span>ANÁLISE PREDITIVA</span>
          <b>Gate estatístico da Fase 1</b>
        </div>
        <span className={`predictiveStatus ${badge.tone}`} title={badge.label}>{badge.label.split("·")[0].trim()}</span>
      </div>

      <div className="predictiveBody">
        <p className={`predictiveHeadline ${anyPass && anyGateMet ? "pass" : anyGateMet ? "valid" : "inconcl"}`}>{headline}</p>

        <div className="predictiveSummary">
          <div>
            <span>AMOSTRA (gate por classe = OOS)</span>
            <b>{sampleLabel}</b>
          </div>
          <div>
            <span>DADOS ACUMULADOS (SQLite)</span>
            {db ? (
              <>
                <b>
                  HISTÓRICO GERAL (snapshots, desde o início da coleta):<br />
                  {fmtH(db.uptimeH)} efetivas · {db.snapshots.toLocaleString("pt-BR")} snapshots · {db.segments} segmentos
                </b>
                <b>
                  HISTÓRICO WHALE EVENTS (desde a ativação do saveEvent — {WHALE_HISTORY_START}):<br />
                  {db.whaleEvents.toLocaleString("pt-BR")} eventos · span {db.whaleSpanMin.toFixed(0)} min
                </b>
              </>
            ) : status === "live" ? (
              <b>aguardando dbStats do daemon…</b>
            ) : (
              <b>backend offline</b>
            )}
          </div>
        </div>

        <div className="predictiveHorizons">
          <div className="predictiveRow">
            <span className="predictiveH">1m</span>
            <span className="predictiveText">aguardando validação — exige dados subminuto (snapshots atuais: 1/min)</span>
          </div>
          {HORIZONS.map((h) => {
            const obsN = obsOf(h);
            const oosN = oosOf(h);
            const gate = gateOosMet(h);
            const pass = reportPass(h);
            const fromReport = !!verdict;
            const evLabel = pass ? "EVIDÊNCIA" : "SEM EVIDÊNCIA";
            const text = fromReport
              ? `N=${obsN} · OOS=${oosN} · ${evLabel} · gate OOS (≥30/classe): ${gate ? "atendido" : `não atendido (OOS<${REQUIRED_TOTAL})`}`
              : `N≈${obsN} · OOS≈${oosN} · sem relatório commitado · gate: não avaliado`;
            const tone = pass && gate ? "pass" : gate ? "valid" : "inconcl";
            return (
              <div className="predictiveRow" key={h}>
                <span className="predictiveH">{h}m</span>
                <span className={`predictiveText ${tone}`}>{text}</span>
              </div>
            );
          })}
          <p className="predictiveRule">
            Gate N ≥ {REQUIRED_PER_CLASS} por classe aplicado ao conjunto onde a probabilidade é exibida:
            para liberar probabilidades preditivas, o <b>TESTE/OOS</b> precisa de N total ≥ {REQUIRED_TOTAL}
            (≈{REQUIRED_PER_CLASS} por classe com tercis do treino). N total ≥ {REQUIRED_TOTAL} no conjunto
            inteiro <b>não</b> é suficiente — a distribuição do OOS é o critério (DECISOES.md). Os N exibidos
            vêm do relatório congelado commitado; entre reexecuções, o fluxo completo está em FASE1_AMOSTRA_DIAGNOSTICO.md.
          </p>
        </div>

        <div className="predictiveLock">
          <div><span>PROBABILIDADES</span><b>BLOQUEADAS</b><em>{anyGateMet ? "gate de classe no OOS atendido — aguardando relatório" : "OOS < 90 ⇒ < 30 por classe"}</em></div>
          <div><span>MODELO</span><b>CONGELADO</b><em>sem alterações</em></div>
          <div><span>EXPERIMENTO</span><b>CONGELADO</b><em>scripts/fase1-experimento-minimo.mjs</em></div>
          <div><span>COLETA</span><b>ATIVA</b><em>{db ? `${fmtH(db.uptimeH)} efetivas · ${db.whaleEvents.toLocaleString("pt-BR")} whale events` : "daemon offline"}</em></div>
        </div>

        {verdict?.conclusion && (
          <p className="predictiveVerdict">
            Último relatório ({verdict.generatedAt ?? "data desconhecida"}): {verdict.conclusion}
          </p>
        )}

        {/* Bloco PREDICTIVE SIGNAL — inalcançável enquanto PREDICTIVE_GATE === false.
            Probabilidades viriam SOMENTE do relatório congelado commitado; nada é calculado aqui. */}
        {signalReady && (
          <div className="predictiveSignal">
            <div className="predictiveBars">
              {[
                { label: "UP", value: 57, color: "var(--lime)" },
                { label: "RANGE", value: 29, color: "#f0ad4e" },
                { label: "DOWN", value: 14, color: "var(--red)" },
              ].map((b) => (
                <div className="predictiveBar" key={b.label}>
                  <span>{b.label}</span>
                  <div className="predictiveBarTrack">
                    <i style={{ width: `${b.value}%`, background: b.color }} />
                  </div>
                  <b>{b.value}%</b>
                </div>
              ))}
            </div>
            <p>
              Confidence: … · Historical N: … · Out-of-sample: <b style={{ color: "var(--lime)" }}>PASS</b>
            </p>
          </div>
        )}

        <p className="predictiveFoot">
          Sem inventar probabilidades. Nenhuma probabilidade preditiva é exibida enquanto o gate estatístico
          (out-of-sample PASS, N ≥ 30 por classe no OOS) não for atingido e liberado em revisão (DECISOES.md).
        </p>
      </div>
    </article>
  );
}
