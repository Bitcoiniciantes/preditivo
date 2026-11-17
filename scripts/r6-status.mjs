// scripts/r6-status.mjs
// Monitor operacional do pool prospectivo R6 — SÓ CONTAGENS, nenhum teste.
//
// O QUE FAZ: abre o SQLite em readOnly, reconstrói as observações elegíveis com a
// lógica de amostragem congelada (janela 15m íntegra + outcome, stride = horizonte),
// rotula classes com as fronteiras do TREINO R5 reproduzidas deterministicamente e
// escreve public/r6-status.json (N por horizonte, classes, faltas, status geral).
//
// O QUE NÃO FAZ (proibido por DECISOES.md): executar o R6 estatístico, calcular
// χ² / p-perm / lifts / Cramér V (este arquivo NÃO contém esse código), alterar
// dados, features, thresholds, classes, fronteiras, seeds, corte, família,
// critérios ou PREDICTIVE_GATE. O frontend apenas apresenta o JSON.
//
// CONSTANTES: cópias literais das congeladas em scripts/fase1-r6-confirmatorio.mjs
// (elas próprias cópias de scripts/fase1-experimento-minimo.mjs). Qualquer mudança
// exige revisão registrada em DECISOES.md — nunca editar aqui isoladamente.
//
// AGENDAMENTO: Task Scheduler "Preditivo-R6-Status" a cada 5 min (baixa frequência).
// Transição AGUARDANDO → PRONTO: linha única "[R6] READY …" no stdout + append em
// services/market-ingestion/logs/r6-status.log. Não executa o experimento.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dbPath = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const OUT_PATH = path.join(root, 'public', 'r6-status.json');
const READY_LOG = path.join(root, 'services', 'market-ingestion', 'logs', 'r6-status.log');

// ── Amostragem congelada (cópia literal — ver cabeçalho) ──
const FEATURE_WINDOW_MIN = 15;
const HORIZONS = [5, 15, 30];
const OUTCOME_TOLERANCE_MS = 150_000;
const WINDOW_MIN_SNAPS = 10;
const GAP_BREAK_MS = 180_000;
const R5_CUT_MS = Date.parse('2026-09-05T22:13:40.401Z');
const R5_B = {
  5: Date.parse('2026-09-01T22:39:41.055Z'),
  15: Date.parse('2026-09-02T00:52:41.905Z'),
  30: Date.parse('2026-09-02T03:57:57.927Z'),
};
const FRESH_TMIN = R5_CUT_MS + FEATURE_WINDOW_MIN * 60_000;

// ── Gate operacional do R6 (DECISOES.md 2026-09-07 — por horizonte) ──
const REQUIRED_N = 120;
const REQUIRED_PER_CLASS = 30;

// Tercis com empates (cópia idêntica do congelado — determinística, sem RNG).
function tercileBins(values, nBins = 3) {
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

const db = new DatabaseSync(dbPath, { readOnly: true });
// Só t e price: elegibilidade e classes não usam mais nada (sem features no monitor).
const snaps = db.prepare('SELECT timestamp t, price p FROM snapshots ORDER BY timestamp').all();

// Observações elegíveis (lógica idêntica à congelada; tMin seleciona o pool).
// Nota: checagem de reset de CVD omitida de propósito — ela afeta features (que o
// monitor não calcula), nunca a elegibilidade da âncora.
function buildObservations(h, tMin = -Infinity) {
  const obs = [];
  let lastAnchor = -Infinity;
  for (let i = 0; i < snaps.length; i++) {
    const t = snaps[i].t;
    if (t <= tMin) continue;
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
      if (k > i && snaps[k].t - snaps[k - 1].t > GAP_BREAK_MS) break;
      if (snaps[k].t >= target - OUTCOME_TOLERANCE_MS) {
        outcome = snaps[k];
        if (k > i && Math.abs(snaps[k].t - target) > Math.abs(snaps[k - 1].t - target)) outcome = snaps[k - 1];
        break;
      }
    }
    if (!outcome || Math.abs(outcome.t - target) > OUTCOME_TOLERANCE_MS) continue;

    lastAnchor = t;
    obs.push({ t, fwdRet: outcome.p / snaps[i].p - 1 });
  }
  return obs;
}

function labelClasses(obs, bounds) {
  return obs.map(o => (o.fwdRet > bounds[1] ? 'UP' : o.fwdRet < bounds[0] ? 'DOWN' : 'RANGE'));
}

const horizons = {};
for (const h of HORIZONS) {
  // Fronteiras do TREINO R5 reproduzidas deterministicamente (sem RNG, sem dados novos).
  const train = buildObservations(h).filter(o => o.t + h * 60_000 <= R5_B[h]);
  const { boundaries: classBounds } = tercileBins(train.map(o => o.fwdRet), 3);
  if (classBounds.length !== 2) throw new Error(`[r6-status] treino R5 sem 2 fronteiras (h=${h}) — abortar`);
  const fresh = buildObservations(h, FRESH_TMIN);
  const classes = { UP: 0, RANGE: 0, DOWN: 0 };
  for (const l of labelClasses(fresh, classBounds)) classes[l]++;
  const remaining = {
    n: Math.max(0, REQUIRED_N - fresh.length),
    UP: Math.max(0, REQUIRED_PER_CLASS - classes.UP),
    RANGE: Math.max(0, REQUIRED_PER_CLASS - classes.RANGE),
    DOWN: Math.max(0, REQUIRED_PER_CLASS - classes.DOWN),
  };
  horizons[`${h}m`] = {
    n: fresh.length,
    required: REQUIRED_N,
    classes,
    remaining,
    met: remaining.n === 0 && remaining.UP === 0 && remaining.RANGE === 0 && remaining.DOWN === 0,
  };
}
db.close();

const ready = HORIZONS.every(h => horizons[`${h}m`].met);
const nowIso = new Date().toISOString();

// Transição: compara com o JSON anterior; dispara UMA vez (false → true).
let prev = null;
try { prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); } catch { prev = null; }
let readyAt = null;
if (ready) readyAt = (prev && prev.readyAt) || nowIso;

const status = {
  updatedAt: nowIso,
  cut: new Date(R5_CUT_MS).toISOString(),
  ready,
  readyAt,
  trigger: { required: REQUIRED_N, perClass: REQUIRED_PER_CLASS },
  horizons,
};

if (ready && !(prev && prev.ready)) {
  const line = `${nowIso} [R6] READY — all horizons and classes reached confirmatory gate (execução estatística continua manual e única; experimento NÃO executado por este monitor)`;
  console.log(line);
  try { fs.appendFileSync(READY_LOG, line + '\n'); }
  catch (e) { console.error(`[r6-status] falha ao anexar ${READY_LOG}: ${e.message}`); }
}

// Escrita atômica (tmp + rename) para o frontend nunca ler JSON parcial.
const tmp = OUT_PATH + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(status, null, 2) + '\n');
fs.renameSync(tmp, OUT_PATH);

const short = HORIZONS.map(h => `${h}m:${horizons[`${h}m`].n}/${REQUIRED_N}`).join(' ');
console.log(`[r6-status] ${nowIso} ${short} ready=${ready}`);
