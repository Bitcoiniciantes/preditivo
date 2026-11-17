"use client";
// app/BtcTopRadar.tsx — CAÇA-TOPOS (BTCUSDT).
//
// Card do Radar de Exaustão de Alta. Recebe o mesmo snapshot fechado de 1h e
// 15m usado pelo Caça-Fundos; toda a matemática fica em lib/top-radar.ts.
// Não executa ordens, não calcula quantidade de venda e não afirma reversão
// definitiva da tendência.

import { useMemo } from "react";
import {
  analyzeTopRadar,
  TOP_MAX_CONFIRM_AGE_HOURS,
  TOP_MAX_WATCH_DRAWDOWN_PCT,
  TOP_MIN_DRAWDOWN_PCT,
  TOP_MIN_NO_NEW_HIGH_MINUTES,
  type TopRadarReading,
} from "../lib/top-radar";
import { formatPreservedMinutes, type BrakeKlinesSnapshot } from "../lib/brake-radar";

function fmtPct(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const absolute = Math.abs(rounded).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = rounded < 0 ? "−" : signed && rounded > 0 ? "+" : "";
  return `${sign}${absolute}%`;
}

function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

function fmtCurrentPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDailyChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function fmtTime(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function clampPct(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function returnTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "brMuted";
  const rounded = Math.round(value * 10) / 10;
  if (rounded < 0) return "brNegative";
  if (rounded > 0) return "brPositive";
  return "brMuted";
}

function drawdownTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "brMuted";
  if (value > TOP_MAX_WATCH_DRAWDOWN_PCT) return "brNegative";
  if (value >= TOP_MIN_DRAWDOWN_PCT) return "brCaution";
  return "brMuted";
}

function preservedTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "brMuted";
  if (value >= TOP_MIN_NO_NEW_HIGH_MINUTES) return "brCaution";
  return "brMuted";
}

function changeTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "brMuted";
  if (value > 0) return "brPositive";
  if (value < 0) return "brNegative";
  return "brMuted";
}

function barWidth(reading: TopRadarReading): number {
  if (reading.drawdownPct === null) return 0;
  return clampPct((reading.drawdownPct / TOP_MAX_WATCH_DRAWDOWN_PCT) * 100);
}

function peakAgeText(reading: TopRadarReading): string {
  return formatPreservedMinutes(reading.peakAgeMinutes);
}

function peakEligibilityText(reading: TopRadarReading): string {
  if (reading.maximum === null) return "—";
  if (reading.peakEligible) return `elegível (≤${TOP_MAX_CONFIRM_AGE_HOURS}h)`;
  return `fora da janela de ${TOP_MAX_CONFIRM_AGE_HOURS}h`;
}

function peakEligibilityTone(reading: TopRadarReading): string {
  if (reading.maximum === null) return "brMuted";
  return reading.peakEligible ? "brMuted" : "brCaution";
}

export function BtcTopRadar({
  snapshot,
  now,
  livePrice = null,
  dailyChangePct = null,
}: {
  snapshot: BrakeKlinesSnapshot | null;
  now: number;
  livePrice?: number | null;
  dailyChangePct?: number | null;
}) {
  const reading = useMemo(
    () => analyzeTopRadar({
      h1: snapshot?.h1 ?? [],
      m15: snapshot?.m15 ?? [],
      fetchedAt: snapshot?.fetchedAt ?? null,
      now,
    }),
    [snapshot, now],
  );

  const validLivePrice = livePrice !== null && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : null;
  // O preço principal é sempre a mesma referência dos cálculos de recuo.
  const referencePrice = reading.lastClose15m;
  const bar = barWidth(reading);
  const barMark = (TOP_MIN_DRAWDOWN_PCT / TOP_MAX_WATCH_DRAWDOWN_PCT) * 100;
  const hasDrawdown = reading.drawdownPct !== null;
  const criteriaMet = reading.criteria.filter((criterion) => criterion.met).length;

  return (
    <article
      className={`card brakeRadar topRadar tone-${reading.tone}`}
      aria-live="polite"
      aria-label="Caça-Topos: radar de exaustão de alta do Bitcoin"
    >
      <div className="brHead">
        <div className="brHeadMain">
          <h3 className="brTitle">BITCOIN — CAÇA-TOPOS</h3>
          <span className="brKicker">BTC/USDT · EXAUSTÃO DE ALTA</span>
          <div className="brState">{reading.label}</div>
        </div>
        <div className="brHeadSide">
          <span className="brBadge">{reading.badge}</span>
          <small className="brUpdated">Atualizado às {fmtTime(reading.updatedAt)}</small>
        </div>
      </div>

      <div className="brMetrics">
        <div className="brMetric">
          <span>MOVIMENTO RECENTE (3H)</span>
          <b className={returnTone(reading.recentReturnPct)}>{fmtPct(reading.recentReturnPct, true)}</b>
          <small className="brMetricSub">
            Anterior: <span className={returnTone(reading.previousReturnPct)}>{fmtPct(reading.previousReturnPct, true)}</span>
          </small>
        </div>
        <div className="brMetric">
          <span>RECUO DO TOPO</span>
          <b className={drawdownTone(reading.drawdownPct)}>{fmtPct(reading.drawdownPct)}</b>
          <small className="brMetricSub">
            {reading.beyondWatchWindow
              ? `acima da janela de ${fmtPct(TOP_MAX_WATCH_DRAWDOWN_PCT)}`
              : `janela ${fmtPct(TOP_MIN_DRAWDOWN_PCT)}–${fmtPct(TOP_MAX_WATCH_DRAWDOWN_PCT)}`}
          </small>
        </div>
        <div className="brMetric">
          <span>IDADE DO TOPO</span>
          <b className={preservedTone(reading.peakAgeMinutes)}>
            {peakAgeText(reading)}
          </b>
          <small className="brMetricSub">
            {reading.minutesWithoutNewHigh !== null
              ? `${formatPreservedMinutes(reading.minutesWithoutNewHigh)} em candles fechados`
              : `meta ${TOP_MIN_NO_NEW_HIGH_MINUTES} min`}
          </small>
        </div>
      </div>

      <div className={`brBarArea${hasDrawdown ? "" : " brBarAreaEmpty"}`}>
        <div className="brBarHead">
          <span>RECUO DA MÁXIMA MONITORADA (%)</span>
          {hasDrawdown ? <b>{fmtPct(reading.drawdownPct)}</b> : null}
        </div>
        {hasDrawdown && (
          <div
            className="brBarTrack trDrawdownTrack"
            role="progressbar"
            aria-label={`Recuo da máxima monitorada: ${fmtPct(reading.drawdownPct)}`}
            aria-valuemin={0}
            aria-valuemax={TOP_MAX_WATCH_DRAWDOWN_PCT}
            aria-valuenow={Math.round((reading.drawdownPct ?? 0) * 10) / 10}
          >
            <i style={{ width: `${bar}%` }} />
            <em style={{ left: `${barMark}%` }} title="Mínimo de 0,5% para recuo relevante" />
          </div>
        )}
      </div>

      <div className="brContext">
        <div className="brContextRefs">
          <span>Mínima de origem: <b>{fmtPrice(reading.originLow)}</b></span>
          <span>Máxima monitorada: <b>{fmtPrice(reading.maximum)}</b></span>
          <span>Alta até o topo: <b>{fmtPct(reading.riseToPeakPct, true)}</b></span>
          <span>Fechamento 15m (base do recuo): <b>{fmtPrice(reading.lastClose15m)}</b></span>
          <span>Janela do topo: <b className={peakEligibilityTone(reading)}>{peakEligibilityText(reading)}</b></span>
          <span>EMA9 15m: <b>{fmtPrice(reading.ema9_15m)}</b></span>
          <span>EMA9 1H: <b>{fmtPrice(reading.ema9_1h)}</b></span>
        </div>
        <div className="brCurrentPrice" aria-label="Preço de fechamento do último candle de 15 minutos do Bitcoin">
          <div className="brQuoteLine">
            <span className="brQuoteAsset">BTC · fechamento 15m:</span>
            <b>{fmtCurrentPrice(referencePrice)}</b>
          </div>
          {validLivePrice !== null && (
            <div className="brSpotReference">
              <span>Spot ao vivo (informativo): ${fmtCurrentPrice(validLivePrice)}</span>
              {dailyChangePct !== null && Number.isFinite(dailyChangePct) && (
                <small className={changeTone(dailyChangePct)}> {fmtDailyChange(dailyChangePct)} em 24h</small>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="brAction">
        <span className="brActionLabel">AÇÃO</span>
        <b>{reading.action}</b>
        <p>{reading.reason}</p>
      </div>

      <details className="trDiag">
        <summary>
          <span>DIAGNÓSTICO TÉCNICO</span>
          <b>
            {reading.state === "NEUTRAL"
              ? "alta relevante não atendida"
              : reading.originLost
                ? `${criteriaMet}/5 critérios históricos · origem perdida`
                : `${criteriaMet}/5 critérios · 1H ${reading.h1Filter.met ? "aprovado" : "reprovado"}`}
          </b>
        </summary>
        <div className="trDiagBody">
          <p className="trDiagVerdict">
            Mínima de origem {fmtPrice(reading.originLow)} · máxima {fmtPrice(reading.maximum)} ·
            alta até o topo {fmtPct(reading.riseToPeakPct, true)} · recuo {fmtPct(reading.drawdownPct)} ·
            idade {peakAgeText(reading)} · topo {peakEligibilityText(reading)} ·
            1H {reading.h1Filter.met ? "aprovado" : "reprovado"}.
          </p>
          <section className="trDiagGroup" aria-label="Cinco critérios de topo">
            <h4>Cinco critérios de topo</h4>
            <ul className="trList">
              {reading.criteria.map((criterion) => (
                <li key={criterion.id} className={criterion.met ? "trOk" : "trNo"}>
                  <span className="trMark" aria-hidden="true">{criterion.met ? "✓" : "×"}</span>
                  <span className="trText">
                    <b>{criterion.label}</b>
                    <small>{criterion.detail}</small>
                  </span>
                  <em>{criterion.value}</em>
                </li>
              ))}
            </ul>
            <p className="trDiagVerdict">
              {reading.state === "NEUTRAL"
                ? "A contagem acima é apenas auditoria dos critérios técnicos; ela não representa confirmação de topo enquanto a alta relevante não for atendida."
                : reading.originLost
                  ? `Critérios históricos: ${criteriaMet} de 5. A mínima de origem foi perdida em fechamento de 15m; não há novo gatilho.`
                  : `Critérios técnicos atendidos: ${criteriaMet} de 5. A confirmação exige todos e o filtro estrutural 1H.`}
            </p>
          </section>

          <section className="trDiagGroup" aria-label="Confirmação estrutural 1H">
            <h4>Confirmação estrutural 1H</h4>
            <ul className="trList">
              {reading.h1Filter.conditions.map((condition) => (
                <li key={condition.id} className={condition.met ? "trOk" : "trNo"}>
                  <span className="trMark" aria-hidden="true">{condition.met ? "✓" : "×"}</span>
                  <span className="trText">
                    <b>{condition.label}</b>
                    <small>{condition.detail}</small>
                  </span>
                  <em>{condition.value}</em>
                </li>
              ))}
            </ul>
            <p className="trDiagVerdict">
              {reading.h1Filter.met
                ? "Filtro 1H aprovado. A confirmação ainda exige os cinco critérios de topo."
                : "Filtro 1H reprovado. Ele não confirma exaustão sozinho e não substitui os cinco critérios."}
            </p>
          </section>
        </div>
      </details>

      <p className="brNote">
        Indicadores e ação: apenas candles fechados de 15m e 1h · cotação spot separada e informativa · Binance · atualização a cada 60s · não é recomendação,
        não executa ordens e não afirma reversão definitiva da tendência.
      </p>
    </article>
  );
}

export default BtcTopRadar;
