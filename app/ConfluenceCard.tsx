"use client";
import { useMemo, useState, useEffect } from "react";
import { ConfluenceEngine, type ActionableSignal, type SignalQuality } from "../lib/cross-validation";

type Props = {
  techScore: number;
  flowScore: number;
  cvdWhale: number;
  fundingRate?: number;
  openInterestExtreme?: boolean;
  techScoreTimestamp: number;
  techTimeframeMinutes: 60 | 240;
};

const THRESHOLD = 20;
const NEAR_THRESHOLD = 5;

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
  const result = useMemo(() => {
    return ConfluenceEngine.evaluate({
      techScore,
      flowScore,
      cvdWhale,
      fundingRate,
      openInterestExtreme,
      techScoreTimestamp,
      techTimeframeMinutes,
    });
  }, [techScore, flowScore, cvdWhale, fundingRate, openInterestExtreme, techScoreTimestamp, techTimeframeMinutes]);

  const { scenario, actionableSignal, description, signalQuality } = result;
  const style = getSignalStyle(actionableSignal);

  const techLabel = techScore > 0 ? `+${techScore}` : `${techScore}`;
  const flowLabel = flowScore > 0 ? `+${flowScore}` : `${flowScore}`;

  // Consolidação tensa
  const isTense = result.actionableSignal === "WAIT" && (
    Math.abs(techScore) >= THRESHOLD - NEAR_THRESHOLD && Math.abs(techScore) <= THRESHOLD ||
    Math.abs(flowScore) >= THRESHOLD - NEAR_THRESHOLD && Math.abs(flowScore) <= THRESHOLD
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
            <span className="confluenceScoreValue" style={{ color: flowScore > 0 ? "var(--lime)" : flowScore < 0 ? "var(--red)" : "var(--muted)" }}>
              {flowLabel}
            </span>
          </div>
        </div>

        <ThresholdBar techScore={techScore} flowScore={flowScore} />

        <DistanceToAlert techScore={techScore} flowScore={flowScore} />

        <p className="confluenceDescription">{description}</p>

        <ActionTag signal={actionableSignal} />
      </div>
    </article>
  );
}
