// scripts/painel-status.mjs
// Painel Definitivo — gerador do artefato public/painel-status.json.
//
// O QUE FAZ: abre o SQLite em readOnly, lê SÓ contagens e os últimos
// regime_events (histórico de mudanças de regime + durações por regime) e
// escreve public/painel-status.json de forma atômica (tmp + rename).
// Este JSON é ARTEFATO GERADO (gitignored, como r6-status.json) — nunca editado
// à mão. O frontend apenas apresenta o JSON + o stream WS ao vivo.
//
// O QUE NÃO FAZ (proibido): escrever no banco, alterar schema/dados/parâmetros,
// calcular χ² / p-perm / lifts / probabilidades, executar R6/F2, tocar no
// PREDICTIVE_GATE. Nenhum teste estatístico vive neste arquivo.
//
// AGENDAMENTO SUGERIDO: Task Scheduler a cada 5 min (baixa frequência, como o
// monitor R6). Execução manual: `node scripts/painel-status.mjs`.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dbPath = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const OUT_PATH = path.join(root, 'public', 'painel-status.json');

// Últimos N eventos de regime servidos ao painel (suficiente p/ histórico legível).
const RECENT_LIMIT = 50;
const DAY_MS = 24 * 3_600_000;

// Leitura estritamente read-only: nunca escreve, nunca adquire lock de escrita.
const db = new DatabaseSync(dbPath, { readOnly: true });

const snapRow = db
  .prepare('SELECT COUNT(*) c, MAX(timestamp) mx FROM snapshots')
  .get();
const regimeCountRow = db
  .prepare('SELECT COUNT(*) c FROM regime_events')
  .get();
const recent = db
  .prepare(
    'SELECT timestamp, event_type, from_state, to_state, price, confidence ' +
      'FROM regime_events ORDER BY timestamp DESC LIMIT ?',
  )
  .all(RECENT_LIMIT);
const changes24hRow = db
  .prepare(
    "SELECT COUNT(*) c FROM regime_events " +
      "WHERE event_type = 'regime_change' AND timestamp >= ?",
  )
  .get(Date.now() - DAY_MS);
const changes7dRow = db
  .prepare(
    "SELECT COUNT(*) c FROM regime_events " +
      "WHERE event_type = 'regime_change' AND timestamp >= ?",
  )
  .get(Date.now() - 7 * DAY_MS);

// Durações por regime: entre um regime_change e o próximo (últimos 50 bastam;
// janelas ainda abertas usam "agora" como fim — só apresentação, sem inferência).
const changesAsc = [...recent]
  .filter((e) => e.event_type === 'regime_change')
  .sort((a, b) => a.timestamp - b.timestamp);
const nowMs = Date.now();
const durations = {};
for (let i = 0; i < changesAsc.length; i++) {
  const cur = changesAsc[i];
  const next = changesAsc[i + 1];
  const end = next ? next.timestamp : nowMs;
  const ms = Math.max(0, end - cur.timestamp);
  const key = cur.to_state || 'UNKNOWN';
  if (!durations[key]) durations[key] = { count: 0, totalMs: 0 };
  durations[key].count++;
  durations[key].totalMs += ms;
}
for (const k of Object.keys(durations)) {
  durations[k].avgMin = Math.round(durations[k].totalMs / durations[k].count / 60_000);
}

db.close();

const status = {
  updatedAt: new Date(nowMs).toISOString(),
  // Artefato gerado — o frontend exibe `updatedAt` como "última atualização" do histórico.
  snapshots: snapRow.c,
  lastSnapshotAt: snapRow.mx ? new Date(snapRow.mx).toISOString() : null,
  regimeEvents: regimeCountRow.c,
  regimeChanges24h: changes24hRow.c,
  regimeChanges7d: changes7dRow.c,
  durations,
  recent: recent.map((e) => ({
    t: new Date(e.timestamp).toISOString(),
    type: e.event_type,
    from: e.from_state,
    to: e.to_state,
    price: e.price,
    confidence: e.confidence,
  })),
};

// Escrita atômica (tmp + rename) para o frontend nunca ler JSON parcial.
const tmp = OUT_PATH + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(status, null, 2) + '\n');
fs.renameSync(tmp, OUT_PATH);

console.log(
  `[painel-status] ${status.updatedAt} snapshots=${status.snapshots} ` +
    `regimeEvents=${status.regimeEvents} changes24h=${status.regimeChanges24h} ` +
    `recent=${status.recent.length}`,
);
