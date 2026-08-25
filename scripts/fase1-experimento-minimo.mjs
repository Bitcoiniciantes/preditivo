// scripts/fase1-experimento-minimo.mjs
// Fase 1 — Experimento mínimo (PROJETO_COMPORTAMENTO_PREDITIVO_15Mv3 § Fase 1)
//
// Hipótese central: as condições observáveis nos últimos 15 minutos possuem associação
// estatisticamente mensurável com o comportamento futuro do BTC nos horizontes definidos?
//
// Regras aplicadas (obrigatórias):
//   - N ≥ 30 para qualquer probabilidade por classe exibida (abaixo disso: marcado N<30);
//   - probability ≠ confidence (reportamos p-valores e N; nada é "confidence");
//   - separação temporal rigorosa: split por tempo + purging (t + h ≤ fronteira) +
//     embargo (teste começa em fronteira + H_MAX = 30 min);
//   - nenhum dado posterior ao timestamp da previsão entra nas features (janela [t-15m, t]);
//   - classes UP/RANGE/DOWN por tercis do retorno à frente calculados SOMENTE no treino;
//   - comparação treino/teste por regime e volatilidade (vol. realizada intra-janela);
//   - sem migração de SQLite; sem features fora da lista do experimento;
//   - whale events analisados em seção separada (persistência ativada em 2026-08-25T23:07Z);
//   - retornos somente na granularidade realmente disponível (snapshots 1/min quando online).

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dbPath = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

// ── Configuração do experimento ──
const FEATURE_WINDOW_MIN = 15;          // janela de features (hipótese)
const HORIZONS = [5, 15, 30];           // minutos — horizontes definidos
const H_MAX = 30;                       // maior horizonte (usado no embargo)
const OUTCOME_TOLERANCE_MS = 150_000;   // ±2.5 min p/ o snapshot de outcome mais próximo
const WINDOW_MIN_SNAPS = 10;            // snaps mínimos dentro da janela de 15m
const GAP_BREAK_MS = 180_000;           // gap > 3 min = quebra de segmento (daemon offline)
const TRAIN_FRACTION = 0.7;
const PERMUTATIONS = 999;
const MIN_N_PER_CLASS = 30;
const N_TESTS = 33;                     // 11 features × 3 horizontes (Bonferroni)
const SEED = 20260825;

// ── Helpers estatísticos ──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildTable(bins, classes) {
  const rowIds = [...new Set(bins)].sort();
  const colIds = [...new Set(classes)].sort();
  const t = rowIds.map(() => colIds.map(() => 0));
  for (let i = 0; i < bins.length; i++) t[rowIds.indexOf(bins[i])][colIds.indexOf(classes[i])]++;
  return t;
}
function chi2Stat(table) {
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
const cramerV = (stat, N, rows, cols) => Math.sqrt(Math.max(0, stat) / (N * (Math.min(rows, cols) - 1)));
function permutationP(featureBins, classes, nPerm) {
  const obs = chi2Stat(buildTable(featureBins, classes)).stat;
  let count = 0;
  const perm = classes.slice();
  for (let i = 0; i < nPerm; i++) {
    shuffle(perm);
    if (chi2Stat(buildTable(featureBins, perm)).stat >= obs) count++;
  }
  return (count + 1) / (nPerm + 1);
}
function meanCI(xs) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean: m, lo: m - 1.96 * sd / Math.sqrt(n), hi: m + 1.96 * sd / Math.sqrt(n) };
}

// Tercis com empates: todo o grupo de mesmo valor cai no bin inferior; pode resultar em < 3 bins.
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

// ── Carregamento ──
const snaps = db.prepare(
  'SELECT timestamp t, price p, cvd, cvd_large, oi, oi_change, book_imbalance, score, regime FROM snapshots ORDER BY timestamp'
).all();
const regimeEvents = db.prepare('SELECT timestamp t, event_type FROM regime_events ORDER BY timestamp').all();
const whaleEvents = db.prepare('SELECT timestamp t, event_type, magnitude, direction FROM events ORDER BY timestamp').all();

function countInWindow(list, from, to, pred) {
  let c = 0;
  for (const e of list) { if (e.t >= to) break; if (e.t >= from && (!pred || pred(e.event_type))) c++; }
  return c;
}

// ── Observações ──
// Âncoras = timestamps de snapshots com stride = h (janelas de outcome sem sobreposição).
// Janela de features [t-15m, t] íntegra (sem gap > 3 min, ≥ 10 snaps) e outcome em t+h no
// mesmo segmento, dentro de ±2.5 min. Resets de CVD na janela → features de CVD = null.
function buildObservations(h) {
  const obs = [];
  let lastAnchor = -Infinity;
  for (let i = 0; i < snaps.length; i++) {
    const t = snaps[i].t;
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

    let cvdReset = false;
    for (let j = 1; j < win.length; j++) {
      const prev = win[j - 1].cvd, cur = win[j].cvd;
      if (prev > 0 && cur < prev * 0.5) { cvdReset = true; break; }
    }
    const f = win[0], l = win[win.length - 1];
    const rets = [];
    for (let j = 1; j < win.length; j++) rets.push((win[j].p - win[j - 1].p) / win[j - 1].p);
    const vol = Math.sqrt(rets.reduce((a, b) => a + b * b, 0) / rets.length);

    const wFrom = t - FEATURE_WINDOW_MIN * 60_000;
    lastAnchor = t;
    obs.push({
      t, h,
      ret15: l.p / f.p - 1,
      cvdDelta: cvdReset ? null : l.cvd - f.cvd,
      cvdLargeDelta: cvdReset ? null : l.cvd_large - f.cvd_large,
      oiMean: win.reduce((a, s) => a + s.oi, 0) / win.length,
      oiChangeMean: win.reduce((a, s) => a + s.oi_change, 0) / win.length,
      imbMean: win.reduce((a, s) => a + s.book_imbalance, 0) / win.length,
      scoreMean: win.reduce((a, s) => a + s.score, 0) / win.length,
      regime: l.regime,
      vol,
      flow: countInWindow(regimeEvents, wFrom, t, (et) => et === 'flow_change'),
      abs: countInWindow(regimeEvents, wFrom, t, (et) => et.startsWith('absorption_')),
      div: countInWindow(regimeEvents, wFrom, t, (et) => et.startsWith('divergence')),
      fwdRet: outcome.p / l.p - 1,
    });
  }
  return obs;
}

// Split com purging (t + h ≤ fronteira) + embargo (teste começa em fronteira + H_MAX)
function splitTrainTest(obs, h) {
  const times = obs.map(o => o.t).sort((a, b) => a - b);
  const B = times[Math.floor((times.length - 1) * TRAIN_FRACTION)];
  return {
    train: obs.filter(o => o.t + h * 60_000 <= B),
    test: obs.filter(o => o.t >= B + H_MAX * 60_000),
    B,
  };
}
function trainClassBoundaries(train) {
  return tercileBins(train.map(o => o.fwdRet), 3).boundaries; // [b1, b2]: DOWN < b1 ≤ RANGE ≤ b2 < UP
}
function labelClasses(obs, bounds) {
  return obs.map(o => (o.fwdRet > bounds[1] ? 'UP' : o.fwdRet < bounds[0] ? 'DOWN' : 'RANGE'));
}

// Binning por feature. Para o TESTE, as fronteiras do TREINO devem ser reaplicadas
// (validação fora da amostra): fixedBoundaries = fronteiras de tercis do treino.
function binFeature(obs, name, fixedBoundaries) {
  const vals = obs.map(o => o[name]);
  if (name === 'regime') {
    return { bins: vals.map(v => (v === 'BULL_TREND' || v === 'BEAR_TREND' ? 'trending' : 'lateral')), label: 'regime agrupado' };
  }
  if (name === 'flow' || name === 'abs' || name === 'div') {
    const max = Math.max(...vals);
    return max >= 2
      ? { bins: vals.map(v => (v >= 2 ? '2+' : String(v))), label: 'contagem (0/1/2+)' }
      : { bins: vals.map(v => (v >= 1 ? '1+' : '0')), label: 'contagem (0/1+)' };
  }
  const hasNull = vals.some(v => v === null || v === undefined);
  if (fixedBoundaries) {
    const b = fixedBoundaries;
    return {
      bins: vals.map(v => (v === null || v === undefined ? 'NA' : v <= b[0] ? 0 : v <= b[1] ? 1 : 2)),
      label: hasNull ? 'tercis do treino (NA = reset CVD)' : 'tercis do treino',
    };
  }
  if (!hasNull) {
    const { boundaries } = tercileBins(vals, 3);
    return { bins: vals.map(v => (v <= boundaries[0] ? 0 : v <= boundaries[1] ? 1 : 2)), label: 'tercis', boundaries };
  }
  // features com NA (ex.: CVD c/ reset): tercis só nos válidos; NA fica em bin próprio
  const valid = [];
  for (let i = 0; i < obs.length; i++) if (vals[i] !== null && vals[i] !== undefined) valid.push({ v: vals[i], i });
  const { boundaries } = tercileBins(valid.map(x => x.v), 3);
  const bins = new Array(obs.length).fill('NA');
  for (const { v, i } of valid) bins[i] = v <= boundaries[0] ? 0 : v <= boundaries[1] ? 1 : 2;
  return { bins, label: 'tercis (NA = reset CVD na janela)', boundaries };
}

const FEATURES = [
  { key: 'ret15', name: 'retorno 15m (feature)' },
  { key: 'cvdDelta', name: 'ΔCVD 15m' },
  { key: 'cvdLargeDelta', name: 'ΔCVD large 15m' },
  { key: 'oiMean', name: 'OI médio 15m' },
  { key: 'oiChangeMean', name: 'ΔOI médio 15m' },
  { key: 'imbMean', name: 'book imbalance médio 15m' },
  { key: 'scoreMean', name: 'score médio 15m' },
  { key: 'regime', name: 'regime (agrupado)' },
  { key: 'flow', name: 'nº flow_change 15m' },
  { key: 'abs', name: 'nº absorption_* 15m' },
  { key: 'div', name: 'nº divergence* 15m' },
];

// Lift = retorno à frente médio no bin mais alto − mais baixo (exclui NA)
function lift(rets, bins) {
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

function analyze(obsAll, h) {
  const { train, test } = splitTrainTest(obsAll, h);
  const bounds = trainClassBoundaries(train);
  const cTrain = labelClasses(train, bounds);
  const cTest = labelClasses(test, bounds);
  const results = [];
  for (const feat of FEATURES) {
    const bT = binFeature(train, feat.key);
    const bTe = binFeature(test, feat.key, bT.boundaries); // fronteiras do TREINO aplicadas ao teste
    const tStat = chi2Stat(buildTable(bT.bins, cTrain));
    const teStat = chi2Stat(buildTable(bTe.bins, cTest));
    results.push({
      key: feat.key, name: feat.name, binLabel: bT.label,
      tStat: tStat.stat, tP: permutationP(bT.bins, cTrain, PERMUTATIONS),
      tV: cramerV(tStat.stat, train.length, buildTable(bT.bins, cTrain).length, 3),
      tExpMin: tStat.expectedMin, tLow: tStat.lowCells,
      teStat: teStat.stat, teP: permutationP(bTe.bins, cTest, PERMUTATIONS),
      teV: cramerV(teStat.stat, test.length, buildTable(bTe.bins, cTest).length, 3),
      liftT: lift(train.map(o => o.fwdRet), bT.bins),
      liftTe: lift(test.map(o => o.fwdRet), bTe.bins),
    });
  }
  return { train, test, bounds, cTrain, cTest, results };
}

// ── Saída ──
const lines = [];
const log = (s = '') => { console.log(s); lines.push(s); };
const pct = (x, d = 3) => `${(x * 100).toFixed(d)}%`;
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
const bonf = 0.05 / N_TESTS;

log('# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)');
log('');
log(`Fonte: \`${dbPath}\``);
log(`Gerado em: ${new Date().toISOString()}`);
log('');
log('## 0. Qualidade dos dados utilizados');
log('');
const cov = db.prepare('SELECT MIN(timestamp) a, MAX(timestamp) b FROM snapshots').get();
const spanH = (cov.b - cov.a) / 3600000;
let segBreaks = 0;
for (let i = 1; i < snaps.length; i++) if (snaps[i].t - snaps[i - 1].t > GAP_BREAK_MS) segBreaks++;
let cvdResets = 0;
for (let i = 1; i < snaps.length; i++) if (snaps[i - 1].cvd > 0 && snaps[i].cvd < snaps[i - 1].cvd * 0.5) cvdResets++;
let maxGap = 0;
for (let i = 1; i < snaps.length; i++) maxGap = Math.max(maxGap, snaps[i].t - snaps[i - 1].t);
log(`- snapshots: ${snaps.length} (span ${spanH.toFixed(1)}h; cadência ~1/min quando online; uptime efetivo ≈ ${(snaps.length / 60).toFixed(1)}h em ${segBreaks + 1} segmentos)`);
log(`- gaps > 3 min: ${segBreaks} | maior: ${(maxGap / 60000).toFixed(1)} min`);
log(`- resets de CVD detectados (>50% em 1 passo): ${cvdResets} → features de CVD usam Δ intra-janela; janelas com reset ficam NA`);
log(`- regime_events: ${regimeEvents.length} | whale events (events): ${whaleEvents.length} (persistência ativada ${new Date(whaleEvents[0]?.t ?? 0).toISOString()} — seção separada, §6)`);
log(`- N de testes do experimento: ${N_TESTS} (11 features × 3 horizontes) → Bonferroni α = ${bonf.toFixed(5)}`);
log(`- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.`);
log(`- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ ${WINDOW_MIN_SNAPS} snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.`);
log('');

log('## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)');
log('');
log('| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |');
log('|---|---|---|---|---|');
for (const h of HORIZONS) {
  const obs = buildObservations(h);
  const { train, test, B } = splitTrainTest(obs, h);
  const b = trainClassBoundaries(train);
  log(`| ${h} min | ${obs.length} | ${train.length} | ${test.length} | < ${pct(b[0], 3)} / ≤ ${pct(b[1], 3)} / > |`);
  log(`| | | | | fronteira: ${new Date(B).toISOString()} |`);
}
log('');

for (const h of HORIZONS) {
  const { train, test, bounds, cTrain, cTest, results } = analyze(buildObservations(h), h);
  const clsCount = (cls) => cls.reduce((a, c) => { a[c] = (a[c] || 0) + 1; return a; }, {});
  const ct = clsCount(cTrain), ce = clsCount(cTest);
  const testNok = test.length >= MIN_N_PER_CLASS * 3;

  log(`## 2. Horizonte ${h} min — classes (tercis do retorno à frente; fronteiras SÓ do treino)`);
  log('');
  log(`Fronteiras: DOWN < ${pct(bounds[0], 3)} ≤ RANGE ≤ ${pct(bounds[1], 3)} < UP`);
  log('');
  log('| Conjunto | N | UP | RANGE | DOWN |');
  log('|---|---|---|---|---|');
  log(`| Treino | ${train.length} | ${ct.UP ?? 0} (${pct((ct.UP ?? 0) / train.length)}) | ${ct.RANGE ?? 0} (${pct((ct.RANGE ?? 0) / train.length)}) | ${ct.DOWN ?? 0} (${pct((ct.DOWN ?? 0) / train.length)}) |`);
  log(`| Teste | ${test.length} | ${ce.UP ?? 0} (${pct((ce.UP ?? 0) / test.length)}) | ${ce.RANGE ?? 0} (${pct((ce.RANGE ?? 0) / test.length)}) | ${ce.DOWN ?? 0} (${pct((ce.DOWN ?? 0) / test.length)}) |`);
  log('');
  if (!testNok) log(`> Teste com N < ${MIN_N_PER_CLASS * 3} → probabilidades por classe no teste NÃO exibidas (regra N≥30).`);
  log('');

  log(`### 3.${HORIZONS.indexOf(h) + 1} Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE`);
  log('');
  log('| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |');
  log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const flag = r.tP < bonf ? '★' : r.tP < 0.05 ? '⚠' : '';
    const sinal = r.liftT && r.liftTe && r.liftT.sign === r.liftTe.sign;
    log(`| ${r.name} | ${r.binLabel} | ${fmt(r.tStat, 1)} | ${r.tP.toFixed(4)}${flag} | ${fmt(r.tV, 3)} | ${r.liftT ? `${pct(r.liftT.lo)} → ${pct(r.liftT.hi)} (n=${r.liftT.nLo}/${r.liftT.nHi})` : '—'} | ${fmt(r.teStat, 1)} | ${r.teP.toFixed(4)} | ${r.liftTe ? `${pct(r.liftTe.lo)} → ${pct(r.liftTe.hi)} (n=${r.liftTe.nLo}/${r.liftTe.nHi})` : '—'} | ${sinal ? 'sim' : 'não'} |`);
  }
  log('');
  log(`> ★ = p < ${bonf.toFixed(5)} (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (${PERMUTATIONS} iterações, seed fixo).`);
  log('');

  log(`### 4.${HORIZONS.indexOf(h) + 1} Treino vs teste por regime e volatilidade — retorno à frente médio (%)`);
  log('');
  const cell = (arr) => (arr.length >= MIN_N_PER_CLASS ? pct(meanCI(arr).mean, 3) : `${pct(meanCI(arr).mean, 3)} (n=${arr.length}<30)`);
  for (const [label, subset] of [['Treino', train], ['Teste', test]]) {
    const lat = [], trend = [];
    for (const o of subset) (o.regime === 'BULL_TREND' || o.regime === 'BEAR_TREND' ? trend : lat).push(o.fwdRet);
    const vB = tercileBins(subset.map(o => o.vol), 3).boundaries;
    const vG = [[], [], []];
    for (const o of subset) vG[o.vol <= vB[0] ? 0 : o.vol <= vB[1] ? 1 : 2].push(o.fwdRet);
    log(`| ${label} | N | lateral | trending | vol baixa | vol média | vol alta |`);
    log('|---|---|---|---|---|---|---|');
    log(`| ${label} | ${subset.length} | ${cell(lat)} | ${cell(trend)} | ${cell(vG[0])} | ${cell(vG[1])} | ${cell(vG[2])} |`);
    log('');
  }

  log(`### 5.${HORIZONS.indexOf(h) + 1} Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)`);
  log('');
  const top = results.filter(r => r.key !== 'regime').sort((a, b) => a.tP - b.tP).slice(0, 3);
  for (const r of top) {
    const allBins = binFeature(train, r.key).bins;
    const parts = {};
    for (let i = 0; i < train.length; i++) {
      const g = (train[i].regime === 'BULL_TREND' || train[i].regime === 'BEAR_TREND') ? 'trend' : 'lat';
      const b = allBins[i];
      if (b === 'NA') continue;
      (parts[`${g}|${b}`] = parts[`${g}|${b}`] || []).push(train[i].fwdRet);
    }
    const k = Object.keys(parts).sort();
    log(`**${r.name}** (p-perm treino ${r.tP.toFixed(4)}, bins: ${r.binLabel})`);
    log('');
    log(`| Estrato | ${k.join(' | ')} |`);
    log(`| --- | ${k.map(() => '---').join(' | ')} |`);
    log(`| N | ${k.map(x => parts[x].length).join(' | ')} |`);
    log(`| ret. médio | ${k.map(x => pct(meanCI(parts[x]).mean, 3)).join(' | ')} |`);
    log('');
  }
}

// ── 6. Whale events (seção separada) ──
log('## 6. Whale events — seção separada (não contamina a comparação histórica)');
log('');
log('A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.');
log('');
const we = db.prepare("SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx, SUM(CASE WHEN direction = 'bullish' THEN magnitude ELSE 0 END) buy, SUM(CASE WHEN direction = 'bearish' THEN magnitude ELSE 0 END) sell FROM events").get();
const weSpanMin = (we.mx - we.mn) / 60000;
log(`- eventos: ${we.c} | span: ${weSpanMin.toFixed(1)} min (${new Date(we.mn).toISOString()} → ${new Date(we.mx).toISOString()})`);
log(`- volume whale compra: $${fmt(we.buy, 0)} | venda: $${fmt(we.sell, 0)}`);
log('');
const neededObs = 3 * MIN_N_PER_CLASS;
log(`- análise bloqueada por N insuficiente: precisamos de ≥ ${neededObs} janelas de 15m com whale data (≥ ${(neededObs * HORIZONS[1] / 60).toFixed(1)} h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).`);
log('- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).');
log('');

// ── 7. Veredito ──
log('## 7. Veredito (critério de sucesso da Fase 1)');
log('');
log('Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?');
log('Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = ' + bonf.toFixed(5) + '.');
log('Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.');
log('');
const verdicts = [];
for (const h of HORIZONS) {
  const { train, test, results } = analyze(buildObservations(h), h);
  const cand = results.filter(r => r.tP < 0.05 && r.teP < 0.05 && r.liftT && r.liftTe && r.liftT.sign === r.liftTe.sign).map(r => r.name);
  const bonfSurv = results.filter(r => r.tP < bonf).map(r => r.name);
  log(`- Horizonte ${h} min (treino ${train.length} / teste ${test.length}):`);
  log(`   - sobrevivem Bonferroni no treino: ${bonfSurv.length === 0 ? 'nenhuma' : bonfSurv.join(', ')}`);
  log(`   - evidência fora da amostra (a+b+c): ${cand.length === 0 ? 'nenhuma' : cand.join(', ')}`);
  verdicts.push({ h, cand, bonf: bonfSurv, n: test.length });
}
log('');
const any = verdicts.some(v => v.cand.length > 0);
if (any) {
  log('CONCLUSÃO: há evidência preliminar fora da amostra em um ou mais horizontes — documentar as variáveis e combinações antes de construir o restante da arquitetura (Fase 2+).');
} else {
  log('CONCLUSÃO: NENHUMA evidência fora da amostra encontrada até aqui. Hipótese central NÃO suportada pelos dados atuais.');
  log('Nota de poder estatístico: o maior teste tem apenas ~77 observações (N<90 p/ 30/classe) — a ausência de evidência não é prova de ausência de efeito; o experimento precisa de mais dados (especialmente pós-ativação do saveEvent) antes de qualquer conclusão forte.');
}
log('');

const mdPath = path.join(root, 'FASE1_EXPERIMENTO_MINIMO.md');
fs.writeFileSync(mdPath, lines.join('\n') + '\n');
console.log(`\nRelatório salvo em: ${mdPath}`);
db.close();
