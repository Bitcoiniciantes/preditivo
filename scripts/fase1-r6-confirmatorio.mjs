// scripts/fase1-r6-confirmatorio.mjs
// R6 — Validação confirmatória prospectiva (DECISOES.md: pré-registro 2026-09-05,
// formalização 2026-09-07). Harness versionado SEPARADO do experimento congelado.
//
// GARANTIAS (não negociáveis):
//   - NÃO toca scripts/fase1-experimento-minimo.mjs, FASE1_EXPERIMENTO_MINIMO.md,
//     features, thresholds, classes, targets, horizontes, split histórico, schema,
//     CVD, Regime, Flow, Absorption, painel, PREDICTIVE_GATE ou dados (DB readOnly).
//   - Saída em arquivo NOVO: FASE1_R6_CONFIRMATORIO.md. Sem flag de overwrite:
//     se o relatório já existe, aborta (execução única).
//   - `--check-n`: SÓ contagens (N elegível novo por horizonte + classes). Nenhum
//     teste calculado — monitorar N não é testar (pré-registro, item 4).
//   - Execução completa exige gatilho (120 elegíveis novas por horizonte) e roda
//     UMA única vez; abaixo do gatilho, conta e sai sem calcular nada.
//
// DIFERENÇAS INTENCIONAIS vs o congelado (só estas, decididas em DECISOES.md):
//   - pool: somente âncoras com t-15min > corte R5 (prospectivo, sem sobreposição
//     com R1–R5); classes/bins: fronteiras do TREINO R5 reproduzidas
//     deterministicamente (tercileBins não usa RNG — bit-idênticas, pois o SQLite
//     é append-only e o pré-corte é imutável); sem reestimar em dados novos.
//   - família confirmatória: 3 features × 3 horizontes = 9 testes, α=0,05/9.
//   - RNG: seed própria por teste (feature+horizonte), passada ÚNICA cujos números
//     alimentam tabelas e veredito (elimina a divergência §3 vs §7 do R5).
// Todo o resto (janela 15m, stride=h, tolerância ±2.5min, gap>3min, ≥10 snaps,
// purging/embargo substituídos pelo corte, χ² por permutação 999, lift, N≥30) é
// cópia idêntica da lógica congelada.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dbPath = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const OUT_PATH = path.join(root, 'FASE1_R6_CONFIRMATORIO.md');

// ── Constantes idênticas às do experimento congelado ──
const FEATURE_WINDOW_MIN = 15;
const HORIZONS = [5, 15, 30];
const H_MAX = 30;
const OUTCOME_TOLERANCE_MS = 150_000;
const WINDOW_MIN_SNAPS = 10;
const GAP_BREAK_MS = 180_000;
const PERMUTATIONS = 999;
const MIN_N_PER_CLASS = 30;

// ── Constantes R6 (DECISOES.md 2026-09-05/07 — congeladas aqui, não editáveis sem revisão) ──
const R5_CUT_MS = Date.parse('2026-09-05T22:13:40.401Z'); // "Gerado em" do R5
const R5_B = { // fronteiras B do split R5, publicadas no §1 do relatório R5
  5: Date.parse('2026-09-01T22:39:41.055Z'),
  15: Date.parse('2026-09-02T00:52:41.905Z'),
  30: Date.parse('2026-09-02T03:57:57.927Z'),
};
const CONFIRM_FEATURES = [
  { key: 'ret15', name: 'retorno 15m (feature)' },
  { key: 'cvdDelta', name: 'ΔCVD 15m' },
  { key: 'cvdLargeDelta', name: 'ΔCVD large 15m' },
];
const N_CONFIRM_TESTS = 9; // 3 features × 3 horizontes
const ALPHA = 0.05 / N_CONFIRM_TESTS; // ≈ 0,0056
const TRIGGER_N = 120; // elegíveis novas por horizonte (gatilho de execução única)
// Sinais de referência = lifts "Lift teste" do §3 do R5 (DECISOES.md 2026-09-07 §3).
const REF_SIGN = {
  5: { ret15: -1, cvdDelta: -1, cvdLargeDelta: -1 },
  15: { ret15: -1, cvdDelta: -1, cvdLargeDelta: -1 },
  30: { ret15: +1, cvdDelta: -1, cvdLargeDelta: -1 },
};

// ── Helpers estatísticos (cópia idêntica do congelado, exceto RNG por teste) ──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { // FNV-1a 32 bit — derivação de seed legível e estável
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rngFor = (featKey, h) => mulberry32(hashStr(`R6|${featKey}|${h}|20260905`));
function shuffleWith(arr, rng) {
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
function permutationP(featureBins, classes, nPerm, rng) {
  const obs = chi2Stat(buildTable(featureBins, classes)).stat;
  let count = 0;
  const perm = classes.slice();
  for (let i = 0; i < nPerm; i++) {
    shuffleWith(perm, rng);
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

// ── Carregamento (somente leitura) ──
const db = new DatabaseSync(dbPath, { readOnly: true });
const snaps = db.prepare(
  'SELECT timestamp t, price p, cvd, cvd_large, oi, oi_change, book_imbalance, score, regime FROM snapshots ORDER BY timestamp'
).all();
const regimeEvents = db.prepare('SELECT timestamp t, event_type FROM regime_events ORDER BY timestamp').all();

function countInWindow(list, from, to, pred) {
  let c = 0;
  for (const e of list) { if (e.t >= to) break; if (e.t >= from && (!pred || pred(e.event_type))) c++; }
  return c;
}

// ── Observações (lógica idêntica à congelada; tMin filtra o pool prospectivo) ──
function buildObservations(h, tMin = -Infinity) {
  const obs = [];
  let lastAnchor = -Infinity;
  for (let i = 0; i < snaps.length; i++) {
    const t = snaps[i].t;
    if (t <= tMin) continue; // pool prospectivo: tMin = corte + 15min; elegível ⇔ t − 15min > corte
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
    const wFrom = t - FEATURE_WINDOW_MIN * 60_000;
    lastAnchor = t;
    obs.push({
      t, h,
      ret15: l.p / f.p - 1,
      cvdDelta: cvdReset ? null : l.cvd - f.cvd,
      cvdLargeDelta: cvdReset ? null : l.cvd_large - f.cvd_large,
      fwdRet: outcome.p / l.p - 1,
    });
  }
  return obs;
}

// Corte prospectivo: janela de features integralmente posterior ao R5.
const FRESH_TMIN = R5_CUT_MS + FEATURE_WINDOW_MIN * 60_000; // t - 15min > corte ⇔ t > corte + 15min

function trainClassBoundaries(train) {
  return tercileBins(train.map(o => o.fwdRet), 3).boundaries;
}
function labelClasses(obs, bounds) {
  return obs.map(o => (o.fwdRet > bounds[1] ? 'UP' : o.fwdRet < bounds[0] ? 'DOWN' : 'RANGE'));
}
// Binning por tercis do TREINO R5 reaplicado ao novo (ramo fixedBoundaries do congelado).
function binWithTrainBounds(vals, boundaries) {
  return vals.map(v => (v === null || v === undefined ? 'NA' : v <= boundaries[0] ? 0 : v <= boundaries[1] ? 1 : 2));
}
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

// ── Reprodução das fronteiras do TREINO R5 (determinística, sem RNG, sem dados novos) ──
function reproduceR5Train(h) {
  const all = buildObservations(h); // pool total com a lógica congelada (só leitura)
  const train = all.filter(o => o.t + h * 60_000 <= R5_B[h]); // split R5: purging t+h ≤ B
  const classBounds = trainClassBoundaries(train);
  if (classBounds.length !== 2) throw new Error(`[R6] treino R5 reproduzido sem 2 fronteiras (h=${h}) — abortar`);
  const featBounds = {};
  for (const feat of CONFIRM_FEATURES) {
    const vals = train.map(o => o[feat.key]);
    const valid = vals.filter(v => v !== null && v !== undefined);
    const { boundaries } = tercileBins(valid, 3);
    if (boundaries.length !== 2) throw new Error(`[R6] feature ${feat.key} sem 2 fronteiras no treino R5 (h=${h}) — abortar`);
    featBounds[feat.key] = boundaries;
  }
  return { trainN: train.length, classBounds, featBounds };
}

// ── Modos ──
const args = new Set(process.argv.slice(2));

function freshPool(h) {
  return buildObservations(h, FRESH_TMIN);
}
function classCounts(labels) {
  const c = { UP: 0, RANGE: 0, DOWN: 0 };
  for (const l of labels) c[l]++;
  return c;
}

// --check-n: SÓ contagens, nenhum teste. Monitorar N não é testar.
if (args.has('--check-n')) {
  console.log('# R6 — monitor de N (read-only, nenhum teste calculado)');
  console.log(`corte: t - 15min > ${new Date(R5_CUT_MS).toISOString()} | gatilho: ${TRIGGER_N} elegíveis novas/horizonte`);
  let allMet = true;
  for (const h of HORIZONS) {
    const fresh = freshPool(h);
    const { trainN, classBounds } = reproduceR5Train(h); // reprodução auditável (R5 publica 2064/697/345)
    const cc = classCounts(labelClasses(fresh, classBounds));
    console.log(`  treino R5 reproduzido (h=${h}): N=${trainN} bounds=[${classBounds.map(b => b.toFixed(6)).join(', ')}]`);
    const met = fresh.length >= TRIGGER_N;
    if (!met) allMet = false;
    console.log(`h=${h}min: elegíveis novas=${fresh.length} (UP=${cc.UP} RANGE=${cc.RANGE} DOWN=${cc.DOWN}) gatilho=${met ? 'SIM' : 'NÃO'}`);
  }
  console.log(allMet ? 'GATILHO ATINGIDO nos 3 horizontes — execução única liberada (uma vez).' : 'GATILHO PENDENTE — não executar o protocolo completo.');
  db.close();
  process.exit(allMet ? 0 : 1);
}

// ── Execução completa (única) ──
if (fs.existsSync(OUT_PATH)) {
  console.error(`[R6] ${OUT_PATH} já existe — execução única já ocorreu. Repetir é proibido (DECISOES.md). Abortando sem calcular nada.`);
  db.close();
  process.exit(2);
}
const freshByH = {};
for (const h of HORIZONS) freshByH[h] = freshPool(h);
const below = HORIZONS.filter(h => freshByH[h].length < TRIGGER_N);
if (below.length > 0) {
  for (const h of HORIZONS) console.log(`h=${h}min: elegíveis novas=${freshByH[h].length} (gatilho ${TRIGGER_N})`);
  console.error(`[R6] Gatilho não atingido em: ${below.join(', ')} — abortando sem calcular nenhum teste. Use --check-n para monitorar.`);
  db.close();
  process.exit(1);
}

// PASSADA ÚNICA: cada teste calculado uma vez; os mesmos números alimentam
// tabelas e veredito (anti-divergência §3 vs §7 do R5).
const perH = {};
for (const h of HORIZONS) {
  const { trainN, classBounds, featBounds } = reproduceR5Train(h);
  const fresh = freshByH[h];
  const cFresh = labelClasses(fresh, classBounds);
  const cc = classCounts(cFresh);
  const samplingOk = fresh.length >= MIN_N_PER_CLASS * 3 && cc.UP >= MIN_N_PER_CLASS && cc.RANGE >= MIN_N_PER_CLASS && cc.DOWN >= MIN_N_PER_CLASS;
  const tests = CONFIRM_FEATURES.map(feat => {
    const bins = binWithTrainBounds(fresh.map(o => o[feat.key]), featBounds[feat.key]);
    const table = buildTable(bins, cFresh);
    const { stat } = chi2Stat(table);
    const p = permutationP(bins, cFresh, PERMUTATIONS, rngFor(feat.key, h)); // seed própria por teste
    const lf = lift(fresh.map(o => o.fwdRet), bins);
    const ref = REF_SIGN[h][feat.key];
    const signOk = lf !== null && lf.sign === ref;
    return { key: feat.key, name: feat.name, n: fresh.length, chi2: stat, p, liftLo: lf?.lo ?? null, liftHi: lf?.hi ?? null, sign: lf?.sign ?? null, ref, pass: p < ALPHA && signOk };
  });
  perH[h] = { trainN, classBounds, featBounds, freshN: fresh.length, classes: cc, samplingOk, tests };
}

// ── Relatório (arquivo novo; o congelado e o painel ficam intocados) ──
const lines = [];
const log = (s = '') => { console.log(s); lines.push(s); };
const pct = (x, d = 3) => `${(x * 100).toFixed(d)}%`;
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toFixed(d));

log('# FASE 1 — R6 CONFIRMATÓRIO (relatório gerado por scripts/fase1-r6-confirmatorio.mjs — execução única)');
log('');
log(`Fonte: \`${dbPath}\` (aberto readOnly; nenhum dado alterado)`);
log(`Gerado em: ${new Date().toISOString()}`);
log(`Corte prospectivo: âncoras com t − 15min > ${new Date(R5_CUT_MS).toISOString()} (nada de R1–R5 entra)`);
log(`Família confirmatória: ${N_CONFIRM_TESTS} testes (3 features × 3 horizontes) → α = ${ALPHA.toFixed(5)}; PASS ⇔ p < α E sinal do lift = referência R5`);
log(`Fronteiras de classes/bins: treino R5 reproduzido deterministicamente (B por horizonte no relatório; sem reestimar)`);
log(`RNG: seed própria por teste (R6|feature|horizonte|20260905), passada única — tabelas e veredito vêm dos mesmos números`);
log(`p-valor e N não são "confidence" — nenhuma probabilidade preditiva é gerada; PREDICTIVE_GATE permanece false.`);
log('');
for (const h of HORIZONS) {
  const r = perH[h];
  log(`## Horizonte ${h} min — pool novo N=${r.freshN} (UP=${r.classes.UP} RANGE=${r.classes.RANGE} DOWN=${r.classes.DOWN}) — amostragem: ${r.samplingOk ? 'PASS' : 'FAIL'}`);
  log('');
  log(`Fronteiras de classe do treino R5 (reproduzidas): DOWN < ${pct(r.classBounds[0], 3)} ≤ RANGE ≤ ${pct(r.classBounds[1], 3)} < UP`);
  log('');
  log('| Feature | N | χ² | p-perm | Cramér V | Lift novo (alto−baixo) | sinal ref. R5 | PASS (p<α e sinal) |');
  log('|---|---|---|---|---|---|---|---|');
  for (const t of r.tests) {
    const bins = binWithTrainBounds(freshByH[h].map(o => o[t.key]), r.featBounds[t.key]);
    const table = buildTable(bins, labelClasses(freshByH[h], r.classBounds));
    const v = cramerV(t.chi2, r.freshN, table.length, 3);
    log(`| ${t.name} | ${t.n} | ${fmt(t.chi2, 1)} | ${t.p.toFixed(4)} | ${fmt(v, 3)} | ${t.liftLo === null ? '—' : `${pct(t.liftLo)} → ${pct(t.liftHi)}`} | ${t.ref > 0 ? '+1' : '−1'} (obtido ${t.sign === null ? '—' : t.sign > 0 ? '+1' : t.sign < 0 ? '−1' : '0'}) | ${t.pass ? 'PASS' : 'não'} |`);
  }
  log('');
}
log('## Veredito R6');
log('');
let anyPass = false;
for (const h of HORIZONS) {
  const r = perH[h];
  const passed = r.tests.filter(t => t.pass).map(t => t.name);
  if (passed.length > 0) anyPass = true;
  log(`- ${h} min (amostragem ${r.samplingOk ? 'PASS' : 'FAIL'}): ${passed.length === 0 ? 'nenhum PASS confirmatório' : passed.join(', ')}`);
}
const gateSampling = HORIZONS.every(h => perH[h].samplingOk);
log(`- Gate R6 (amostragem nos 3 horizontes E ≥1 PASS): ${gateSampling && anyPass ? 'PASS' : 'NÃO PASS'}`);
log('');
if (gateSampling && anyPass) {
  log('CONCLUSÃO: ao menos uma hipótese confirmatória aprovada no pool prospectivo — registrar para revisão humana (Fase 2 só com aprovação em DECISOES.md; PREDICTIVE_GATE continua false).');
} else {
  log('CONCLUSÃO: sem confirmação prospectiva — hipótese central NÃO suportada pelos dados novos. Manter STRUCTURE LOCKED; PREDICTIVE SIGNAL LOCKED.');
}
log('');

fs.writeFileSync(OUT_PATH, lines.join('\n') + '\n');
console.log(`\nRelatório salvo em: ${OUT_PATH}`);
db.close();
