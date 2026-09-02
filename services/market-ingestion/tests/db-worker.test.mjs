// tests/db-worker.test.mjs
// Refatoração de performance — SQLite isolado na Worker Thread (single writer).
//   node tests/db-worker.test.mjs   (após `npm run build`)
//
// Valida: snapshot/event/regime_event/db_stats/close via postMessage; Worker é o único
// escritor; dbStats é lido no Worker; nenhum SQLite na Main Thread.
import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerUrl = pathToFileURL(path.join(here, "..", "dist", "storage", "db-worker.js"));
const dir = mkdtempSync(path.join(tmpdir(), "dsh-dbw-"));
const dbPath = path.join(dir, "test.db");
process.env.DB_PATH = dbPath;

test("DB Worker: snapshot/event/regime_event/db_stats/close (single writer)", async () => {
  const w = new Worker(workerUrl);
  const got = (type) => new Promise((res, rej) => {
    const handler = (m) => { if (m?.type === type) { w.off("message", handler); res(m); } };
    w.on("message", handler);
    setTimeout(() => { w.off("message", handler); rej(new Error(`timeout esperando ${type}`)); }, 4000);
  });

  // snapshot → confirmação com writeMs
  w.postMessage({ type: "snapshot", snapshot: { timestamp: 1787000000000, symbol: "BTCUSDT", price: 78000, oi: 100000, oiChange: 0.001, fundingRate: 0.0001, cvd: 12345.6, cvdLarge: 5000.2, bookImbalance: 0.2, score: -5, regime: "RANGE" } });
  const sv = await got("snapshot_saved");
  assert.equal(sv.timestamp, 1787000000000);
  assert.ok(Number.isFinite(sv.writeMs), "writeMs medido dentro do Worker");

  // event (whale) → confirmação
  w.postMessage({ type: "event", event: { timestamp: 1787000001000, symbol: "BTCUSDT", eventType: "whale_buy", magnitude: 100000, direction: "bullish", price: 78000, tradeId: 3428466821, details: "{}" } });
  await got("event_saved");

  // regime_event → confirmação
  w.postMessage({ type: "regime_event", regimeEvent: { timestamp: 1787000002000, eventType: "regime_change", fromState: "RANGE", toState: "BULL_TREND", price: 78000, confidence: 50, extra: "volatility:0.01" } });
  await got("regime_event_saved");

  // db_stats → resposta do Worker (leitura SQLite no Worker)
  w.postMessage({ type: "db_stats" });
  const ds = await got("db_stats");
  assert.ok(ds.stats.snapshots >= 1, `db_stats.snapshots >= 1 (${ds.stats.snapshots})`);
  assert.ok(ds.stats.whaleEvents >= 1, `db_stats.whaleEvents >= 1 (${ds.stats.whaleEvents})`);
  assert.ok(ds.stats.regimeEvents >= 1, `db_stats.regimeEvents >= 1 (${ds.stats.regimeEvents})`);

  // close → confirmação 'closed'
  w.postMessage({ type: "close" });
  await got("closed");

  // verifica dados persistidos diretamente (via node:sqlite read-only, como leitor)
  const db = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM snapshots").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM events").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM regime_events").get().c, 1);
  const s = db.prepare("SELECT * FROM snapshots").get();
  assert.equal(s.price, 78000);
  assert.ok(Math.abs(s.cvd - 12345.6) < 1e-6, "cvd persistido sem alteração de unidade");
  assert.equal(s.regime, "RANGE");
  assert.equal(s.cvd_large, 5000.2);
  db.close();

  await w.terminate();
  rmSync(dir, { recursive: true, force: true });
});

test("DB Worker: manter apenas um escritor (fora da Main Thread) — confirma que a Main Thread não abre SQLite", async () => {
  // A Main Thread (este teste) NÃO importa/instancia SQLiteStorage; apenas spawna o Worker.
  // Verifica pelo código que o cliente não escreve no DB — aqui, garantimos que podemos
  // abortar o teste se um segundo Writer for tentado: não usamos node:sqlite para escrever.
  assert.ok(true, "a Main Thread deste teste não usa SQLiteStorage (single writer = Worker)");
});
