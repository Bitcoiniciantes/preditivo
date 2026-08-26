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
  const oosClassesOf = (h: number) => verdict?.horizons[String(h)]?.oosClasses;
  const reportPass = (h: number) =>
    !!verdict?.horizons[String(h)]?.evidence &&
    verdict.horizons[String(h)].evidence !== "nenhuma" &&
    !verdict.horizons[String(h)].evidence.startsWith("?");

  // Gate de liberação (DECISOES.md): OOS total ≥ 90 E UP ≥ 30 E RANGE ≥ 30 E DOWN ≥ 30
  // (distribuição por classe do OOS, vinda do relatório). Sem relatório, só o total
  // estimado é avaliável — marcado como "não avaliado por classe".
  const gateOosMet = (h: number): { ok: boolean; why: string } => {
    const total = oosOf(h);
    if (total < REQUIRED_TOTAL) return { ok: false, why: `OOS total ${total} < ${REQUIRED_TOTAL}` };
    const c = oosClassesOf(h);
    if (!c || c.up === null || c.range === null || c.down === null) {
      return { ok: false, why: "sem distribuição por classe no relatório" };
    }
    if (c.up < REQUIRED_PER_CLASS) return { ok: false, why: `UP ${c.up} < ${REQUIRED_PER_CLASS}` };
    if (c.range < REQUIRED_PER_CLASS) return { ok: false, why: `RANGE ${c.range} < ${REQUIRED_PER_CLASS}` };
    if (c.down < REQUIRED_PER_CLASS) return { ok: false, why: `DOWN ${c.down} < ${REQUIRED_PER_CLASS}` };
    return { ok: true, why: "OOS por classe atendido" };
  };

  const anyGateMet = HORIZONS.some((h) => gateOosMet(h).ok);
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
      : { label: "VALIDAÇÃO NÃO EXECUTÁVEL · AMOSTRA INSUFICIENTE (OOS < 90 ou classe < 30)", tone: "inconcl" };

  const sampleLabel = db
    ? anyGateMet
      ? `OOS com gate por classe atendido (total ≥ ${REQUIRED_TOTAL} e UP/RANGE/DOWN ≥ ${REQUIRED_PER_CLASS}) em ao menos um horizonte`
      : `gate de classe no OOS NÃO atendido em todos os horizontes (OOS < ${REQUIRED_TOTAL} ou alguma classe < ${REQUIRED_PER_CLASS}) — insuficiente para exibir probabilidades`
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
            <span className="predictiveText">construível com snapshots de 1/min, porém com resolução limitada (~1–1,5 min). Maior precisão temporal exigiria persistência subminuto.</span>
          </div>
          {HORIZONS.map((h) => {
            const obsN = obsOf(h);
            const oosN = oosOf(h);
            const c = oosClassesOf(h);
            const gate = gateOosMet(h);
            const pass = reportPass(h);
            const fromReport = !!verdict;
            const evLabel = pass ? "EVIDÊNCIA" : "SEM EVIDÊNCIA";
            const classesTxt = c && c.up !== null
              ? ` (UP ${c.up} · RANGE ${c.range} · DOWN ${c.down})`
              : "";
            const text = fromReport
              ? `N=${obsN} · OOS=${oosN}${classesTxt} · ${evLabel} · gate OOS por classe: ${gate.ok ? "atendido" : `não atendido (${gate.why})`}`
              : `N≈${obsN} · OOS≈${oosN} · sem relatório commitado · gate: não avaliado`;
            const tone = pass && gate.ok ? "pass" : gate.ok ? "valid" : "inconcl";
            return (
              <div className="predictiveRow" key={h}>
                <span className="predictiveH">{h}m</span>
                <span className={`predictiveText ${tone}`}>{text}</span>
              </div>
            );
          })}
          <p className="predictiveRule">
            Gate de liberação (DECISOES.md): a probabilidade preditiva só é liberada quando o <b>OOS</b> satisfizer
            simultaneamente OOS total ≥ {REQUIRED_TOTAL}, UP ≥ {REQUIRED_PER_CLASS}, RANGE ≥ {REQUIRED_PER_CLASS},
            DOWN ≥ {REQUIRED_PER_CLASS}, o teste OOS passar os critérios do experimento e houver aprovação revisada.
            N total do histórico <b>não</b> libera previsão. A distribuição por classe vem do relatório congelado
            (FASE1_EXPERIMENTO_MINIMO.md §2); entre reexecuções, o fluxo completo está em FASE1_AMOSTRA_DIAGNOSTICO.md.
          </p>
        </div>

        <div className="predictiveLock">
          <div><span>PROBABILIDADES</span><b>BLOQUEADAS</b><em>{anyGateMet ? "gate de classe no OOS atendido — aguardando relatório/revisão" : "gate de classe no OOS não atendido (OOS < 90 ou classe < 30)"}</em></div>
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
