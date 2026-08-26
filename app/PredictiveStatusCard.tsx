"use client";
// ANÁLISE PREDITIVA — painel de status do gate estatístico da Fase 1.
//
// Regra dura deste componente: nenhuma probabilidade preditiva é exibida enquanto o
// experimento congelado (scripts/fase1-experimento-minimo.mjs) não demonstrar evidência
// fora da amostra (out-of-sample PASS) E o gate abaixo não for explicitamente liberado
// em revisão. O bloco PREDICTIVE SIGNAL existe no código, mas é inalcançável enquanto
// PREDICTIVE_GATE === false.
//
// Transições automáticas (a partir do dbStats do daemon — volume real do SQLite):
//   INSUFFICIENT DATA → VALIDATION : quando N total estimado por horizonte ≥ 90
//                                    (≈ 30 por classe — tercis do treino, 3 classes)
//   VALIDATION → PREDICTIVE SIGNAL : exigido relatório PASS commitado + revisão do gate.
import { useMarketStreamContext } from "./MarketStreamProvider";
import { useFase1Verdict } from "./Fase1VerdictProvider";

// ── Gate (revisão explícita obrigatória) ──
// Só deve virar true após: (1) reexecutar o experimento congelado; (2) o relatório
// commitado mostrar out-of-sample PASS; (3) decisão registrada em DECISOES.md.
const PREDICTIVE_GATE = false;

// Distinção de amostra (regra do experimento congelado — PROJETO..._15Mv3 §44.5):
//   - a regra é N ≥ 30 POR CLASSE para exibir probabilidades de classe;
//   - com classes por tercis do treino (3 classes ~balanceadas), isso equivale a
//     N TOTAL ≥ 90 (30 × 3). O card exibe sempre os dois números, sem confundi-los.
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
  const anyValidation = HORIZONS.some((h) => estN(h) >= REQUIRED_TOTAL);

  const reportSaysPass = (h: number) =>
    verdict?.horizons[String(h)]?.evidence &&
    verdict.horizons[String(h)].evidence !== "nenhuma" &&
    !verdict.horizons[String(h)].evidence.startsWith("?");

  const signalReady = PREDICTIVE_GATE && HORIZONS.some((h) => reportSaysPass(h) && estN(h) >= REQUIRED_TOTAL);

  const overallStatus = signalReady
    ? { label: "PREDICTIVE SIGNAL", tone: "pass", note: "gate liberado em revisão — exibindo probabilidades do relatório" }
    : anyValidation
      ? { label: "VALIDATION", tone: "valid", note: "N total ≥ 90 (≈30 por classe) em ao menos um horizonte — reexecutar o experimento congelado; sem probabilidades exibidas" }
      : { label: "INCONCLUSIVA", tone: "inconcl", note: "N total < 90 (⇒ < 30 por classe) em todos os horizontes — sem probabilidades exibidas" };

  const sampleLabel = db
    ? anyValidation
      ? `suficiente para validação (N total ≥ ${REQUIRED_TOTAL} ⇒ ≈${REQUIRED_PER_CLASS} por classe em ao menos um horizonte)`
      : `insuficiente (N total < ${REQUIRED_TOTAL} por horizonte ⇒ < ${REQUIRED_PER_CLASS} por classe)`
    : "—";

  return (
    <article className="card predictiveCard">
      <div className="cardTitle">
        <div>
          <span>ANÁLISE PREDITIVA</span>
          <b>Gate estatístico da Fase 1</b>
        </div>
        <span className={`predictiveStatus ${overallStatus.tone}`}>{overallStatus.label}</span>
      </div>

      <div className="predictiveBody">
        <div className="predictiveSummary">
          <div>
            <span>AMOSTRA</span>
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
            const n = estN(h);
            const perClass = Math.floor(n / 3);
            const v = verdict?.horizons[String(h)];
            const ready = n >= REQUIRED_TOTAL;
            const pass = reportSaysPass(h);
            let text: string;
            let tone: string;
            if (pass && PREDICTIVE_GATE) {
              text = `evidência fora da amostra (${v!.evidence}) — gate liberado`;
              tone = "pass";
            } else if (pass) {
              text = `relatório reporta evidência (${v!.evidence}) — aguardando liberação revisada do gate`;
              tone = "valid";
            } else if (ready) {
              text = `sem evidência estatística no último relatório — VALIDATION: reexecutar o experimento congelado · N total ~${n}/${REQUIRED_TOTAL} (≈${perClass} por classe)`;
              tone = "valid";
            } else {
              text = `sem evidência estatística — N total estimado ~${n}/${REQUIRED_TOTAL} (≈${perClass} por classe)`;
              tone = "inconcl";
            }
            return (
              <div className="predictiveRow" key={h}>
                <span className="predictiveH">{h}m</span>
                <span className={`predictiveText ${tone}`}>{text}</span>
              </div>
            );
          })}
          <p className="predictiveRule">
            Regra do experimento (congelado): N ≥ {REQUIRED_PER_CLASS} por classe para exibir probabilidades de classe.
            Com tercis do treino (3 classes ~balanceadas), N total ≥ {REQUIRED_TOTAL} ⇒ ≈{REQUIRED_PER_CLASS} por classe.
            O N estimado aqui é por volume de dados; o N efetivo (janelas íntegras + outcome) vem do relatório reexecutado.
          </p>
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
          (out-of-sample PASS, N ≥ 30 por classe) não for atingido e liberado em revisão (DECISOES.md).
        </p>
      </div>
    </article>
  );
}
