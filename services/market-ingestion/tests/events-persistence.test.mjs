// tests/events-persistence.test.mjs
// Fase 0 itens 5+6 — persistência de whale events + migração v2 (events.price) + schema_version.
// Roda contra o build: execute `npm run build` (tsc) antes deste teste.
//   node tests/events-persistence.test.mjs
//
// Nota: importar dist/storage/sqlite.js instancia o singleton dbStorage (migra o market.db
// real de forma idempotente). As asserções deste teste usam apenas DBs temporários.
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { SQLiteStorage } = await import(pathToFileURL(path.join(here, '..', 'dist', 'storage', 'sqlite.js')).href);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

const dir = mkdtempSync(path.join(tmpdir(), 'dsh-events-'));
const tmp = (name) => path.join(dir, name);

// ── Teste 1: DB novo — campos completos, details estruturado, null ≠ 0 ──
console.log('\n=== Teste 1: saveEvent em DB novo (schema v2) ===');
{
  const s = new SQLiteStorage(tmp('fresh.db'));
  assert(s.getSchemaVersion() === 2, `schema_version = 2 (recebeu ${s.getSchemaVersion()})`);

  s.saveEvent({
    timestamp: 1787000002000,
    symbol: 'BTCUSDT',
    eventType: 'whale_buy',
    magnitude: 12345.67,
    direction: 'bullish',
    price: 99000.25,
    details: JSON.stringify({ exchange: 'binance', quantity: 0.1247, side: 'BUY', isBuyerMaker: false }),
  });

  const raw = new DatabaseSync(tmp('fresh.db'), { readOnly: true });
  const r = raw.prepare('SELECT * FROM events ORDER BY id').get();
  assert(r.timestamp === 1787000002000, 'timestamp = eventTime do trade (não horário da persistência)');
  assert(r.symbol === 'BTCUSDT', 'symbol preenchido');
  assert(r.event_type === 'whale_buy', 'event_type = whale_buy');
  assert(r.direction === 'bullish', 'direction explícita');
  assert(r.magnitude === 12345.67, 'magnitude persistida');
  assert(r.price === 99000.25, 'price = preço exato do trade');
  const det = JSON.parse(r.details);
  assert(det.exchange === 'binance' && det.quantity === 0.1247 && det.side === 'BUY' && det.isBuyerMaker === false, 'details estruturado (JSON) com dados adicionais');

  // null ≠ 0: magnitude 0 preservada; price ausente → NULL (não 0)
  s.saveEvent({ timestamp: 1787000003000, symbol: 'BTCUSDT', eventType: 'whale_sell', magnitude: 0, direction: 'bearish', price: 98000 });
  const r2 = raw.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1').get();
  assert(r2.magnitude === 0, 'magnitude 0 preservada (não vira null)');

  s.saveEvent({ timestamp: 1787000004000, eventType: 'whale_buy', magnitude: 100, direction: 'bullish' });
  const r3 = raw.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1').get();
  assert(r3.symbol === 'BTCUSDT', 'symbol ausente → fallback CONFIG.symbol');
  assert(r3.price === null, 'price ausente → NULL (não 0)');

  raw.close();
  s.close();
}

// ── Teste 2: DB legado (v1) — migração idempotente, eventos antigos intactos ──
console.log('\n=== Teste 2: migração de DB legado (v1 → v2) ===');
{
  const dbPath = tmp('legacy.db');
  const raw = new DatabaseSync(dbPath);
  // Schema v1: events SEM price
  raw.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      event_type TEXT,
      magnitude REAL,
      direction TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  raw.exec('PRAGMA user_version = 1');
  raw.prepare('INSERT INTO events (timestamp, symbol, event_type, magnitude, direction, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(1786000000000, 'BTCUSDT', 'whale_buy', 100000, 'bullish', '{"quantity":1}');
  raw.close();

  const s = new SQLiteStorage(dbPath);
  assert(s.getSchemaVersion() === 2, `schema_version migrado 1 → 2 (recebeu ${s.getSchemaVersion()})`);

  const raw2 = new DatabaseSync(dbPath, { readOnly: true });
  const old = raw2.prepare('SELECT * FROM events ORDER BY id').get();
  assert(old.price === null, 'evento antigo preservado com price NULL (sem preço histórico inventado)');
  assert(old.symbol === 'BTCUSDT' && old.event_type === 'whale_buy' && old.magnitude === 100000 && old.direction === 'bullish', 'dados antigos intactos (nada sobrescrito)');
  assert(old.details === '{"quantity":1}', 'details antigo intacto');

  // Novo evento já com price no mesmo DB migrado
  s.saveEvent({ timestamp: 1787000005000, symbol: 'BTCUSDT', eventType: 'whale_sell', magnitude: 50000, direction: 'bearish', price: 101000.5, details: '{"quantity":0.5}' });
  const n = raw2.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1').get();
  assert(n.price === 101000.5, 'novo evento persistido com price após migração');

  const cols = raw2.prepare('PRAGMA table_info(events)').all().filter((c) => c.name === 'price');
  assert(cols.length === 1, 'coluna price existe exatamente uma vez');

  raw2.close();
  s.close();

  // Reabertura: idempotente, sem erro, versão permanece 2
  const s2 = new SQLiteStorage(dbPath);
  assert(s2.getSchemaVersion() === 2, `reabertura idempotente (schema_version permanece ${s2.getSchemaVersion()})`);
  s2.close();
}

// ── Resumo ──
console.log(`\n${'='.repeat(44)}`);
console.log(`Resultados: ${passed} passaram, ${failed} falharam`);
console.log(`${'='.repeat(44)}`);

rmSync(dir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
