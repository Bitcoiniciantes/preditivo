import assert from "node:assert/strict";
import test from "node:test";
import { calculatePosition } from "../lib/positions.ts";

test("calcula ganho de posicao comprada", () => {
  const result = calculatePosition({ side: "LONG", averagePrice: 10, quantity: 3, currentPrice: 12 });
  assert.deepEqual(result, { costBasis: 30, grossPnl: 6, grossPercent: 20 });
});

test("calcula ganho de posicao vendida", () => {
  const result = calculatePosition({ side: "SHORT", averagePrice: 10, quantity: 3, currentPrice: 8 });
  assert.deepEqual(result, { costBasis: 30, grossPnl: 6, grossPercent: 20 });
});

test("rejeita valores invalidos de posicao", () => {
  assert.equal(calculatePosition({ side: "LONG", averagePrice: 0, quantity: 1, currentPrice: 10 }), null);
});
