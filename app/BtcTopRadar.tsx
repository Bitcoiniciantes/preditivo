"use client";
// app/BtcTopRadar.tsx — CAÇA-TOPOS (BTCUSDT).
//
// Card do Radar de Exaustão de Alta. Recebe o mesmo snapshot fechado de 1h e
// 15m usado pelo Caça-Fundos; toda a matemática fica em lib/top-radar.ts.
// Não executa ordens, não calcula quantidade de venda e não afirma reversão
// definitiva da tendência.

import { useMemo, useState } from "react";
import {
  analyzeTopRadar,
  TOP_MAX_CONFIRM_AGE_HOURS,
  TOP_MAX_WATCH_DRAWDOWN_PCT,
  TOP_MIN_DRAWDOWN_PCT,
  TOP_MIN_NO_NEW_HIGH_MINUTES,
  type TopRadarReading,
} from "../lib/top-radar";
import { formatPreservedMinutes, type BrakeAssetSymbol, type BrakeKlinesSnapshot } from "../lib/brake-radar";
import { RadarMiniChart } from "./RadarMiniChart";

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
  // Mínimo de duas casas; preços baixos preservam mais casas para manter a
  // precisão da referência. Nunca arredonda 9,24 para 9.
  const magnitude = Math.floor(Math.log10(Math.abs(value) || 1));
  const digits = Math.max(2, Math.min(8, 2 - magnitude));
  return `$${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
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

type PriceTrend = "up" | "down" | "flat";

function priceTrendTone(trend: PriceTrend): string {
  if (trend === "up") return "brPositive";
  if (trend === "down") return "brNegative";
  return "brMuted";
}
void priceTrendTone;

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
  symbol = "BTCUSDT",
  assetName = "Bitcoin",
  snapshot,
  now,
  livePrice = null,
  dailyChangePct = null,
  quoteState = "loading",
  quoteUpdatedAt = null,
  chartState = "loading",
}: {
  symbol?: BrakeAssetSymbol;
  assetName?: string;
  snapshot: BrakeKlinesSnapshot | null;
  now: number;
  livePrice?: number | null;
  dailyChangePct?: number | null;
  quoteState?: "loading" | "ready" | "failed" | "stale";
  quoteUpdatedAt?: number | null;
  chartState?: "loading" | "ready" | "failed" | "stale";
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
  const validDailyChange = dailyChangePct !== null && Number.isFinite(dailyChangePct)
    ? dailyChangePct
    : null;
  const quoteView = quoteState === "loading" && validLivePrice === null
    ? "loading"
    : quoteState === "failed" && validLivePrice === null
      ? "failed"
      : quoteState === "stale" && validLivePrice !== null
        ? "stale"
        : "ready";
  const [priceTrend, setPriceTrend] = useState<PriceTrend>("flat");
  const [trackedQuote, setTrackedQuote] = useState<{ symbol: BrakeAssetSymbol; price: number } | null>(null);
  void priceTrend;

  // Mesma leitura do Caça-Fundos: o tom do preço segue o último movimento do
  // MESMO símbolo. Ao trocar de ativo o rastreio recomeça; na primeira leitura
  // o sinal de 24h serve de ponto de partida.
  if (validLivePrice !== null && (trackedQuote?.symbol !== symbol || trackedQuote.price !== validLivePrice)) {
    if (trackedQuote !== null && trackedQuote.symbol === symbol && trackedQuote.price > 0) {
      const delta = (validLivePrice / trackedQuote.price - 1) * 100;
      setPriceTrend(Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down");
    } else if (validDailyChange !== null && validDailyChange !== 0) {
      setPriceTrend(validDailyChange > 0 ? "up" : "down");
    } else {
      setPriceTrend("flat");
    }
    setTrackedQuote({ symbol, price: validLivePrice });
  }
  // Referência fechada de 15m usada apenas nos cálculos de recuo; a cotação
  // exibida acima é o spot atual e não altera nenhum critério.
  const referencePrice = reading.lastClose15m;
  // Máxima 24h para a coluna de referências (somente exibição; não altera cálculos).
  const maximum24h = (() => {
    const bars = (snapshot?.m15 ?? []).slice(-96);
    let max: number | null = null;
    for (const bar of bars) {
      const high = Number(bar.high);
      if (!Number.isFinite(high) || high <= 0) continue;
      if (max === null || high > max) max = high;
    }
    return max;
  })();
  const distanceBase = validLivePrice ?? reading.lastClose15m ?? null;
  const maximum24hDistancePct = maximum24h !== null && distanceBase !== null && distanceBase > 0
    ? ((maximum24h / distanceBase) - 1) * 100
    : null;
  const bar = barWidth(reading);
  const barMark = (TOP_MIN_DRAWDOWN_PCT / TOP_MAX_WATCH_DRAWDOWN_PCT) * 100;
  const hasDrawdown = reading.drawdownPct !== null;
  const criteriaMet = reading.criteria.filter((criterion) => criterion.met).length;

  return (
    <article
      className={`card brakeRadar topRadar tone-${reading.tone}`}
      aria-live="polite"
      aria-label={`Caça-Topos: radar de exaustão de alta de ${assetName}`}
    >
      <div className="brHead">
        <div className="brHeadMain">
          <h3 className="brTitle">{assetName.toUpperCase()} — CAÇA-TOPOS</h3>
          <span className="brKicker">{symbol} · EXAUSTÃO DE ALTA</span>
          <div className="brState">{reading.label}</div>
        </div>
        <div className={`brCurrentPrice brHeadQuote brHeadQuote-${quoteView === "ready" || quoteView === "stale" ? changeTone(validDailyChange) : "brMuted"}`} aria-label={`Cotação spot de ${symbol}`}>
          <div className="brQuoteLine">
            {quoteView === "loading" ? (
              <b className="brQuoteValue brQuoteLoading">Atualizando<span className="brLoadingDots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></b>
            ) : quoteView === "failed" ? (
              <b className="brQuoteValue brQuoteUnavailable">Sem conexão</b>
            ) : validLivePrice !== null ? (
              <>
                <b className={`brQuoteValue ${changeTone(validDailyChange)}`}>
                  ${fmtCurrentPrice(validLivePrice)}
                </b>
                {validDailyChange !== null && (
                  <small className={`brDailyChange ${changeTone(validDailyChange)}`}>
                    {fmtDailyChange(validDailyChange)}
                    <span className="brChangeWindow">24H</span>
                  </small>
                )}
              </>
            ) : null}
          </div>
          {quoteView === "loading" ? <small className="brQuoteRef">buscando Binance spot</small>
            : quoteView === "failed" ? <small className="brQuoteRef">nova tentativa em 60s</small>
              : quoteView === "stale" ? <small className="brQuoteRef">desatualizada · última às {fmtTime(quoteUpdatedAt)}</small>
                : referencePrice !== null && Number.isFinite(referencePrice) && (
            <small className="brQuoteRef">ref. cálculo (fech. 15M): {fmtCurrentPrice(referencePrice)}</small>
          )}
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

      <div className="brContext brFundContext">
        <div className="brFundLeft">
          <div className="brContextRefs">
            <div className="brContextRef brRefMaxima24">
              <span>
                Máx. 24h
                {maximum24hDistancePct !== null ? (
                  <small className="brRefLabelPct"> ({fmtPct(maximum24hDistancePct, true)}):</small>
                ) : (
                  ":"
                )}
              </span>
              <b className="brNegative">{fmtPrice(maximum24h)}</b>
            </div>
            <div className="brContextRef">
              <span>Mínima de origem:</span>
              <b>{fmtPrice(reading.originLow)}</b>
            </div>
            <div className="brContextRef">
              <span>Máxima monitorada:</span>
              <b>{fmtPrice(reading.maximum)}</b>
            </div>
            <div className="brContextRef">
              <span>Alta até o topo:</span>
              <b>{fmtPct(reading.riseToPeakPct, true)}</b>
            </div>
            <div className="brContextRef">
              <span>EMA9 15m:</span>
              <b>{fmtPrice(reading.ema9_15m)}</b>
            </div>
            <div className="brContextRef">
              <span>EMA9 1H:</span>
              <b>{fmtPrice(reading.ema9_1h)}</b>
            </div>
            <div className="brContextRef">
              <span>Janela do topo:</span>
              <b className={peakEligibilityTone(reading)}>{peakEligibilityText(reading)}</b>
            </div>
          </div>
        </div>
        <div className="brFundChart">
          <RadarMiniChart
            candles={snapshot?.m15 ?? []}
            symbol={symbol}
            maximum={reading.maximum}
            ema9={reading.ema9_15m}
            state={chartState}
          />
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
