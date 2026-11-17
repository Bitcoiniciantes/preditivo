import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { rsi, sma } from "../lib/painelcolorido-klines.ts";

// RSI clássico (Wilder, período 14) — runtime direto sobre o lib.
test("rsi: casos-limite e alinhamento", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const dn = Array.from({ length: 30 }, (_, i) => 100 - i);
  const flat = new Array(30).fill(50);
  assert.equal(rsi(up)[29], 100);
  assert.equal(rsi(dn)[29], 0);
  assert.equal(rsi(flat)[29], 50);
  const short = rsi([1, 2, 3]);
  assert.equal(short.length, 3);
  assert.ok(short.every((v) => v === null));
  const r = rsi(up);
  assert.equal(r.length, 30);
  assert.ok(r.slice(0, 14).every((v) => v === null), "primeiros `period` valores são null");
  assert.ok(r.slice(14).every((v) => v !== null && v >= 0 && v <= 100));
  assert.deepEqual(sma([1, 2, 3], 5), [null, null, null]);
});

test("gráfico: RSI em painel dedicado com crosshair nativo", async () => {
  const chart = await readFile(new URL("../app/painelcolorido/PainelColoridoChart.tsx", import.meta.url), "utf8");
  const code = chart.replace(/^\/\/.*$/gm, "");
  assert.match(code, /chart\.addPane\(true\)/);
  assert.match(code, /rsiPane\.addSeries\(LineSeries/);
  assert.match(code, /priceScaleId: "right"/);
  assert.match(code, /style: LineStyle\.Dotted/);
  assert.match(code, /labelVisible: true/);
  assert.match(code, /enableResize: false/);
  assert.match(code, /maPoints\(bars, rsi\(closes, 14\)\)/);
  assert.doesNotMatch(code, /priceScaleId: "rsi"/);
  assert.doesNotMatch(code, /subscribeCrosshairMove|setCrosshairPosition/);
  assert.doesNotMatch(code, /MACD|Bollinger|Stochastic/i);
});
