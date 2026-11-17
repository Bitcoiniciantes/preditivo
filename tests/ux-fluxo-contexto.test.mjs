import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Contexto metodológico sob demanda (title) na linha "Regime de fluxo" do
// Indicador Único — alternativa C do relatório ux-fluxo-neutro-imbalance.md.
// Garante: microcopy de metodologia geral, sem causalidade sobre o caso
// individual, sem nova escala/métrica, sem tocar em cálculo, rótulo ou CSS.

const FILE = new URL("../app/IndicadorUnico.tsx", import.meta.url);

test("linha Regime de fluxo expõe metodologia sob demanda via title", async () => {
  const src = await readFile(FILE, "utf8");
  assert.match(src, /<span>Regime de fluxo<\/span>/);
  assert.match(src, /title="O regime de fluxo é uma classificação composta por múltiplos sinais/);
  assert.match(src, /pode coexistir com fluxo neutro/);
  assert.match(src, /não significa que um sinal esteja anulando o outro/);
});

test("contexto não afirma causa do caso individual nem cria nova escala", async () => {
  const src = await readFile(FILE, "utf8");
  const titles = [...src.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
  const fluxoTitles = titles.filter((t) => t.includes("fluxo"));
  assert.ok(fluxoTitles.length >= 1);
  for (const t of fluxoTitles) {
    // Proibido: afirmação causal sobre o caso (whale, causa, caso atual).
    // Permitido: a negação explícita "não significa que…" (assertiva no teste 1).
    assert.doesNotMatch(t, /whale|por causa|porque o|neste caso|neste momento|agora está/i);
  }
  assert.doesNotMatch(src, /Força do fluxo|força do fluxo|flow_strength|flowStrength/);
});

test("rótulo, valor e cálculo do fluxo permanecem intocados", async () => {
  const src = await readFile(FILE, "utf8");
  assert.match(src, /rotuloFlow\(data\?\.flow_regime\)/);
  assert.match(src, /\{flow\.label\}/);
  assert.match(src, /data\?\.flow_regime/);
  assert.doesNotMatch(src, /computeScore|FlowRegimeDetector|dominance/i);
});
