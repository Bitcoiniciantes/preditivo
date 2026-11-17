// tests/metric-redundancy.test.mjs
// Teste mínimo do estudo de associação entre métricas (offline, somente leitura).
// Uso: `node --test tests/metric-redundancy.test.mjs`
//
// Cobre: script executa; banco abre em read-only; encontra as quatro colunas
// principais; encontra eventos; alinhamento produz N esperado; matrizes 4×4 são
// produzidas com N pairwise por célula; contradições são contabilizadas; hash do
// banco permanece inalterado.

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'offline-analysis', 'metric-redundancy.mjs');

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function fixtureDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redundancy-test-'));
  const dbPath = path.join(dir, 'market.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE snapshots (timestamp INTEGER NOT NULL, symbol TEXT, price REAL, oi REAL, oi_change REAL, funding_rate REAL, cvd REAL, cvd_large REAL, book_imbalance REAL, score INTEGER, regime TEXT)');
  db.exec('CREATE TABLE events (timestamp INTEGER NOT NULL, symbol TEXT, event_type TEXT, magnitude REAL, price REAL, direction TEXT, details TEXT, trade_id TEXT)');
  db.exec('CREATE TABLE regime_events (timestamp INTEGER NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, price REAL, confidence REAL, extra TEXT)');
  const t0 = Date.parse('2026-09-01T00:00:00.000Z');
  const insS = db.prepare('INSERT INTO snapshots (timestamp, symbol, price, oi, oi_change, funding_rate, cvd, cvd_large, book_imbalance, score, regime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 120; i++) {
    // Primeiros 10 snapshots: imb extremo sob NEUTRAL_FLOW (contradição >50 e >70).
    const imb = i < 10 ? 0.8 : ((i % 5) - 2) * 0.2;
    insS.run(t0 + i * 60_000, 'BTCUSDT', 100000 + i * 10, 5000, 0.1, 0.0001,
      i * 1000, i * 500, imb, (i % 7) - 3, i < 60 ? 'RANGE' : 'BULL_TREND');
  }
  const insR = db.prepare('INSERT INTO regime_events (timestamp, event_type, from_state, to_state, price, confidence, extra) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insR.run(t0 + 60 * 60_000, 'flow_change', 'NEUTRAL_FLOW', 'BULL_FLOW', 100000, 50, null);
  insR.run(t0 + 30 * 60_000, 'absorption_triggered', 'NONE', 'BULL_ABSORPTION', 100000, 50, null);
  insR.run(t0 + 45 * 60_000, 'absorption_resolved', 'BULL_ABSORPTION', 'NONE', 100000, 50, null);
  insR.run(t0 + 70 * 60_000, 'divergence', null, 'DIVERGENCE_BULL', 100000, 50, null);
  insR.run(t0 + 80 * 60_000, 'divergence_resolved', 'DIVERGENCE_BULL', 'BULL_TREND', 100000, 50, null);
  insR.run(t0 + 20 * 60_000, 'regime_change', 'RANGE', 'BULL_TREND', 100000, 50, null);
  db.close();
  return { dir, dbPath, out: path.join(dir, 'out') };
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('script existe, abre em somente leitura e nunca escreve', () => {
  assert.ok(fs.existsSync(SCRIPT), 'ausente: metric-redundancy.mjs');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /readOnly:\s*true/, 'deve abrir com readOnly: true');
  for (const kw of ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'VACUUM', 'ANALYZE']) {
    assert.ok(!src.includes(kw), `não deve conter escrita/operação destrutiva (${kw})`);
  }
});

test('executa sobre banco sintético e gera relatório + CSVs com N coerente', () => {
  const { dbPath, out } = fixtureDb();
  const before = sha256(dbPath);
  const r = run(['--db', dbPath, '--out', out]);
  assert.equal(r.status, 0, r.stderr);

  const md = fs.readFileSync(path.join(out, 'metric-redundancy.md'), 'utf8');
  assert.match(md, /Snapshots: 120/);
  assert.match(md, /Tolerância de proximidade: não aplicável/);

  // Matriz de níveis 4×4: header + 16 linhas, cada célula com N pairwise = 120.
  const level = fs.readFileSync(path.join(out, 'correlations-level.csv'), 'utf8').trim().split('\n');
  assert.equal(level.length, 17);
  for (const line of level.slice(1)) {
    assert.equal(line.split(',').pop(), '120');
  }
  // Matriz de variações: 119 pares (120 snapshots contínuos, sem gaps).
  const diff = fs.readFileSync(path.join(out, 'correlations-diff.csv'), 'utf8').trim().split('\n');
  assert.equal(diff.length, 17);
  for (const line of diff.slice(1)) {
    assert.equal(line.split(',')[4], '119');
  }
  // Contradições: faixa 0.7 contabiliza os 10 snapshots extremos.
  const contra = fs.readFileSync(path.join(out, 'contradictions.csv'), 'utf8');
  const row70 = contra.trim().split('\n').find((l) => l.startsWith('0.7,'));
  assert.ok(row70, 'linha da faixa 0.7 ausente');
  assert.equal(row70.split(',')[1], '10');
  // Co-ocorrências e transições geradas.
  for (const f of ['cooccurrence-flow.csv', 'cooccurrence-regime.csv', 'cooccurrence-absorption.csv',
    'cooccurrence-divergence.csv', 'transitions.csv']) {
    assert.ok(fs.existsSync(path.join(out, f)), `ausente: ${f}`);
  }
  assert.match(fs.readFileSync(path.join(out, 'cooccurrence-flow.csv'), 'utf8'), /NEUTRAL_FLOW/);
  assert.equal(sha256(dbPath), before, 'market.db não deve ser modificado');
});
