import { CONFIG } from '../config.js';
import type { Regime } from '../types/index.js';

interface ScoreInput {
  regime: Regime;
  imbalance: number;
  cvdDelta: number;
  oiChange: number;
  fundingRate: number;
  priceChange: number;
}

interface ScoreResult {
  score: number;
  quality: number;
}

export function computeScore(input: ScoreInput): ScoreResult {
  const { regime, imbalance, cvdDelta, oiChange, fundingRate, priceChange } = input;

  let trendScore = 0;
  let momentumScore = 0;
  let volumeScore = 0;
  let derivativesScore = 0;
  let liquidityScore = 0;
  let cvdScore = 0;
  let riskScore = 0;

  // Trend (0 to +/-24)
  if (regime === 'TRENDING_UP') trendScore = 20;
  else if (regime === 'TRENDING_DOWN') trendScore = -20;
  else if (regime === 'RANGING') trendScore = 0;
  else if (regime === 'HIGH_VOLATILITY') trendScore = priceChange > 0 ? 10 : -10;
  else trendScore = 0;

  // Momentum (0 to +/-16)
  if (priceChange > 0.5) momentumScore = 14;
  else if (priceChange > 0.1) momentumScore = 8;
  else if (priceChange < -0.5) momentumScore = -14;
  else if (priceChange < -0.1) momentumScore = -8;

  // Volume/CVD (0 to +/-10)
  const cvdNorm = Math.max(-1, Math.min(1, cvdDelta / 1_000_000));
  cvdScore = Math.round(cvdNorm * 8);

  // Derivatives (0 to +/-10)
  if (oiChange > 0.02) derivativesScore = 8;
  else if (oiChange > 0.005) derivativesScore = 4;
  else if (oiChange < -0.02) derivativesScore = -8;
  else if (oiChange < -0.005) derivativesScore = -4;

  if (fundingRate > 0.001) derivativesScore -= 4;
  else if (fundingRate < -0.001) derivativesScore += 4;

  // Liquidity (0 to +/-8)
  if (imbalance > 0.3) liquidityScore = 6;
  else if (imbalance > 0.1) liquidityScore = 3;
  else if (imbalance < -0.3) liquidityScore = -6;
  else if (imbalance < -0.1) liquidityScore = -3;

  // Risk (-12 to 0)
  riskScore = regime === 'HIGH_VOLATILITY' ? -10 : regime === 'LOW_VOLATILITY' ? -2 : -6;

  const raw = trendScore + momentumScore + cvdScore + derivativesScore + liquidityScore + riskScore;
  const score = Math.max(-100, Math.min(100, raw));

  const signals = [trendScore, momentumScore, cvdScore, derivativesScore, liquidityScore].filter(s => s !== 0);
  const agreeing = signals.filter(s => Math.sign(s) === Math.sign(score)).length;
  const quality = signals.length > 0
    ? Math.round(55 + (agreeing / signals.length) * 45)
    : 55;

  return { score, quality };
}

export function scoreLabel(score: number): string {
  if (score >= 55) return 'COMPRA FORTE';
  if (score >= 20) return 'COMPRA';
  if (score >= 10) return 'VIÉS DE ALTA';
  if (score > -10) return 'NEUTRO';
  if (score > -20) return 'VIÉS DE BAIXA';
  if (score > -55) return 'VENDA';
  return 'VENDA FORTE';
}
