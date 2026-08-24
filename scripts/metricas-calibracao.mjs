// scripts/metricas-calibracao.mjs
// Medição para calibração estatística (Etapas 1–4 do plano).
// NÃO altera coleta nem pipeline: somente leitura do SQLite local.
//
// Imprime:
//   A) Divergência — classificação por duração (Etapa 1):
//        all_resolved, valid_resolved (>=60s), insufficient_duration (<60s), failed
//        taxa bruta (all_resolved/(all_resolved+failed)) e taxa válida (>=60s)
//   B) Regime — indicadores de flapping (baseline para Etapas 2/3):
//        nº de mudanças de regime, duração média, reversões <10s, <30s, divergências/hora
//   C) Absorção — métrica rotulada como "atingiu ±0,05%" (NÃO é taxa de previsão, Etapa 4)

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, '..', 'services', 'market-ingestion', 'data', 'market.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const DIVERGENCE_MIN_VALID_MS = 60_000; // 60s — duração mínima para previsão válida

function parseExtraDurationMs(extra) {
  if (!extra || typeof extra !== 'string') return null;
  const m = extra.match(/duration_ms:(\d+)/);
  return m ? Number(m[1]) : null;
}

function hoursBetween(a, b) {
  return (b - a) / 3_600_000;
}

console.log('═══════════ A) DIVERGÊNCIA (Etapa 1) ═══════════');

const divRows = db.prepare(
  "SELECT event_type, timestamp, extra FROM regime_events WHERE event_type IN ('divergence','divergence_resolved','divergence_failed') ORDER BY timestamp",
).all();

const triggered = divRows.filter((r) => r.event_type === 'divergence').length;
const failed = divRows.filter((r) => r.event_type === 'divergence_failed').length;
const resolved = divRows.filter((r) => r.event_type === 'divergence_resolved');
const allResolved = resolved.length;
const withDuration = resolved.filter((r) => parseExtraDurationMs(r.extra) !== null);
const validResolved = resolved.filter((r) => (parseExtraDurationMs(r.extra) ?? 0) >= DIVERGENCE_MIN_VALID_MS).length;
const insufficientDuration = resolved.filter((r) => (parseExtraDurationMs(r.extra) ?? 0) < DIVERGENCE_MIN_VALID_MS).length;
const noDurationField = allResolved - withDuration.length;

const taxaBruta = allResolved + failed > 0 ? ((allResolved / (allResolved + failed)) * 100).toFixed(1) : '—';
const taxaValida = validResolved + failed > 0 ? ((validResolved / (validResolved + failed)) * 100).toFixed(1) : '—';

console.log(`divergence (triggered):        ${triggered}`);
console.log(`all_resolved:                  ${allResolved}`);
console.log(`  valid_resolved (>=60s):      ${validResolved}`);
console.log(`  insufficient_duration (<60s): ${insufficientDuration}`);
console.log(`  sem campo duration_ms:       ${noDurationField}`);
console.log(`divergence_failed:             ${failed}`);
console.log(`TAXA BRUTA (all_resolved/total):        ${taxaBruta}%`);
console.log(`TAXA VÁLIDA (>=60s / (>=60s + failed)): ${taxaValida}%`);
console.log(`(taxa válida é a única que representa capacidade preditiva — Etapa 1)`);

if (divRows.length >= 2) {
  const first = divRows[0].timestamp;
  const last = divRows[divRows.length - 1].timestamp;
  const h = Math.max(hoursBetween(first, last), 0.001);
  console.log(`divergências/hora:             ${(triggered / h).toFixed(1)} (janela ${h.toFixed(1)}h)`);
}

console.log('\n═══════════ B) REGIME — flapping (baseline Etapas 2/3) ═══════════');

const regimeRows = db.prepare(
  "SELECT timestamp, from_state, to_state FROM regime_events WHERE event_type = 'regime_change' ORDER BY timestamp",
).all();

const nChanges = regimeRows.length;
console.log(`mudanças de regime:            ${nChanges}`);

if (regimeRows.length >= 2) {
  const firstTs = regimeRows[0].timestamp;
  const lastTs = regimeRows[regimeRows.length - 1].timestamp;
  const spanH = Math.max(hoursBetween(firstTs, lastTs), 0.001);
  console.log(`mudanças/hora:                 ${(nChanges / spanH).toFixed(1)} (janela ${spanH.toFixed(1)}h)`);

  const durations = [];
  let reversions10s = 0;
  let reversions30s = 0;
  for (let i = 1; i < regimeRows.length; i++) {
    const d = regimeRows[i].timestamp - regimeRows[i - 1].timestamp;
    durations.push(d);
    if (d < 10_000) reversions10s++;
    if (d < 30_000) reversions30s++;
  }
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log(`duração média de regime:       ${(avgMs / 1000).toFixed(1)}s`);
  console.log(`reversões <10s:                ${reversions10s} (${((reversions10s / durations.length) * 100).toFixed(1)}%)`);
  console.log(`reversões <30s:                ${reversions30s} (${((reversions30s / durations.length) * 100).toFixed(1)}%)`);
} else {
  console.log('(menos de 2 mudanças de regime registradas)');
}

console.log('\n═══════════ C) ABSORÇÃO (Etapa 4 — rotulagem) ═══════════');

const absRows = db.prepare(
  "SELECT event_type, COUNT(*) AS n FROM regime_events WHERE event_type LIKE 'absorption_%' GROUP BY event_type",
).all();
for (const r of absRows) console.log(`  ${r.event_type}: ${r.n}`);
const absResolved = absRows.find((r) => r.event_type === 'absorption_resolved')?.n ?? 0;
const absFailed = absRows.find((r) => r.event_type === 'absorption_failed')?.n ?? 0;
const absTotal = absResolved + absFailed;
console.log(`TAXA "ATINGIU ±0,05%" (NÃO é taxa de previsão): ${absTotal > 0 ? ((absResolved / absTotal) * 100).toFixed(1) : '—'}%`);
console.log('(critério atual: movimento de preço >=0.05% em até 5min — medida de atingimento, não de valor preditivo)');

db.close();
