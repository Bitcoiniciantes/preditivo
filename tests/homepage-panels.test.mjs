import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Página principal: os painéis clássicos (Viés Rápido, Radar, Plano Técnico,
// Confluence, Alertas, Observatório) devem permanecer integrados ao page.tsx.
// Regressão contra remoção silenciosa em migrações de layout.

const PAGE = new URL("../app/page.tsx", import.meta.url);

test("componentes clássicos importados na home", async () => {
  const page = await readFile(PAGE, "utf8");
  for (const name of ["ConfluencePanel", "AlertPanel"]) {
    assert.ok(page.includes(name), `import/uso ausente: ${name}`);
  }
  for (const name of [
    "MarketPanel",
    "ConfluenceCard",
    "MarketObservatory",
    "PredictiveStatusCard",
    "flowWidgetsRow",
  ]) {
    assert.ok(!page.includes(name), `não deveria estar na home: ${name}`);
  }
  assert.match(page, /buildConfluence/, "confluence calculada");
});

test("barra Viés Rápido presente", async () => {
  const page = await readFile(PAGE, "utf8");
  assert.match(page, /VIÉS RÁPIDO/, "rótulo da barra");
  assert.match(page, /quickScaleTrack/, "trilha da barra");
});

test("Radar + Plano Técnico + seções presentes", async () => {
  const page = await readFile(PAGE, "utf8");
  assert.match(page, /<RadarBoard/, "RadarBoard renderizado");
  assert.match(page, /function RadarBoard/, "RadarBoard definido");
  assert.match(page, /PLANO TÉCNICO/, "card de níveis");
  assert.match(page, /alertPanelSection/, "seção de alertas");
  assert.ok(!page.includes("handleFlowData"), "wiring MarketPanel → ConfluenceCard removido");
  assert.match(page, /removeAsset/, "remoção de ativo do radar");
  assert.match(page, /compact \/>/, "faixa original (RadarBoard compact) presente");
  assert.ok(!page.includes("QuickAssetStrip"), "faixa duplicata removida");
});

test("arquivos dos painéis existem no disco", async () => {
  for (const f of [
    "../app/MarketPanel.tsx",
    "../app/ConfluencePanel.tsx",
    "../app/ConfluenceCard.tsx",
    "../app/AlertPanel.tsx",
  ]) {
    const content = await readFile(new URL(f, import.meta.url), "utf8");
    assert.ok(content.length > 100, `${f} existe com conteúdo`);
  }
});
