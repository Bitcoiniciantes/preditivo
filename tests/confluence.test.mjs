import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "../lib/analysis.ts";
import { aggressorFlow, buildConfluence } from "../lib/confluence.ts";

function marketWithFlow(takerBuyVolume) {
  return {
    asset: "TESTE",
    pair: "TESTE/USDT",
    source: "fixture",
    updatedAt: 1,
    period: "1H",
    candles: Array.from({ length: 60 }, (_, index) => ({
      time: index * 60 * 60_000,
      open: 100 + index,
      high: 102 + index,
      low: 99 + index,
      close: 101 + index,
      volume: 100,
      ...(takerBuyVolume === undefined ? {} : { takerBuyVolume }),
    })),
  };
}

test("calcula o fluxo agressor sem inferir pela cor do candle", () => {
  const flow = aggressorFlow(marketWithFlow(70), 5);
  assert.ok(flow);
  assert.equal(flow.buyVolume, 350);
  assert.equal(flow.sellVolume, 150);
  assert.equal(flow.buyShare, 0.7);
  assert.ok(Math.abs(flow.deltaPercent - 40) < 0.000001);
});

test("recusa separar compra e venda quando a fonte n�o fornece o campo", () => {
  assert.equal(aggressorFlow(marketWithFlow(undefined), 5), null);
});

test("cruza as cinco m�tricas da nota com RSI e fluxo", () => {
  const market = marketWithFlow(70);
  const analysis = analyze(market);
  assert.ok(analysis);
  const nexus = buildConfluence(market, analysis, {
    rows: [],
    general: 62,
    previousGeneral: 58,
    bullCount: 5,
    bearCount: 1,
    signal: "VI�S DE ALTA",
  });
  assert.ok(nexus);
  assert.equal(nexus.rows.length, 5);
  assert.equal(nexus.flow.buyShare, 0.7);
  assert.equal(nexus.rsi, 62);
  assert.equal(nexus.state, "BUY");
  assert.ok(nexus.rows.every((row) => Number.isFinite(row.alignment)));
});

test("mantem o NEXUS parcial quando so o RSI esta disponivel", () => {
  const market = marketWithFlow(undefined);
  const analysis = analyze(market);
  assert.ok(analysis);
  const nexus = buildConfluence(market, analysis, {
    rows: [], general: 47, previousGeneral: 45, bullCount: 2, bearCount: 4, signal: "BAIXA",
  });
  assert.ok(nexus);
  assert.equal(nexus.flow, null);
  assert.equal(nexus.rsi, 47);
  assert.equal(nexus.rows.length, 5);
});
