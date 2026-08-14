import { completedCandles } from "./analysis.ts";
import type {
  Analysis,
  ConfluenceReading,
  FlowReading,
  MarketData,
  MultiRsi,
} from "./types";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const direction = (value: number, neutralBand = 0) =>
  value > neutralBand ? 1 : value < -neutralBand ? -1 : 0;

export function aggressorFlow(
  market: MarketData | null,
  window = 5,
  now = Date.now(),
): FlowReading | null {
  if (!market) return null;
  const candles = completedCandles(market.candles, market.period, now).slice(-window);
  if (
    candles.length < window ||
    candles.some(
      (candle) =>
        !Number.isFinite(candle.takerBuyVolume) ||
        candle.takerBuyVolume! < 0 ||
        candle.takerBuyVolume! > candle.volume,
    )
  ) return null;

  const buyVolume = candles.reduce((sum, candle) => sum + candle.takerBuyVolume!, 0);
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  if (totalVolume <= 0) return null;
  const sellVolume = Math.max(0, totalVolume - buyVolume);
  const buyShare = buyVolume / totalVolume;
  return {
    window,
    buyVolume,
    sellVolume,
    buyShare,
    deltaPercent: (buyShare * 2 - 1) * 100,
  };
}

export function buildConfluence(
  market: MarketData | null,
  analysis: Analysis | null,
  multiRsi: MultiRsi | null,
  now = Date.now(),
): ConfluenceReading | null {
  if (!analysis) return null;
  const flow = aggressorFlow(market, 5, now);
  if (!flow) return null;

  const rsi = multiRsi?.general ?? analysis.extreme.rsi;
  const rsiDirection = direction(rsi - 50, 5);
  const flowDirection = direction(flow.deltaPercent, 6);
  const scoringSignals = analysis.signals.filter((signal) => !signal.context);
  const rows = scoringSignals.map((signal) => {
    const metricDirection = direction(signal.score);
    const votes = [metricDirection, rsiDirection, flowDirection];
    const alignment = Math.round(
      votes.reduce((sum, vote) => sum + vote, 0) / votes.length * 100,
    );
    const hasConflict =
      metricDirection !== 0 && votes.some((vote) => vote === -metricDirection);
    const aligned =
      metricDirection !== 0 &&
      !hasConflict &&
      votes.filter((vote) => vote === metricDirection).length >= 2;
    return {
      metric: signal.group,
      baseScore: signal.score,
      alignment,
      status: aligned ? "aligned" as const : hasConflict ? "conflict" as const : "neutral" as const,
    };
  });

  const score = Math.round(clamp(
    analysis.score * 0.55 + (rsi - 50) * 0.8 + flow.deltaPercent * 0.65,
    -100,
    100,
  ));
  const directionalRows = rows.filter((row) => row.status !== "neutral");
  const agreement = directionalRows.length
    ? directionalRows.filter((row) => row.status === "aligned").length /
      directionalRows.length
    : 0;

  return {
    score,
    confidence: Math.round(45 + agreement * 45),
    state: score >= 20 ? "BUY" : score <= -20 ? "SELL" : "NEUTRAL",
    rsi,
    flow,
    rows,
  };
}
