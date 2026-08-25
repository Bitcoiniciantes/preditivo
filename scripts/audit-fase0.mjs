// scripts/audit-fase0.mjs
// Fase 0 — Integridade dos dados (PROJETO_COMPORTAMENTO_PREDITIVO_15Mv3, seção 44):
//   1. confirmar timestamps (epoch ms)
//   2. cobertura temporal real
//   3. gaps de snapshots
//   4. ordenação de regime_events
//   5. saveEvent ligado (whale events persistidos com price)
//   6. schema_version registrado (PRAGMA user_version)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, '..', 'services', 'market-ingestion', 'data', 'market.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

let ok = 0, warn = 0, fail = 0;
const check = (cond, msg, level = 'ok') => {
  if (level === 'ok' && cond) { ok++; console.log(`  OK ${msg}`); }
  else if (level === 'warn') { warn++; console.log(`  WARN ${msg}`); }
  else { fail++; console.log(`  FALHA ${msg}`); }
};

// 1. Timestamps em epoch ms (10^12 a 10^13, não 10^9 = segundos)
console.log('\n=== 1. Timestamps: unidade (epoch ms) ===');
for (const t of ['snapshots', 'regime_events', 'events']) {
  const row = db.prepare(`SELECT MIN(timestamp) AS min, MAX(timestamp) AS max FROM ${t}`).get();
  if (row.min === null) { check(false, `${t}: vazia`, 'warn'); continue; }
  const inMs = row.min > 1e12 && row.max < 1e14;
  check(inMs, `${t}: min=${row.min} max=${row.max} → epoch ms`, inMs ? 'ok' : 'fail');
}

// 2. Cobertura temporal real
console.log('\n=== 2. Cobertura temporal ===');
const cov = db.prepare('SELECT MIN(timestamp) AS a, MAX(timestamp) AS b FROM snapshots').get();
const hours = ((cov.b - cov.a) / 3600000);
check(hours > 0, `snapshots: ${hours.toFixed(1)}h (${new Date(cov.a).toISOString()} → ${new Date(cov.b).toISOString()})`);

// 3. Gaps de snapshots (esperado ~60s; gap > 180s = falha de coleta)
console.log('\n=== 3. Gaps de snapshots (>180s) ===');
const snaps = db.prepare('SELECT timestamp FROM snapshots ORDER BY timestamp').all();
let gaps = 0; let maxGap = 0; let maxGapAt = 0;
for (let i = 1; i < snaps.length; i++) {
  const g = snaps[i].timestamp - snaps[i-1].timestamp;
  if (g > maxGap) { maxGap = g; maxGapAt = snaps[i].timestamp; }
  if (g > 180000) gaps++;
}
check(gaps === 0, `${gaps} gaps >180s | maior gap ${(maxGap/60000).toFixed(1)}min em ${new Date(maxGapAt).toISOString()}`, gaps === 0 ? 'ok' : 'warn');

// 4. Ordenação de regime_events
console.log('\n=== 4. Ordenação de regime_events ===');
const evs = db.prepare('SELECT timestamp FROM regime_events ORDER BY timestamp').all();
let disordered = 0;
for (let i = 1; i < evs.length; i++) if (evs[i].timestamp < evs[i-1].timestamp) disordered++;
check(disordered === 0, `${disordered} pares fora de ordem (de ${evs.length})`, disordered === 0 ? 'ok' : 'fail');

// 5. saveEvent ligado — whale events persistidos (schema v2: price obrigatório p/ novos)
console.log('\n=== 5. Persistência de whale events (saveEvent ligado) ===');
const evStats = db.prepare('SELECT COUNT(*) c, SUM(CASE WHEN price IS NULL THEN 1 ELSE 0 END) nulls, MIN(timestamp) mn, MAX(timestamp) mx FROM events').get();
check(evStats.c > 0, `events: ${evStats.c} linhas (${new Date(evStats.mn).toISOString()} → ${new Date(evStats.mx).toISOString()})`, evStats.c > 0 ? 'ok' : 'warn');
check(evStats.nulls === 0, `price sempre preenchido nos eventos novos (${evStats.nulls} NULL em ${evStats.c})`, evStats.nulls === 0 ? 'ok' : 'fail');
const badTypes = db.prepare("SELECT COUNT(*) c FROM events WHERE event_type NOT IN ('whale_buy','whale_sell')").get().c;
check(badTypes === 0, `event_type restrito a whale_buy/whale_sell (${badTypes} fora)`);
const badTs = db.prepare('SELECT COUNT(*) c FROM events WHERE timestamp < 1e12 OR timestamp > 1e14').get().c;
check(badTs === 0, `timestamp em epoch ms (${badTs} fora do intervalo)`);

// 6. schema_version registrado
console.log('\n=== 6. Versão do schema (PRAGMA user_version) ===');
const v = db.prepare('PRAGMA user_version').get().user_version;
check(v >= 2, `schema_version = ${v} (esperado ≥ 2 — v2 = events.price + saveEvent ligado)`, v >= 2 ? 'ok' : 'fail');
const hasPrice = db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'price');
check(hasPrice, 'coluna events.price presente no schema real');

// bônus: idx existentes
console.log('\n=== bônus: índices existentes ===');
const idx = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();
for (const i of idx) console.log(`  ${i.tbl_name}.${i.name}`);

console.log(`\nRESULTADO: ${ok} ok, ${warn} warn, ${fail} fail`);
db.close();
process.exit(fail ? 1 : 0);
