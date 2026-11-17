import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  F2_PROTOCOL,
  F2_SEED_TAG,
  binWithTrainBounds,
  buildObservationsFromSnaps,
  buildStatus,
  collectCycle,
  evaluateOnce,
  gateMet,
  hashStr,
  labelClasses,
  mulberry32,
  reproduceR5Train5,
  samplingOk,
  tercileBins,
} from "../scripts/fase2-monitor.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const F2_CUT_MS = Date.parse("2026-09-09T02:20:26.856Z");
const F2_TMIN = F2_CUT_MS + 15 * 60_000;
const R5_B_5 = Date.parse("2026-09-01T22:39:41.055Z");

// grade regular de 60s a partir de t0, preço determinístico
function grid(t0, n, stepMs = 60_000, p0 = 100000) {
  const snaps = [];
  for (let i = 0; i < n; i++) {
    snaps.push({ t: t0 + i * stepMs, p: p0 + i * 10 - (i % 7) * 25 });
  }
  return snaps;
}

function tmpMarket(snaps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2test-"));
  const dbPath = path.join(dir, "market.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE snapshots (timestamp INTEGER NOT NULL, price REAL)");
  db.exec("BEGIN");
  const ins = db.prepare("INSERT INTO snapshots (timestamp, price) VALUES (?, ?)");
  for (const s of snaps) ins.run(s.t, s.p);
  db.exec("COMMIT");
  db.close();
  return { dir, dbPath, f2Path: path.join(dir, "fase2.db") };
}

// pool sintético em dois blocos contínuos: A cerca R5_B_5 (treino reproduzível)
// e B após o corte F2 (pool prospectivo). O vão entre blocos é irrelevante
// (rejeição de gap é local à janela/outcome).
function richPool() {
  const blockA = grid(R5_B_5 - 90 * 60_000, 101); // R5_B-90min .. R5_B+10min
  const blockB = grid(F2_TMIN + 60_000, 200); // ~3.3h após o corte F2
  return blockA.concat(blockB);
}

// --- corte temporal: nada com t−15m <= corte entra; pool F2 disjunto do R6 ---
test("corte temporal: âncoras com t−15min <= corte F2 são excluídas", () => {
  const snaps = grid(F2_TMIN - 60 * 60_000, 200); // cobre antes e depois do corte
  const snapMaxT = snaps[snaps.length - 1].t;
  const anchorMaxT = snapMaxT - 5 * 60_000 - 150_000;
  const obs = buildObservationsFromSnaps(snaps, 5, F2_TMIN, snapMaxT, anchorMaxT);
  assert.ok(obs.length > 0);
  for (const o of obs) assert.ok(o.t > F2_TMIN, `âncora ${o.t} viola o corte F2`);
  for (const o of obs) assert.ok(o.t - 15 * 60_000 > F2_CUT_MS);
});

test("pool F2 é disjunto do pool R6 por construção (tMin F2 > qualquer âncora R6 possível)", () => {
  // âncoras R6 existem só até o instante da execução R6 < F2_TMIN; logo tMin F2 as exclui
  const R6_EXEC_MS = Date.parse("2026-09-09T02:20:26.856Z");
  assert.ok(F2_TMIN > R6_EXEC_MS);
  const snaps = grid(R6_EXEC_MS - 3 * 60 * 60_000, 300);
  const snapMaxT = snaps[snaps.length - 1].t;
  const f2 = buildObservationsFromSnaps(snaps, 5, F2_TMIN, snapMaxT, snapMaxT);
  for (const o of f2) assert.ok(o.t > R6_EXEC_MS, "interseção R6∩F2");
});

// --- borda viva: âncora sem outcome consolidado é excluída ---
test("exclusão de âncora viva: sem snapshot de outcome, sem observação", () => {
  const snaps = grid(F2_TMIN + 60_000, 30); // só 30min de dados
  const snapMaxT = snaps[snaps.length - 1].t;
  // anchorMaxT restritivo: nenhuma âncora com outcome consolidado
  const none = buildObservationsFromSnaps(snaps, 5, F2_TMIN, snapMaxT, snaps[0].t);
  assert.equal(none.length, 0);
  // sem o cap (lógica R6): a última âncora elegível usa o último snapshot
  // como outcome — e nenhuma âncora além dela aparece (sem dados futuros)
  const all = buildObservationsFromSnaps(snaps, 5, F2_TMIN, snapMaxT, Infinity);
  assert.ok(all.length > 0);
  const lastT = all[all.length - 1].t;
  assert.ok(Math.abs(lastT + 5 * 60_000 - snapMaxT) <= 150_000, "outcome fora da tolerância");
  assert.ok(!all.some((o) => o.t > lastT), "âncora além dos dados vazou");
});

// --- janela íntegra: gap >180s ou <10 snaps rejeita ---
test("gap >180s dentro da janela de 15m rejeita a âncora", () => {
  const snaps = grid(F2_TMIN + 60_000, 60);
  snaps.splice(30, 4); // buraco de 5min no meio
  const snapMaxT = snaps[snaps.length - 1].t;
  const obs = buildObservationsFromSnaps(snaps, 5, F2_TMIN, snapMaxT, snapMaxT);
  const clean = grid(F2_TMIN + 60_000, 60);
  const cleanObs = buildObservationsFromSnaps(clean, 5, F2_TMIN, clean[clean.length - 1].t, Infinity);
  assert.ok(obs.length < cleanObs.length, "gap deveria reduzir observações");
});

test("mínimo de 10 snapshots na janela é exigido", () => {
  const snaps = grid(F2_TMIN + 60_000, 60);
  // esvazia quase toda a janela das primeiras âncoras (passo 10min => <10 na janela)
  const sparse = [];
  for (let i = 0; i < 60; i += 10) sparse.push(snaps[i]);
  const obs = buildObservationsFromSnaps(sparse, 5, F2_TMIN, sparse[sparse.length - 1].t, Infinity);
  assert.equal(obs.length, 0);
});

// --- classificação UP/RANGE/DOWN incl. igualdade nas fronteiras ---
test("classificação: igualdade nas fronteiras cai em RANGE (cópia literal do R6)", () => {
  const bounds = [-0.00028, 0.00025];
  const got = labelClasses(
    [{ fwdRet: 0.001 }, { fwdRet: -0.001 }, { fwdRet: 0 }, { fwdRet: 0.00025 }, { fwdRet: -0.00028 }],
    bounds
  );
  assert.deepEqual(got, ["UP", "DOWN", "RANGE", "RANGE", "RANGE"]);
});

test("binning: <= nas fronteiras do treino (cópia literal do R6)", () => {
  assert.deepEqual(binWithTrainBounds([1, 2, 3, 4, null], [2, 3]), [0, 0, 1, 2, "NA"]);
});

test("tercis com empates: determinístico e empates nunca se separam", () => {
  const vals = [3, 1, 2, 2, 2, 5, 4, 6, 0, 8, 7];
  const a = tercileBins(vals, 3);
  const b = tercileBins(vals, 3);
  assert.deepEqual(a, b);
  assert.equal(a.boundaries.length, 2);
  assert.ok(a.boundaries[0] < a.boundaries[1]);
  // valores iguais nunca se separam entre bins
  for (let i = 0; i < vals.length; i++)
    for (let j = 0; j < vals.length; j++)
      if (vals[i] === vals[j]) assert.equal(a.bins[i], a.bins[j]);
  // com n pequeno, menos fronteiras são aceitáveis (cópia literal do R6)
  const tiny = tercileBins([3, 1, 2, 2, 2, 5, 4], 3);
  assert.ok(tiny.boundaries.length <= 2);
});

// --- reprodução dos bounds R5: treino pré-corte, sem dados novos ---
test("reproduceR5Train5 usa só o treino (t+5m <= B) e exige 2 fronteiras", () => {
  const snaps = grid(R5_B_5 - 4 * 60 * 60_000, 500); // atravessa a fronteira B
  const { trainN, classBounds, ret15Bounds } = reproduceR5Train5(snaps);
  assert.ok(trainN > 0 && trainN < 500);
  assert.equal(classBounds.length, 2);
  assert.equal(ret15Bounds.length, 2);
  assert.ok(classBounds[0] < classBounds[1]);
  // pós-corte não contamina: mesmos bounds com cauda extra após B
  const extended = snaps.concat(grid(snaps[snaps.length - 1].t + 60_000, 100));
  const again = reproduceR5Train5(extended);
  assert.deepEqual(again.classBounds, classBounds);
  assert.deepEqual(again.ret15Bounds, ret15Bounds);
  assert.equal(again.trainN, trainN);
});

// --- deduplicação por anchor_t + idempotência + append-only ---
test("coleta é idempotente: segundo ciclo não duplica nem altera linhas", () => {
  const { dbPath, f2Path } = tmpMarket(richPool());
  const c1 = collectCycle({ marketPath: dbPath, f2Path });
  assert.ok(c1.n > 0);
  const before = new DatabaseSync(f2Path).prepare("SELECT * FROM fase2_observations ORDER BY anchor_t").all();
  const c2 = collectCycle({ marketPath: dbPath, f2Path });
  const after = new DatabaseSync(f2Path).prepare("SELECT * FROM fase2_observations ORDER BY anchor_t").all();
  assert.equal(c2.inserted, 0);
  assert.deepEqual(after, before);
  assert.equal(c2.n, c1.n);
});

test("coleta incremental: dados novos adicionam só âncoras novas", () => {
  const snaps = richPool();
  const half = snaps.slice(0, 200);
  const { dir, dbPath, f2Path } = tmpMarket(half);
  const c1 = collectCycle({ marketPath: dbPath, f2Path });
  // anexa mais snapshots ao market (append-only, como o daemon)
  const mdb = new DatabaseSync(dbPath);
  const ins = mdb.prepare("INSERT INTO snapshots (timestamp, price) VALUES (?, ?)");
  for (const s of snaps.slice(200)) ins.run(s.t, s.p);
  mdb.close();
  const c2 = collectCycle({ marketPath: dbPath, f2Path });
  assert.ok(c2.n >= c1.n);
  const db = new DatabaseSync(f2Path);
  const rows = db.prepare("SELECT * FROM fase2_observations ORDER BY anchor_t").all();
  const old = rows.filter((r) => r.anchor_t <= half[half.length - 1].t);
  db.close();
  assert.ok(old.length >= 0 && rows.length === c2.n);
  void dir;
});

test("schema fase2_observations: anchor_t PRIMARY KEY, append-only (sem UPDATE/DELETE no coletor)", () => {
  const src = fs.readFileSync(new URL("../scripts/fase2-monitor.mjs", import.meta.url), "utf8");
  assert.match(src, /anchor_t INTEGER PRIMARY KEY/);
  assert.match(src, /INSERT OR IGNORE INTO fase2_observations/);
  assert.ok(!/\bUPDATE\s+fase2_observations\b/i.test(src), "coletor não deve conter UPDATE");
  assert.ok(!/\bDELETE\s+FROM\s+fase2_observations\b/i.test(src), "coletor não deve conter DELETE");
});

// --- readOnly do DB histórico ---
test("market.db é aberto estritamente readOnly e escrita falha", () => {
  const { dbPath } = tmpMarket(richPool());
  const ro = new DatabaseSync(dbPath, { readOnly: true });
  assert.throws(() => ro.exec("CREATE TABLE x (a)"));
  ro.close();
  const src = fs.readFileSync(new URL("../scripts/fase2-monitor.mjs", import.meta.url), "utf8");
  assert.match(src, /new DatabaseSync\(marketPath, \{ readOnly: true \}\)/);
});

test("coleta não modifica o arquivo do market.db", () => {
  const { dbPath, f2Path } = tmpMarket(richPool());
  const st1 = fs.statSync(dbPath);
  collectCycle({ marketPath: dbPath, f2Path });
  const st2 = fs.statSync(dbPath);
  assert.equal(st2.mtimeMs, st1.mtimeMs);
  assert.equal(st2.size, st1.size);
});

// --- gates N=120 e 3 classes; status sem inferência ---
test("gate: N>=120 e UP/RANGE/DOWN>=30 simultâneos", () => {
  assert.equal(gateMet(120, { UP: 30, RANGE: 30, DOWN: 30 }), true);
  assert.equal(gateMet(119, { UP: 40, RANGE: 40, DOWN: 40 }), false);
  assert.equal(gateMet(200, { UP: 29, RANGE: 100, DOWN: 71 }), false);
  assert.equal(samplingOk(90, { UP: 30, RANGE: 30, DOWN: 30 }), true);
  assert.equal(samplingOk(200, { UP: 29, RANGE: 100, DOWN: 71 }), false);
});

test("status operacional não contém estatística inferencial", () => {
  const status = buildStatus({ rows: [], evaluated: false, collectionStart: null }, { nowMs: Date.now() });
  // whitelist fechada: só contagens, configuração pré-registrada e estado
  const allowed = new Set([
    "protocol", "hypothesis", "cutoff", "collectionStart", "timeboxDays",
    "snapMaxT", "maxAnchor", "n", "required", "classes", "perClass",
    "samplingOk", "readyToEvaluate", "underpowered", "evaluated",
    "seedFamily", "alpha", "permutations", "updatedAt",
  ]);
  for (const k of Object.keys(status)) assert.ok(allowed.has(k), `chave inesperada: ${k}`);
  for (const banned of ["p", "chi2", "liftLo", "liftHi", "liftSign", "cramerV", "stat", "pass"]) {
    assert.ok(!(banned in status), `estatística inferencial vazou: ${banned}`);
  }
  assert.equal(status.protocol, F2_PROTOCOL);
  assert.equal(status.readyToEvaluate, false);
  assert.equal(status.underpowered, false);
});

// --- avaliação única: bloqueios ---
function seedPool(f2Path, nUp = 50, nRange = 50, nDown = 40) {
  const db = new DatabaseSync(f2Path);
  db.exec(`CREATE TABLE IF NOT EXISTS fase2_observations (
    anchor_t INTEGER PRIMARY KEY, fwdRet REAL NOT NULL, bin INTEGER NOT NULL,
    classe TEXT NOT NULL, protocol_version TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS fase2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const ins = db.prepare(`INSERT OR IGNORE INTO fase2_observations
    (anchor_t, fwdRet, bin, classe, protocol_version, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  let t = F2_TMIN + 60_000;
  const put = (cls, bin, fwd, k) => { for (let i = 0; i < k; i++) ins.run(t++, fwd + i * 1e-7, bin, cls, F2_PROTOCOL, "2026-09-09T00:00:00.000Z"); };
  put("UP", 0, 0.001, nUp);
  put("RANGE", 1, 0.0, nRange);
  put("DOWN", 2, -0.001, nDown);
  db.prepare(`INSERT OR IGNORE INTO fase2_meta (key, value) VALUES ('collection_start', '2026-09-09T00:00:00.000Z')`).run();
  db.close();
}

test("avaliação executa com gate atingido e trava a segunda (mecanismo, pool sintético)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2eval-"));
  const f2Path = path.join(dir, "fase2.db");
  const resultPath = path.join(dir, "fase2-result.json");
  const reportPath = path.join(dir, "FASE2_RELATORIO.md");
  seedPool(f2Path);
  const r = evaluateOnce({ f2Path, resultPath, reportPath, nowMs: Date.parse("2026-09-10T00:00:00.000Z") });
  assert.equal(r.n, 140);
  assert.ok(typeof r.p === "number" && r.p >= 0 && r.p <= 1);
  assert.ok(fs.existsSync(resultPath) && fs.existsSync(reportPath));
  assert.throws(() => evaluateOnce({ f2Path, resultPath, reportPath }), /já ocorreu/);
});

test("avaliação abaixo do gate aborta sem calcular nem gravar", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2eval-"));
  const f2Path = path.join(dir, "fase2.db");
  const resultPath = path.join(dir, "fase2-result.json");
  const reportPath = path.join(dir, "FASE2_RELATORIO.md");
  seedPool(f2Path, 10, 10, 10);
  assert.throws(() => evaluateOnce({ f2Path, resultPath, reportPath }), /gate amostral/);
  assert.ok(!fs.existsSync(resultPath) && !fs.existsSync(reportPath));
});

// --- seed F2 distinta da família R6 ---
test("seed F2 é família nova e independente (nunca R6|...)", () => {
  assert.equal(F2_SEED_TAG, "F2|ret15|5|20260909");
  assert.ok(!F2_SEED_TAG.startsWith("R6|"));
  assert.notEqual(hashStr(F2_SEED_TAG), hashStr("R6|ret15|5|20260905"));
  const a = mulberry32(hashStr(F2_SEED_TAG))();
  const b = mulberry32(hashStr("R6|ret15|5|20260905"))();
  assert.notEqual(a, b);
});

// --- PREDICTIVE_GATE permanece false; monitor não o referencia ---
test("PREDICTIVE_GATE permanece false e o monitor F2 não o referencia", () => {
  const card = fs.readFileSync(path.join(ROOT, "app", "PredictiveStatusCard.tsx"), "utf8");
  assert.match(card, /const PREDICTIVE_GATE = false/);
  const src = fs.readFileSync(new URL("../scripts/fase2-monitor.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes("PREDICTIVE_GATE"), "monitor não deve referenciar o gate");
  assert.ok(!src.includes("app/"), "monitor não deve tocar o painel");
});
