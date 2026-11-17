// scripts/fase2-monitor.mjs — F2-v1: coleta prospectiva da hipótese R6 confirmada.
// Pré-registro: DECISOES.md "Pré-registro F2-v1 (2026-09-09)". Implementação da
// infraestrutura de COLETA; a avaliação estatística única vive neste mesmo arquivo
// mas SÓ executa sob flag explícita `--evaluate-once` e trava após a primeira vez.
//
// GARANTIAS (não negociáveis):
//   - Modo padrão (sem flags): SÓ coleta + contagens. Nenhum χ² / p-valor / lift /
//     Cramér V é calculado. Nenhuma estatística inferencial entra em
//     public/fase2-status.json antes da avaliação única.
//   - market.db é aberto ESTRITAMENTE readOnly. A persistência F2 vive em ARQUIVO
//     SEPARADO services/market-ingestion/data/fase2.db (tabela fase2_observations).
//     Nenhuma escrita toca snapshots/events/regime_events.
//   - NÃO toca o gate de liberação de probabilidades, NÃO toca o painel do
//     Observatório, NÃO toca R5/R6 (scripts, relatórios, seeds, cortes,
//   - Hipótese única: ret15 @ 5m, lógica congelada copiada literalmente do R6
//     (buildObservations, tercileBins, labelClasses, binWithTrainBounds).
//
// Persistência append-only: anchor_t PRIMARY KEY + INSERT OR IGNORE; nenhuma
// observação persistida é alterada ou apagada por este script (sem UPDATE/DELETE).
// Trava de avaliação: meta evaluated=1 + existência de FASE2_RELATORIO.md /
// fase2-result.json — segunda avaliação aborta sem calcular nada.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const MARKET_DB = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const F2_DB = path.join(root, 'services', 'market-ingestion', 'data', 'fase2.db');
const STATUS_PATH = path.join(root, 'public', 'fase2-status.json');
const REPORT_PATH = path.join(root, 'FASE2_RELATORIO.md');
const RESULT_PATH = path.join(root, 'services', 'market-ingestion', 'data', 'fase2-result.json');

// ── Constantes F2-v1 (pré-registro DECISOES.md 2026-09-09 — congeladas aqui) ──
export const F2_PROTOCOL = 'F2-v1';
export const F2_H = 5;
export const F2_FEATURE = 'ret15';
const FEATURE_WINDOW_MIN = 15;
const OUTCOME_TOLERANCE_MS = 150_000;
const WINDOW_MIN_SNAPS = 10;
const GAP_BREAK_MS = 180_000;
const F2_CUT_MS = Date.parse('2026-09-09T02:20:26.856Z'); // execução única do R6
const F2_TMIN = F2_CUT_MS + FEATURE_WINDOW_MIN * 60_000; // elegível ⇔ t − 15min > corte
const R5_B_5 = Date.parse('2026-09-01T22:39:41.055Z'); // fronteira B do treino R5 (5m), cópia do R6
const TRIGGER_N = 120;
const MIN_N_PER_CLASS = 30;
const ALPHA = 0.0056; // decisão humana explícita (comparabilidade com R6; família de 1 teste)
const PERMUTATIONS = 999;
const TIMEBOX_MS = 14 * 24 * 60 * 60_000;
export const F2_SEED_TAG = 'F2|ret15|5|20260909'; // família nova e independente; nunca "R6|..."
const REF_SIGN = -1;

// ── Helpers estatísticos (cópia literal do R6 congelado) ──
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) { // FNV-1a 32 bit — derivação de seed legível e estável
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const rngF2 = () => mulberry32(hashStr(F2_SEED_TAG));
function shuffleWith(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildTable(bins, classes) {
  const rowIds = [...new Set(bins)].sort();
  const colIds = [...new Set(classes)].sort();
  const t = rowIds.map(() => colIds.map(() => 0));
  for (let i = 0; i < bins.length; i++) t[rowIds.indexOf(bins[i])][colIds.indexOf(classes[i])]++;
  return t;
}
export function chi2Stat(table) {
  const rows = table.length, cols = table[0].length;
  const rowTot = table.map(r => r.reduce((a, b) => a + b, 0));
  const colTot = [];
  for (let c = 0; c < cols; c++) colTot.push(table.reduce((a, r) => a + r[c], 0));
  const N = rowTot.reduce((a, b) => a + b, 0);
  if (N === 0) return { stat: 0, expectedMin: 0, lowCells: 0 };
  let stat = 0, expectedMin = Infinity, lowCells = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const exp = (rowTot[i] * colTot[j]) / N;
      if (exp < expectedMin) expectedMin = exp;
      if (exp < 5) lowCells++;
      if (exp > 0) stat += (table[i][j] - exp) ** 2 / exp;
    }
  }
  return { stat, expectedMin, lowCells };
}
export const cramerV = (stat, N, rows, cols) => Math.sqrt(Math.max(0, stat) / (N * (Math.min(rows, cols) - 1)));
export function permutationP(featureBins, classes, nPerm, rng) {
  const obs = chi2Stat(buildTable(featureBins, classes)).stat;
  let count = 0;
  const perm = classes.slice();
  for (let i = 0; i < nPerm; i++) {
    shuffleWith(perm, rng);
    if (chi2Stat(buildTable(featureBins, perm)).stat >= obs) count++;
  }
  return (count + 1) / (nPerm + 1);
}
export function meanCI(xs) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean: m, lo: m - 1.96 * sd / Math.sqrt(n), hi: m + 1.96 * sd / Math.sqrt(n) };
}

// Tercis com empates (cópia literal do R6 — determinística, sem RNG).
export function tercileBins(values, nBins = 3) {
  const n = values.length;
  const bins = new Array(n).fill(nBins - 1);
  const boundaries = [];
  if (n === 0) return { bins, boundaries };
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  let lo = 0;
  for (let k = 0; k < nBins - 1; k++) {
    const target = Math.floor((k + 1) * n / nBins);
    if (target <= lo || target >= n) break;
    let cut = target;
    while (cut < n && idx[cut].v === idx[target - 1].v) cut++;
    if (cut <= lo) break;
    boundaries.push(idx[cut - 1].v);
    for (let i = lo; i < cut; i++) bins[idx[i].i] = k;
    lo = cut;
  }
  return { bins, boundaries };
}

// Observações (lógica idêntica à congelada do R6; tMin filtra o pool; snapMaxT
// congela o ciclo — dados que surjam depois do início do ciclo não entram nele;
// anchorMaxT exclui a borda viva: só âncoras com outcome integralmente consolidado).
export function buildObservationsFromSnaps(snaps, h, tMin = -Infinity, snapMaxT = Infinity, anchorMaxT = Infinity) {
  const obs = [];
  let lastAnchor = -Infinity;
  for (let i = 0; i < snaps.length; i++) {
    const t = snaps[i].t;
    if (t > snapMaxT) break; // ciclo congelado: ignora o que surgiu depois do início
    if (t <= tMin) continue; // pool prospectivo: tMin = corte + 15min
    if (t > anchorMaxT) continue; // borda viva: outcome ainda não consolidável
    if (t - lastAnchor < h * 60_000) continue;

    const win = [];
    let ok = true;
    for (let j = i; j >= 0; j--) {
      if (snaps[j].t < t - FEATURE_WINDOW_MIN * 60_000) break;
      if (win.length > 0 && snaps[j + 1].t - snaps[j].t > GAP_BREAK_MS) { ok = false; break; }
      win.unshift(snaps[j]);
    }
    if (!ok || win.length < WINDOW_MIN_SNAPS) continue;

    const target = t + h * 60_000;
    let outcome = null, k = i;
    for (; k < snaps.length; k++) {
      if (snaps[k].t > snapMaxT) break;
      if (k > i && snaps[k].t - snaps[k - 1].t > GAP_BREAK_MS) break;
      if (snaps[k].t >= target - OUTCOME_TOLERANCE_MS) {
        outcome = snaps[k];
        if (k > i && Math.abs(snaps[k].t - target) > Math.abs(snaps[k - 1].t - target)) outcome = snaps[k - 1];
        break;
      }
    }
    if (!outcome || Math.abs(outcome.t - target) > OUTCOME_TOLERANCE_MS) continue;

    const f = win[0], l = win[win.length - 1];
    lastAnchor = t;
    obs.push({ t, ret15: l.p / f.p - 1, fwdRet: outcome.p / l.p - 1 });
  }
  return obs;
}

// Regra de fronteira literal do R6 (igualdade cai em RANGE — sem arredondamento).
export function labelClasses(obs, bounds) {
  return obs.map(o => (o.fwdRet > bounds[1] ? 'UP' : o.fwdRet < bounds[0] ? 'DOWN' : 'RANGE'));
}
// Binning por tercis do TREINO R5 reaplicado (ramo fixedBoundaries do congelado).
export function binWithTrainBounds(vals, boundaries) {
  return vals.map(v => (v === null || v === undefined ? 'NA' : v <= boundaries[0] ? 0 : v <= boundaries[1] ? 1 : 2));
}
export function lift(rets, bins) {
  const by = {};
  for (let i = 0; i < bins.length; i++) {
    const k = String(bins[i]);
    if (k === 'NA') continue;
    (by[k] = by[k] || []).push(rets[i]);
  }
  const keys = Object.keys(by).sort();
  if (keys.length < 2) return null;
  const lo = meanCI(by[keys[0]]), hi = meanCI(by[keys[keys.length - 1]]);
  return { lo: lo.mean, hi: hi.mean, nLo: lo.n, nHi: hi.n, sign: Math.sign(hi.mean - lo.mean) };
}

// Reprodução das fronteiras do TREINO R5 para h=5 (determinística, sem RNG,
// sem dados novos — o pool F2 nunca entra aqui).
export function reproduceR5Train5(snaps) {
  const all = buildObservationsFromSnaps(snaps, F2_H);
  const train = all.filter(o => o.t + F2_H * 60_000 <= R5_B_5); // split R5: purging t+h ≤ B
  const { boundaries: classBounds } = tercileBins(train.map(o => o.fwdRet), 3);
  if (classBounds.length !== 2) throw new Error('[F2] treino R5 reproduzido sem 2 fronteiras — abortar');
  const valid = train.map(o => o.ret15).filter(v => v !== null && v !== undefined);
  const { boundaries: ret15Bounds } = tercileBins(valid, 3);
  if (ret15Bounds.length !== 2) throw new Error('[F2] feature ret15 sem 2 fronteiras no treino R5 — abortar');
  return { trainN: train.length, classBounds, ret15Bounds };
}

export function classCounts(labels) {
  const c = { UP: 0, RANGE: 0, DOWN: 0 };
  for (const l of labels) c[l]++;
  return c;
}
export function samplingOk(n, cc) {
  return n >= MIN_N_PER_CLASS * 3 && cc.UP >= MIN_N_PER_CLASS && cc.RANGE >= MIN_N_PER_CLASS && cc.DOWN >= MIN_N_PER_CLASS;
}
export function gateMet(n, cc) {
  return n >= TRIGGER_N && cc.UP >= MIN_N_PER_CLASS && cc.RANGE >= MIN_N_PER_CLASS && cc.DOWN >= MIN_N_PER_CLASS;
}

// ── Persistência F2 (arquivo separado; market.db jamais recebe escrita) ──
export function openF2Db(f2Path = F2_DB) {
  const db = new DatabaseSync(f2Path);
  db.exec(`CREATE TABLE IF NOT EXISTS fase2_observations (
    anchor_t INTEGER PRIMARY KEY,
    fwdRet REAL NOT NULL,
    bin INTEGER NOT NULL,
    classe TEXT NOT NULL,
    protocol_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS fase2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}
export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM fase2_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}
export function setMetaOnce(db, key, value) {
  db.prepare('INSERT OR IGNORE INTO fase2_meta (key, value) VALUES (?, ?)').run(key, value);
}

// Ciclo de coleta: readOnly no histórico; insere só o ainda não persistido.
// NUNCA calcula estatística inferencial. Retorna contagens para o status.
export function collectCycle({ marketPath = MARKET_DB, f2Path = F2_DB, nowMs = Date.now() } = {}) {
  const mdb = new DatabaseSync(marketPath, { readOnly: true });
  const snaps = mdb.prepare('SELECT timestamp t, price p FROM snapshots ORDER BY timestamp').all();
  mdb.close();
  if (snaps.length === 0) throw new Error('[F2] market.db sem snapshots — abortar');

  const snapMaxT = snaps[snaps.length - 1].t; // ciclo congelado neste limite
  const anchorMaxT = snapMaxT - F2_H * 60_000 - OUTCOME_TOLERANCE_MS; // borda viva excluída
  const { classBounds, ret15Bounds } = reproduceR5Train5(snaps);
  const fresh = buildObservationsFromSnaps(snaps, F2_H, F2_TMIN, snapMaxT, anchorMaxT);
  const classes = labelClasses(fresh, classBounds);
  const bins = binWithTrainBounds(fresh.map(o => o.ret15), ret15Bounds);

  const db = openF2Db(f2Path);
  if (getMeta(db, 'collection_start') === null) {
    setMetaOnce(db, 'collection_start', new Date(nowMs).toISOString());
  }
  setMetaOnce(db, 'protocol_version', F2_PROTOCOL);
  const ins = db.prepare(`INSERT OR IGNORE INTO fase2_observations
    (anchor_t, fwdRet, bin, classe, protocol_version, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const createdAt = new Date(nowMs).toISOString();
  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const r = ins.run(fresh[i].t, fresh[i].fwdRet, bins[i], classes[i], F2_PROTOCOL, createdAt);
    inserted += Number(r.changes > 0);
  }
  const rows = db.prepare('SELECT anchor_t, classe FROM fase2_observations ORDER BY anchor_t').all();
  db.close();

  const cc = classCounts(rows.map(r => r.classe));
  return { snapMaxT, anchorMaxT, cycleFresh: fresh.length, inserted, n: rows.length, classes: cc };
}

export function readPoolCounts(f2Path = F2_DB) {
  const db = openF2Db(f2Path);
  const rows = db.prepare('SELECT anchor_t, fwdRet, bin, classe FROM fase2_observations ORDER BY anchor_t').all();
  const evaluated = getMeta(db, 'evaluated') === '1';
  const collectionStart = getMeta(db, 'collection_start');
  db.close();
  return { rows, evaluated, collectionStart };
}

// Status operacional — SOMENTE contagens; nenhuma estatística inferencial.
export function buildStatus(counts, { snapMaxT = null, nowMs = Date.now(), resultPath = RESULT_PATH, reportPath = REPORT_PATH } = {}) {
  const n = counts.rows.length;
  const cc = classCounts(counts.rows.map(r => r.classe));
  const ready = gateMet(n, cc);
  let underpowered = false;
  if (counts.collectionStart && !ready) {
    underpowered = nowMs - Date.parse(counts.collectionStart) > TIMEBOX_MS;
  }
  return {
    protocol: F2_PROTOCOL,
    hypothesis: { feature: F2_FEATURE, horizonMin: F2_H },
    cutoff: new Date(F2_CUT_MS).toISOString(),
    collectionStart: counts.collectionStart,
    timeboxDays: 14,
    snapMaxT,
    maxAnchor: n > 0 ? counts.rows[n - 1].anchor_t : null,
    n,
    required: TRIGGER_N,
    classes: cc,
    perClass: MIN_N_PER_CLASS,
    samplingOk: samplingOk(n, cc),
    readyToEvaluate: ready,
    underpowered,
    evaluated: counts.evaluated || fs.existsSync(resultPath) || fs.existsSync(reportPath),
    seedFamily: F2_SEED_TAG,
    alpha: ALPHA,
    permutations: PERMUTATIONS,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

export function writeStatusAtomic(status, statusPath = STATUS_PATH) {
  const tmp = statusPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2) + '\n');
  fs.renameSync(tmp, statusPath);
}

// Avaliação única — SÓ sob flag explícita; trava persistente anti-repetição.
// NÃO executar antes do gate amostral; NÃO executar se time-box estourou sem gate.
export function evaluateOnce({ f2Path = F2_DB, resultPath = RESULT_PATH, reportPath = REPORT_PATH, nowMs = Date.now() } = {}) {
  if (fs.existsSync(reportPath)) {
    throw new Error(`[F2] ${reportPath} já existe — avaliação já ocorreu. Repetir é proibido. Abortando sem calcular nada.`);
  }
  if (fs.existsSync(resultPath)) {
    throw new Error(`[F2] ${resultPath} já existe — avaliação já ocorreu. Repetir é proibido. Abortando sem calcular nada.`);
  }
  const db = openF2Db(f2Path);
  if (getMeta(db, 'evaluated') === '1') {
    db.close();
    throw new Error('[F2] meta evaluated=1 — avaliação já ocorreu. Repetir é proibido. Abortando sem calcular nada.');
  }
  const rows = db.prepare('SELECT anchor_t, fwdRet, bin, classe FROM fase2_observations ORDER BY anchor_t').all();
  const collectionStart = getMeta(db, 'collection_start');
  const n = rows.length;
  const cc = classCounts(rows.map(r => r.classe));
  if (!gateMet(n, cc)) {
    db.close();
    throw new Error(`[F2] gate amostral não atingido (N=${n}, UP=${cc.UP} RANGE=${cc.RANGE} DOWN=${cc.DOWN}) — abortando sem calcular nenhum teste.`);
  }
  if (collectionStart && nowMs - Date.parse(collectionStart) > TIMEBOX_MS) {
    db.close();
    throw new Error('[F2] time-box de 14 dias estourado — pool encerrado como UNDERPOWERED para fins de avaliação única. Abortando.');
  }

  const bins = rows.map(r => r.bin);
  const cls = rows.map(r => r.classe);
  const table = buildTable(bins, cls);
  const { stat } = chi2Stat(table);
  const p = permutationP(bins, cls, PERMUTATIONS, rngF2()); // seed própria F2, passada única
  const lf = lift(rows.map(r => r.fwdRet), bins);
  const signOk = lf !== null && lf.sign === REF_SIGN;
  const pass = p < ALPHA && signOk;
  const v = cramerV(stat, n, table.length, 3);
  const result = {
    protocol: F2_PROTOCOL,
    hypothesis: { feature: F2_FEATURE, horizonMin: F2_H },
    seedFamily: F2_SEED_TAG,
    alpha: ALPHA,
    permutations: PERMUTATIONS,
    evaluatedAt: new Date(nowMs).toISOString(),
    n, classes: cc,
    chi2: stat, p, cramerV: v,
    liftLo: lf?.lo ?? null, liftHi: lf?.hi ?? null, liftSign: lf?.sign ?? null, refSign: REF_SIGN,
    pass,
  };
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n');
  const md = [
    `# FASE 2 — RELATÓRIO F2-v1 (avaliação única de ${result.evaluatedAt})`,
    ``,
    `Hipótese: ret15 @ 5m (definição R6 congelada) · seed ${F2_SEED_TAG} · 999 permutações · α = ${ALPHA}`,
    `Pool: N=${n} (UP=${cc.UP} RANGE=${cc.RANGE} DOWN=${cc.DOWN}) · corte t−15min > ${new Date(F2_CUT_MS).toISOString()}`,
    ``,
    `| χ² | p-perm | Cramér V | Lift (alto−baixo) | sinal ref. | PASS |`,
    `|---|---|---|---|---|---|`,
    `| ${stat.toFixed(1)} | ${p.toFixed(4)} | ${v.toFixed(3)} | ${lf === null ? '—' : `${(lf.lo * 100).toFixed(3)}% → ${(lf.hi * 100).toFixed(3)}%`} | −1 (obtido ${lf?.sign ?? '—'}) | ${pass ? 'PASS' : 'não'} |`,
    ``,
    `Veredito F2-v1: ${pass ? 'PASS — sinal replicado no pool prospectivo independente' : 'não PASS — sem replicação'}.`,
    `Gate de liberação de probabilidades inalterado — qualquer liberação exige revisão humana registrada em DECISOES.md.`,
    ``,
  ].join('\n');
  fs.writeFileSync(reportPath, md);
  db.prepare(`INSERT OR IGNORE INTO fase2_meta (key, value) VALUES ('evaluated', '1')`).run();
  db.prepare(`INSERT OR IGNORE INTO fase2_meta (key, value) VALUES ('evaluated_at', ?)`)
    .run(result.evaluatedAt);
  db.close();
  return result;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--evaluate-once')) {
    const result = evaluateOnce();
    console.log(`[fase2] avaliação única concluída: N=${result.n} p=${result.p.toFixed(4)} PASS=${result.pass ? 'PASS' : 'não'}`);
    return;
  }
  // Modo padrão: SOMENTE coleta + contagens. Nenhuma inferência aqui.
  const cycle = collectCycle();
  const counts = readPoolCounts();
  const status = buildStatus(counts, { snapMaxT: cycle.snapMaxT });
  writeStatusAtomic(status);
  console.log(`[fase2] ${status.updatedAt} pool N=${status.n}/${TRIGGER_N} ` +
    `(UP=${status.classes.UP} RANGE=${status.classes.RANGE} DOWN=${status.classes.DOWN}) ` +
    `novas=${cycle.inserted} ready=${status.readyToEvaluate} underpowered=${status.underpowered}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
