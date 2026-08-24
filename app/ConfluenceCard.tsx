"use client";
import { useMemo, useState, useEffect } from "react";
import { ConfluenceEngine, type ActionableSignal, type SignalQuality } from "../lib/cross-validation";

// ── Fonte de dados deste widget (única, não confundir com o NEXUS) ──
// O ConfluenceCard cruza:
//   techScore → nota do `analyze` (lib/analysis.ts), candles do ativo selecionado;
//   flowScore/cvdWhale/fundingRate/oiDelta → snapshot do daemon `market-ingestion`
//     via WebSocket ws://localhost:3001 (MarketPanel → onFlowData).
// O NEXUS (ConfluencePanel) usa outro motor (lib/confluence.ts) com outra fonte
// (takerBuyVolume dos candles) — não é este componente e não deve ser alterado aqui.

type Props = {
  techScore: number;
  flowScore: number | null; // null = fluxo indisponível (daemon offline) — NUNCA 0
  cvdWhale: number | null;
  fundingRate?: number; // opcional; só relevante quando o fluxo está disponível
  openInterestExtreme?: boolean;
  techScoreTimestamp: number;
  techTimeframeMinutes: number;
};

const THRESHOLD = 20;
const NEAR_THRESHOLD = 5;

// ── Normalização de escala entre techScore e flowScore ──
// techScore: contínuo, clamp -100..+100 (lib/analysis.ts `analyze`).
// flowScore: soma discreta de componentes no daemon (features/score.ts) — trend ±20,
// momentum ±14, cvd ±8, derivatives ±8, liquidity ±6, risk -12..-6 → na prática
// raramente ultrapassa ±54, embora o snapshot o entregue como número inteiro.
// Comparar os dois com o mesmo threshold (±20) sem normalizar torna o flowScore
// sistematicamente sub-representado. A fórmula do techScore NÃO é alterada;
// apenas o flowScore é reescalado para a mesma faixa ±100 antes da avaliação.
const FLOW_SCORE_PRACTICAL_MAX = 54;

function normalizeFlowScore(score: number): number {
  const scaled = (score / FLOW_SCORE_PRACTICAL_MAX) * 100;
  return Math.max(-100, Math.min(100, scaled));
}

function getSignalStyle(signal: ActionableSignal) {
  const map: Record<ActionableSignal, { icon: string; color: string; bg: string; border: string }> = {
    ENTER_LONG: { icon: "🚀", color: "var(--lime)", bg: "rgba(84,184,90,.08)", border: "var(--lime)" },
    ENTER_SHORT: { icon: "📉", color: "var(--red)", bg: "rgba(255,91,103,.08)", border: "var(--red)" },
    DANGER_BULL_TRAP: { icon: "🚨", color: "var(--red)", bg: "rgba(255,91,103,.12)", border: "var(--red)" },
    DANGER_BEAR_TRAP: { icon: "🚨", color: "var(--cyan)", bg: "rgba(46,232,194,.12)", border: "var(--cyan)" },
    RISK_LIQUIDATION_SQUEEZE: { icon: "⚡", color: "#f0ad4e", bg: "rgba(240,173,78,.10)", border: "#f0ad4e" },
    WAIT: { icon: "⏸", color: "var(--muted)", bg: "transparent", border: "var(--line)" },
  };
  return map[signal];
}

function getMarkerColor(score: number): string {
  if (score > THRESHOLD) return "var(--lime)";
  if (score < -THRESHOLD) return "var(--red)";
  return "var(--muted)";
}

function ThresholdBar({ techScore, flowScore }: { techScore: number; flowScore: number }) {
  const techPct = Math.min(Math.max((techScore + 100) / 200, 0), 1) * 100;
  const flowPct = Math.min(Math.max((flowScore + 100) / 200, 0), 1) * 100;
  const thresholdPct = ((THRESHOLD + 100) / 200) * 100;
  const negThresholdPct = ((-THRESHOLD + 100) / 200) * 100;
  const zeroPct = 50;

  return (
    <div className="confluenceBar">
      <div className="confluenceBarTrack">
        {/* Zona vermelha: -100 a -20 */}
        <div className="confluenceBarZone confluenceBarZoneSell" style={{ left: 0, width: `${negThresholdPct}%` }} />
        {/* Zona neutra: -20 a +20 */}
        <div className="confluenceBarZone confluenceBarZoneNeutral" style={{ left: `${negThresholdPct}%`, width: `${thresholdPct - negThresholdPct}%` }} />
        {/* Zona verde: +20 a +100 */}
        <div className="confluenceBarZone confluenceBarZoneBuy" style={{ left: `${thresholdPct}%`, width: `${100 - thresholdPct}%` }} />
        {/* Limiares */}
        <div className="confluenceBarThreshold" style={{ left: `${thresholdPct}%` }} />
        <div className="confluenceBarThreshold" style={{ left: `${negThresholdPct}%` }} />
        {/* Zero */}
        <div className="confluenceBarZero" style={{ left: `${zeroPct}%` }} />
        {/* Marcadores */}
        <div className="confluenceBarMarker" style={{ left: `${techPct}%`, background: getMarkerColor(techScore), borderColor: "var(--ink)" }} title={`Técnico: ${techScore}`}>
          <span>T</span>
        </div>
        <div className="confluenceBarMarker" style={{ left: `${flowPct}%`, background: getMarkerColor(flowScore), borderColor: "var(--ink)" }} title={`Fluxo: ${flowScore}`}>
          <span>F</span>
        </div>
      </div>
      <div className="confluenceBarLabels">
        <span>-100</span>
        <span>-20</span>
        <span>0</span>
        <span>+20</span>
        <span>+100</span>
      </div>
    </div>
  );
}

function ActionTag({ signal }: { signal: ActionableSignal }) {
  const map: Record<ActionableSignal, { text: string; color: string; bg: string; pulse: boolean }> = {
    ENTER_LONG: { text: "ACEITAR LONG", color: "var(--ink)", bg: "var(--lime)", pulse: false },
    ENTER_SHORT: { text: "ACEITAR SHORT", color: "var(--ink)", bg: "var(--red)", pulse: false },
    DANGER_BULL_TRAP: { text: "🚨 NÃO COMPRAR", color: "#fff", bg: "var(--red)", pulse: true },
    DANGER_BEAR_TRAP: { text: "🚨 PREPARAR LONG", color: "var(--ink)", bg: "var(--cyan)", pulse: true },
    RISK_LIQUIDATION_SQUEEZE: { text: "⚡ REDUZIR POSIÇÃO", color: "var(--ink)", bg: "#f0ad4e", pulse: false },
    WAIT: { text: "NENHUMA AÇÃO", color: "var(--muted)", bg: "var(--line)", pulse: false },
  };
  const { text, color, bg, pulse } = map[signal];
  return (
    <span className={`confluenceAction ${pulse ? "confluenceActionPulse" : ""}`} style={{ color, background: bg }}>
      {text}
    </span>
  );
}

function FreshnessIndicator({ timestamp, quality }: { timestamp: number; quality: SignalQuality }) {
  const [age, setAge] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = Date.now() - timestamp;
      const min = Math.floor(diff / 60000);
      if (min < 1) setAge("agora");
      else if (min < 60) setAge(`${min}min`);
      else setAge(`${Math.floor(min / 60)}h${min % 60 > 0 ? `${min % 60}m` : ""}`);
    };
    update();
    const timer = setInterval(update, 10000);
    return () => clearInterval(timer);
  }, [timestamp]);

  if (quality === "DEGRADED") {
    return <span className="confluenceFreshness confluenceFreshnessDegraded">⚠ candle fechando — sinal em transição</span>;
  }
  return <span className="confluenceFreshness">🕐 atualizado há {age}</span>;
}

function DistanceToAlert({ techScore, flowScore }: { techScore: number; flowScore: number }) {
  const techDist = techScore > 0 ? THRESHOLD - techScore : Math.abs(techScore) - THRESHOLD;
  const flowDist = flowScore > 0 ? THRESHOLD - flowScore : Math.abs(flowScore) - THRESHOLD;

  const entries: { who: string; dist: number; danger: string }[] = [];
  if (techDist > 0 && techDist <= NEAR_THRESHOLD) {
    const danger = techScore > 0 ? "confluência bullish" : "bear trap";
    entries.push({ who: "Técnico", dist: techDist, danger });
  }
  if (flowDist > 0 && flowDist <= NEAR_THRESHOLD) {
    const danger = flowScore > 0 ? "confluência bearish" : "bull trap";
    entries.push({ who: "Fluxo", dist: flowDist, danger });
  }

  if (entries.length === 0) return null;

  return (
    <div className="confluenceDistance">
      {entries.map((e, i) => (
        <span key={i}>👁 {e.who} a {e.dist} pts de zona de risco ({e.danger})</span>
      ))}
    </div>
  );
}

export default function ConfluenceCard({
  techScore,
  flowScore,
  cvdWhale,
  fundingRate,
  openInterestExtreme,
  techScoreTimestamp,
  techTimeframeMinutes,
}: Props) {
  // Fluxo indisponível (daemon local offline): NÃO avaliar com flowScore=0.
  // Sem dado de fluxo, nenhuma conclusão de confluência pode ser emitida.
  const flowUnavailable = flowScore === null || flowScore === undefined;
  const flowScoreNormalized = flowScore === null || flowScore === undefined
    ? null
    : normalizeFlowScore(flowScore);

  const result = useMemo(() => {
    if (flowScoreNormalized === null || cvdWhale === null || cvdWhale === undefined) {
      return null;
    }
    return ConfluenceEngine.evaluate({
      techScore,
      flowScore: flowScoreNormalized,
      cvdWhale,
      fundingRate,
      openInterestExtreme,
      techScoreTimestamp,
      techTimeframeMinutes,
    });
  }, [techScore, flowScoreNormalized, cvdWhale, fundingRate, openInterestExtreme, techScoreTimestamp, techTimeframeMinutes]);

  // Estado "fluxo indisponível": exibe aviso, sem cenário/barra/ação.
  if (flowUnavailable) {
    return (
      <article className="card confluenceCard confluenceUnavailable" style={{ borderColor: "var(--line)", background: "transparent" }}>
        <div className="cardTitle">
          <div>
            <span>CONFLUÊNCIA TÉCNICO × FLUXO</span>
            <b>FLUXO INDISPONÍVEL</b>
          </div>
          <span className="confluenceIcon" style={{ color: "var(--muted)" }}>⛔</span>
        </div>
        <div className="confluenceBody">
          <p className="confluenceDescription">
            O daemon local de fluxo de mercado não está conectado (ws://localhost:3001).
            Sem dados de fluxo não é possível cruzar técnico × fluxo — nenhuma conclusão de
            confluência é emitida neste momento. O painel técnico continua ativo.
          </p>
        </div>
      </article>
    );
  }

  if (!result) {
    return null;
  }

  const { scenario, actionableSignal, description, signalQuality } = result;
  const style = getSignalStyle(actionableSignal);

  const techLabel = techScore > 0 ? `+${techScore}` : `${techScore}`;
  const flowLabel = flowScoreNormalized! > 0 ? `+${Math.round(flowScoreNormalized!)}` : `${Math.round(flowScoreNormalized!)}`;

  // Consolidação tensa
  const isTense = result.actionableSignal === "WAIT" && (
    Math.abs(techScore) >= THRESHOLD - NEAR_THRESHOLD && Math.abs(techScore) <= THRESHOLD ||
    Math.abs(flowScoreNormalized!) >= THRESHOLD - NEAR_THRESHOLD && Math.abs(flowScoreNormalized!) <= THRESHOLD
  );

  return (
    <article
      className="card confluenceCard"
      style={{
        borderColor: style.border,
        background: style.bg,
      }}
    >
      <div className="cardTitle">
        <div>
          <span>CONFLUÊNCIA TÉCNICO × FLUXO</span>
          <b>{scenario}{isTense ? <span style={{ color: "#f0ad4e", fontWeight: 900 }}> — TENSA</span> : ""}</b>
        </div>
        <div className="confluenceHeaderRight">
          <FreshnessIndicator timestamp={techScoreTimestamp} quality={signalQuality} />
          <span className="confluenceIcon" style={{ color: style.color }}>{style.icon}</span>
        </div>
      </div>

      <div className="confluenceBody">
        <div className="confluenceScores">
          <div className="confluenceScoreItem">
            <span className="confluenceScoreLabel">TÉCNICO</span>
            <span className="confluenceScoreValue" style={{ color: techScore > 0 ? "var(--lime)" : techScore < 0 ? "var(--red)" : "var(--muted)" }}>
              {techLabel}
            </span>
          </div>
          <span className="confluenceX">×</span>
          <div className="confluenceScoreItem">
            <span className="confluenceScoreLabel">FLUXO</span>
            <span className="confluenceScoreValue" style={{ color: flowScoreNormalized! > 0 ? "var(--lime)" : flowScoreNormalized! < 0 ? "var(--red)" : "var(--muted)" }}>
              {flowLabel}
            </span>
          </div>
        </div>

        <ThresholdBar techScore={techScore} flowScore={flowScoreNormalized!} />

        <DistanceToAlert techScore={techScore} flowScore={flowScoreNormalized!} />

        <p className="confluenceDescription">{description}</p>

        <ActionTag signal={actionableSignal} />
      </div>
    </article>
  );
}
