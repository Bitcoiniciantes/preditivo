// tests/offline-analysis.test.mjs
// Teste mínimo da trilha offline (somente leitura, manual, descritiva).
// Uso: `node --test tests/offline-analysis.test.mjs`
//
// Cobre: scripts iniciam; market.db é aberto em somente leitura; consultas
// funcionam contra um banco sintético; relatórios são gerados com valores
// coerentes; whale-study exige --threshold e respeita o limiar; o arquivo
// do banco não é modificado.

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
const SCRIPTS = ['coverage-report.mjs', 'regime-report.mjs', 'whale-study.mjs']
  .map((f) => path.join(ROOT, 'scripts', 'offline-analysis', f));

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function fixtureDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-test-'));
  const dbPath = path.join(dir, 'market.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE snapshots (timestamp INTEGER NOT NULL, symbol TEXT, price REAL, oi REAL, oi_change REAL, funding_rate REAL, cvd REAL, cvd_large REAL, book_imbalance REAL, score INTEGER, regime TEXT)');
  db.exec('CREATE TABLE events (timestamp INTEGER NOT NULL, symbol TEXT, event_type TEXT, magnitude REAL, price REAL, direction TEXT, details TEXT, trade_id TEXT)');
  db.exec('CREATE TABLE regime_events (timestamp INTEGER NOT NULL, event_type TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, price REAL, confidence REAL, extra TEXT)');
  // 120 snapshots, 1/min, a partir de t0.
  const t0 = Date.parse('2026-09-01T00:00:00.000Z');
  const insS = db.prepare('INSERT INTO snapshots (timestamp, symbol, price, oi, oi_change, funding_rate, cvd, cvd_large, book_imbalance, score, regime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 120; i++) {
    insS.run(t0 + i * 60_000, 'BTCUSDT', 100000 + i * 10, 5000, 0.1, 0.0001, i, i, 0.5, 0, 'RANGE');
  }
  // Whale events: 2 abaixo e 2 acima do limiar 1000.
  const insE = db.prepare('INSERT INTO events (timestamp, symbol, event_type, magnitude, price, direction, details, trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insE.run(t0 + 10 * 60_000, 'BTCUSDT', 'whale_buy', 100, 100100, 'bullish', '', null);
  insE.run(t0 + 20 * 60_000, 'BTCUSDT', 'whale_sell', 200, 100200, 'bearish', '', null);
  insE.run(t0 + 30 * 60_000, 'BTCUSDT', 'whale_buy', 5000, 100300, 'bullish', '', null);
  insE.run(t0 + 40 * 60_000, 'BTCUSDT', 'whale_sell', 9000, 100400, 'bearish', '', null);
  // Mudanças de regime: RANGE -> BULL_TREND -> RANGE -> BEAR_TREND -> RANGE.
  const insR = db.prepare('INSERT INTO regime_events (timestamp, event_type, from_state, to_state, price, confidence, extra) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const seq = [['RANGE', 'BULL_TREND', 5], ['BULL_TREND', 'RANGE', 15], ['RANGE', 'BEAR_TREND', 25], ['BEAR_TREND', 'RANGE', 35]];
  for (const [from, to, min] of seq) insR.run(t0 + min * 60_000, 'regime_change', from, to, 100000, 50, null);
  insR.run(t0 + 50 * 60_000, 'flow_change', null, 'BULL_FLOW', 100000, 10, null);
  db.close();
  return { dir, dbPath, out: path.join(dir, 'out') };
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

test('scripts existem', () => {
  for (const s of SCRIPTS) assert.ok(fs.existsSync(s), `ausente: ${s}`);
});

test('scripts abrem o banco em somente leitura e nunca escrevem', () => {
  for (const s of SCRIPTS) {
    const src = fs.readFileSync(s, 'utf8');
    assert.match(src, /readOnly:\s*true/, `${s} deve abrir com readOnly: true`);
    for (const kw of ['INSERT INTO', 'UPDATE ', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE']) {
      assert.ok(!src.includes(kw), `${s} não deve conter escrita (${kw})`);
    }
  }
});

test('whale-study exige --threshold', () => {
  const r = run(SCRIPTS[2], ['--db', 'x']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--threshold/);
});

test('coverage-report gera relatório coerente e não modifica o banco', () => {
  const { dbPath, out } = fixtureDb();
  const before = sha256(dbPath);
  const r = run(SCRIPTS[0], ['--db', dbPath, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(out, 'coverage-report.md'), 'utf8');
  assert.match(md, /Total de snapshots: 120/);
  assert.match(md, /Segmentos contínuos: 1/);
  assert.match(md, /NÃO classifica o dataset como preditivamente confiável/);
  assert.ok(fs.existsSync(path.join(out, 'coverage-daily.csv')));
  assert.ok(fs.existsSync(path.join(out, 'coverage-gaps.csv')));
  assert.equal(sha256(dbPath), before, 'market.db não deve ser modificado');
});

test('regime-report usa só regime_events e marca amostra insuficiente', () => {
  const { dbPath, out } = fixtureDb();
  const before = sha256(dbPath);
  const r = run(SCRIPTS[1], ['--db', dbPath, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(out, 'regime-report.md'), 'utf8');
  assert.match(md, /mudanças de regime.*: 4/);
  // 4 mudanças -> episódios fechados por regime < 3: insuficiente.
  assert.match(md, /Amostra insuficiente para esta análise\./);
  assert.ok(fs.existsSync(path.join(out, 'regime-transitions.csv')));
  assert.equal(sha256(dbPath), before, 'market.db não deve ser modificado');
});

test('whale-study respeita o limiar configurável', () => {
  const { dbPath, out } = fixtureDb();
  const before = sha256(dbPath);
  const r = run(SCRIPTS[2], ['--db', dbPath, '--out', out, '--threshold', '1000']);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(out, 'whale-study-threshold-1000.md'), 'utf8');
  assert.match(md, /Eventos com magnitude >= limiar: 2/);
  assert.match(md, /NÃO CONSTITUI PREVISÃO, SINAL OU RECOMENDAÇÃO/);
  const r2 = run(SCRIPTS[2], ['--db', dbPath, '--out', out, '--threshold', '8000']);
  assert.equal(r2.status, 0, r2.stderr);
  const md2 = fs.readFileSync(path.join(out, 'whale-study-threshold-8000.md'), 'utf8');
  assert.match(md2, /Eventos com magnitude >= limiar: 1/);
  assert.equal(sha256(dbPath), before, 'market.db não deve ser modificado');
});
