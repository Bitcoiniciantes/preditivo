// tests/absorption-resolve.test.mjs
// CORREÇÃO CRÍTICA — Absorption durante disconnect/reconnect do WS.
// Roda contra o build: `npm run build` (tsc) antes. Importa a lógica pura de resolução.
//   node tests/absorption-resolve.test.mjs
//
// Reproduz: absorption ativa → disconnect → ausência de dados → reconnect → primeiro trade
// válido → processamento normal. Garante que NUNCA há Δ$Infinity / trigger=$0.00 / duração
// absurda / estado corrompido.
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { isValidPrice, resolveAbsorption } = await import(pathToFileURL(path.join(here, "..", "dist", "flow", "absorption-resolve.js")).href);

// Mesmos thresholds do daemon (index.ts) — passados como entrada, não alterados aqui.
const TH = 0.05; // ABSORPTION_RESOLUTION_THRESHOLD_PCT
const WIN = 5;   // ABSORPTION_RESOLUTION_WINDOW_MINUTES

test("válido — preço moveu ≥ threshold → resolved (sem Infinity)", () => {
  const r = resolveAbsorption({ currentPrice: 78050, triggerPrice: 78000, triggerTs: 1787000000000, now: 1787000005000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "resolved");
  assert.ok(Number.isFinite(r.priceChangePct) && r.priceChangePct > 0, `pct finita e positiva (${r.priceChangePct})`);
  assert.ok(Number.isFinite(r.elapsedMin));
});

test("válido — janela expirou sem movimento → failed", () => {
  const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: 78000, triggerTs: 1787000000000, now: 1787000400000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "failed");
  assert.ok(Number.isFinite(r.priceChangePct) && r.priceChangePct === 0);
  assert.ok(r.elapsedMin > WIN, `elapsedMin ${r.elapsedMin} > ${WIN}`);
});

test("válido — sem movimento e janela ok → pending", () => {
  const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: 78000, triggerTs: 1787000000000, now: 1787000010000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "pending");
});

// ── REGRESSÃO: disconnect (trigger zerado) NUNCA resolve com Infinity/trigger=0 ──
test("REGRESSÃO — triggerPrice=0 (reset do disconnect) → invalid, sem Infinity/trigger=0", () => {
  const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: 0, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "invalid");
  assert.ok(!Number.isFinite(r.priceChangePct) && Number.isNaN(r.priceChangePct), "priceChangePct NaN, NÃO Infinity");
  assert.ok(Number.isNaN(r.elapsedMin), "elapsedMin NaN, sem duração absurda");
});

test("REGRESSÃO — triggerTs=0 → invalid", () => {
  const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: 78000, triggerTs: 0, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "invalid");
  assert.ok(Number.isNaN(r.elapsedMin));
});

test("REGRESSÃO — currentPrice=0 → invalid (nunca divide por zero)", () => {
  const r = resolveAbsorption({ currentPrice: 0, triggerPrice: 78000, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "invalid");
});

test("REGRESSÃO — currentPrice=NaN → invalid", () => {
  const r = resolveAbsorption({ currentPrice: NaN, triggerPrice: 78000, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "invalid");
});

test("REGRESSÃO — triggerPrice=NaN → invalid", () => {
  const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: NaN, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "invalid");
});

test("REGRESSÃO — preço negativo → invalid", () => {
  const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: -5, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(r.action, "invalid");
});

test("isValidPrice — guards de preço", () => {
  assert.ok(isValidPrice(1));
  assert.ok(!isValidPrice(0));
  assert.ok(!isValidPrice(-1));
  assert.ok(!isValidPrice(NaN));
  assert.ok(!isValidPrice(Infinity));
  assert.ok(!isValidPrice(undefined));
});

// ── Cenário completo: disconnect → reconnect → primeiro trade válido → normal ──
test("cenário disconnect/reconnect — inválido após disconnect; resolve normal após reconnect", () => {
  // disconnect: estado interno com trigger zerado → inválido (não Infinity)
  const during = resolveAbsorption({ currentPrice: 78000, triggerPrice: 0, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(during.action, "invalid");
  // reconnect + primeiro trade válido → novo trigger em preço válido
  const pending = resolveAbsorption({ currentPrice: 78000, triggerPrice: 78000, triggerTs: 1787000200000, now: 1787000250000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(pending.action, "pending");
  // preço moveu → resolved normal
  const resolved = resolveAbsorption({ currentPrice: 78050, triggerPrice: 78000, triggerTs: 1787000200000, now: 1787000300000, thresholdPct: TH, windowMinutes: WIN });
  assert.equal(resolved.action, "resolved");
  assert.ok(Number.isFinite(resolved.priceChangePct));
});

// ── Disconnect durante BULL/BEAR e múltiplos reconnects ──
test("disconnect durante BULL/BEAR → invalid (não Infinity), repetido em múltiplos reconnects", () => {
  for (let i = 0; i < 3; i++) { // múltiplos reconnects consecutivos
    const r = resolveAbsorption({ currentPrice: 78000, triggerPrice: 0, triggerTs: 1787000000000, now: 1787000060000, thresholdPct: TH, windowMinutes: WIN });
    assert.equal(r.action, "invalid", `reconnect ${i + 1}: invalid`);
    assert.ok(Number.isNaN(r.priceChangePct), `reconnect ${i + 1}: priceChangePct NaN (não Infinity)`);
  }
});
