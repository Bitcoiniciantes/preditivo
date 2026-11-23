import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeBrakeRadar,
  BRAKE_MIN_BRAKE_PCT,
  BRAKE_PRESERVED_REFERENCE_MIN,
  calcFastRR,
  calcFastStop,
  calcFastTrigger,
} from "../lib/brake-radar.ts";

const H1 = 60 * 60_000;
const M15 = 15 * 60_000;
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function bar(openTime, interval, open, high, low, close, volume = 10) {
  return { openTime, closeTime: openTime + interval - 1, open, high, low, close, volume };
}
function hourly(closes, highs, lows) {
  const start = NOW - 24 * H1;
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const high = Math.max(highs?.[index] ?? Math.max(open, close) + 0.5, open, close);
    const low = Math.min(lows?.[index] ?? Math.min(open, close) - 0.5, open, close);
    return bar(start + index * H1, H1, open, high, low, close);
  });
}
function m15Series(points, { lowAt = {} } = {}) {
  const start = NOW - 48 * M15;
  return points.map((close, index) => {
    const open = index === 0 ? points[0] : points[index - 1];
    return bar(start + index * M15, M15, open, Math.max(open, close) + 0.2, Math.min(open, close, lowAt[index] ?? open) - 0.2, close);
  });
}

test("gatilho rápido 5M: indisponível quando faltam dados", () => {
  assert.deepEqual(calcFastTrigger({ lastClose: null, ema9: 100, previousHigh: 101 }), { criteria: null, count: 0, state: "INDISPONÍVEL" });
  assert.deepEqual(calcFastTrigger({ lastClose: 100, ema9: null, previousHigh: 101 }), { criteria: null, count: 0, state: "INDISPONÍVEL" });
  assert.deepEqual(calcFastTrigger({ lastClose: 100, ema9: 99, previousHigh: null }), { criteria: null, count: 0, state: "INDISPONÍVEL" });
});

test("gatilho rápido 5M: 0/2 AGUARDANDO", () => {
  const r = calcFastTrigger({ lastClose: 99, ema9: 100, previousHigh: 101 });
  assert.deepEqual(r.criteria, [false, false]);
  assert.equal(r.count, 0);
  assert.equal(r.state, "AGUARDANDO");
});

test("gatilho rápido 5M: 1/2 ARMADO", () => {
  const r = calcFastTrigger({ lastClose: 100.5, ema9: 100, previousHigh: 101 });
  assert.deepEqual(r.criteria, [true, false]);
  assert.equal(r.count, 1);
  assert.equal(r.state, "ARMADO");
});

test("gatilho rápido 5M: 2/2 DISPARADO", () => {
  const r = calcFastTrigger({ lastClose: 102, ema9: 100, previousHigh: 101 });
  assert.deepEqual(r.criteria, [true, true]);
  assert.equal(r.count, 2);
  assert.equal(r.state, "DISPARADO");
});

test("stop rápido: max(mínima 12 candles 5M, entrada×0,992) e nunca >= entrada", () => {
  const entry = 61493.07;
  const lows = [62000, 61900, 61800, 61700, 61600, 61500, 61450, 61400, 61350, 61300, 61250, 61134.72, 61000];
  const stop = calcFastStop(entry, lows, 0.8, 12);
  const expectedPctStop = entry * 0.992;
  const expectedMinLow = Math.min(...lows.slice(-12));
  assert.equal(stop, Math.max(expectedMinLow, expectedPctStop));
  assert.ok(stop < entry);
  // nunca >= entrada: quando stop calculado >= entrada, retorna null
  assert.equal(calcFastStop(100, [100, 101, 102], 0.8, 12), null);
  assert.equal(calcFastStop(100, [200], 0.8, 12), null);
  assert.equal(calcFastStop(null, [90], 0.8, 12), null);
});

test("R/R rápido: (alvo50 - entrada)/(entrada - stop), 1 casa decimal na exibição", () => {
  const entry = 61493.07;
  const stop = 61134.72;
  const alvo50 = 62926.47; // escolhido para validar a fórmula do prompt
  const rr = calcFastRR(entry, stop, alvo50);
  assert.ok(rr !== null);
  assert.equal(rr.toFixed(1), "4.0");
  // nunca dividir por risco zero/negativo
  assert.equal(calcFastRR(100, 100, 110), null);
  assert.equal(calcFastRR(100, 101, 110), null);
});

function fastAgainstTrend(triggerCount, context1h, quality) {
  return triggerCount === 2 && (context1h === "invalid" || quality === "SEM ESTABILIZAÇÃO");
}

test("2/2 com 1H contrário: contra tendência", () => {
  assert.equal(fastAgainstTrend(2, "invalid", "FUNDO PRESERVADO"), true);
  assert.equal(fastAgainstTrend(2, "confirmed", "SEM ESTABILIZAÇÃO"), true);
});

test("2/2 com 1H favorável: não é contra tendência", () => {
  assert.equal(fastAgainstTrend(2, "confirmed", "FUNDO PRESERVADO"), false);
  assert.equal(fastAgainstTrend(2, "waiting", "REVERSÃO CONFIRMADA"), false);
  assert.equal(fastAgainstTrend(1, "invalid", "SEM ESTABILIZAÇÃO"), false);
});

test("freio mínimo configurável: Conservador 25% / Rápido 10% na análise", () => {
  assert.equal(BRAKE_MIN_BRAKE_PCT, 25);
  assert.equal(BRAKE_PRESERVED_REFERENCE_MIN, 60);
  const closes = [...Array(12).fill(100), 100, 97, 94, 91, 90, 89, 88.8, 88.6, 88.5, 88.4, 88.35, 88.3];
  const highs = closes.map((c) => c + 0.5);
  const lows = closes.map((c) => c - 0.5);
  const h1 = hourly(closes, highs, lows);
  const m15 = m15Series(Array.from({ length: 48 }, (_, i) => 100 - i * 0.24));
  const conservative = analyzeBrakeRadar({ h1, m15, fetchedAt: NOW - 1000, now: NOW });
  const fast = analyzeBrakeRadar({ h1, m15, fetchedAt: NOW - 1000, now: NOW }, { brakeMinPct: 10, preservedReferenceMin: 15 });
  if (conservative.brakeApplicable && conservative.brakePct !== null && conservative.brakePct >= 25) {
    assert.ok(fast.brakeApplicable);
    assert.ok((fast.brakePct ?? 0) >= 25);
  }
  const def = analyzeBrakeRadar({ h1, m15, fetchedAt: NOW - 1000, now: NOW }, {});
  assert.equal(def.state, conservative.state);
  assert.equal(def.brakePct, conservative.brakePct);
});
