// scripts/predictive-v1-walkforward.mjs — PASSO 5 / WF V1.4 (EXECUÇÃO ÚNICA)
// Geometria homologada (convenção inclusiva): train_0=764 válidas; 5 folds x 187
// (teste = 187 válidas com t >= te+15min); sobra 3 fora; holdout 300 selado.
// Modelo: logística multinomial L2 C=0.01 (Newton reduzido 12 params, tol 1e-8).
// Baselines: class prior / persistência 3x3 Laplace α=1 (staleness 30min) / price-only.
// Critérios §19 V1.3.1 + HAC(7) + ECE top-label 10 bins. Sem tuning, sem holdout.
// Matemática em scripts/predictive-v1-math.mjs (auto-checagem de fixture no startup).
// Uso: node scripts/predictive-v1-walkforward.mjs  (RODAR UMA VEZ)
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fitNewton, probsOf, metrics, hacVar, normCdf } from './predictive-v1-math.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const PDB = path.join(root, 'data', 'predictive_v1.db');
const FIX = path.join(root, 'fixtures', 'predictive_v1_reference_v1.json');
const OUT = path.join(root, 'data', 'predictive_v1_wf_result.json');

const C = 0.01;                 // congelado
const Z = 2.128045, HACL = 7;
const CLS = { UP: 0, RANGE: 1, DOWN: 2 };
const fail = (m) => { console.error(JSON.stringify({ erro: m })); process.exit(1); };

// ---- Auto-checagem contra a fixture (aborta se divergir) ----
{
  const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  const Xf = fx.inputs.X, yf = fx.inputs.y, Cf = fx.provenance.C;
  const fit = fitNewton(Xf, yf, Xf[0].length, Cf);
  const Wr = fx.expected.W_ref;
  let md = 0;
  for (let k = 0; k < 2; k++) for (let p = 0; p <= Xf[0].length; p++) md = Math.max(md, Math.abs(fit.W[k * (Xf[0].length + 1) + p] - Wr[k][p]));
  if (!fit.converged || md > 1e-5) fail('auto-checagem da fixture falhou (fitter divergente da referência validada)');
}

// ---- Carga do dataset (somente pré-holdout; holdout jamais lido para avaliação) ----
const pdb = new DatabaseSync(PDB, { readOnly: true });
const meta = Object.fromEntries(pdb.prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v]));
if (meta.spec_version !== 'V1.3.1' || meta.T_pool_end !== '1790029687758') fail('dataset inesperado');
const rows = pdb.prepare(
  'SELECT a.anchor_t AS t, a.in_holdout AS h, f.r_back_15m AS f0, f.book_imbalance AS f1, ' +
  'f.cvd_z AS f2, f.whale_z AS f3, f.doi_z AS f4, l.r_fwd_15m AS rf, l.class AS cls ' +
  'FROM anchors a JOIN features f ON f.anchor_t=a.anchor_t JOIN labels l ON l.anchor_t=a.anchor_t ' +
  'WHERE a.valid=1 AND a.in_holdout=0 ORDER BY a.anchor_t'
).all();
pdb.close();
const holdSealed = (() => {
  const c = new DatabaseSync(PDB, { readOnly: true });
  const r = c.prepare('SELECT COUNT(*) AS n FROM labels l JOIN anchors a ON a.anchor_t=l.anchor_t WHERE a.in_holdout=1 AND l.class IS NOT NULL').get().n;
  c.close();
  return r === 0;
})();
if (!holdSealed) fail('holdout violado');
const pre = rows.filter((r) => r.h === 0);
if (pre.length !== 1702) fail('pré-holdout inesperado: ' + pre.length);
const clsOf = (c) => CLS[c];
const data = pre.map((r) => ({ t: r.t, x: [r.f0, r.f1, r.f2, r.f3, r.f4], y: clsOf(r.cls) }));

// ---- Geometria homologada (inclusiva): train_0=764; teste=187 com t>=te+15min ----
const TR = 764, TF = 187, folds = [];
{
  let ti = TR;
  for (let f = 0; f < 5; f++) {
    const te = data[ti - 1].t;
    let si = ti;
    while (si < data.length && data[si].t < te + 900000) si++;
    if (si + TF > data.length) fail('fold incompleto ' + f);
    folds.push({ train: [0, si - 1], test: [si, si + TF - 1] });
    ti = si + TF;
  }
  if (data.length - ti !== 3) fail('sobra diferente de 3: ' + (data.length - ti));
}

const foldRes = [];
const oos = { y: [], model: [], prior: [], pers: [], price: [] };
for (let f = 0; f < 5; f++) {
  const { train, test } = folds[f];
  const trI = [], teI = [];
  for (let i = train[0]; i <= train[1]; i++) trI.push(i);
  for (let i = test[0]; i <= test[1]; i++) teI.push(i);
  // Padronização in-fold (média/desvio do treino).
  const mu = [], sd = [];
  for (let j = 0; j < 5; j++) {
    const vs = trI.map((i) => data[i].x[j]);
    const m = vs.reduce((s, v) => s + v, 0) / vs.length;
    const v = vs.reduce((s, x) => s + (x - m) ** 2, 0) / vs.length;
    mu.push(m); sd.push(Math.sqrt(v));
  }
  const zn = (x) => x.map((v, j) => (sd[j] > 0 ? (v - mu[j]) / sd[j] : 0));
  // Modelo.
  const fit = fitNewton(trI.map((i) => zn(data[i].x)), trI.map((i) => data[i].y), 5, C);
  if (!fit.converged) fail('não-convergência no fold ' + f);
  const pM = teI.map((i) => probsOf(fit.W, zn(data[i].x), 5));
  // Baseline 1: class prior do treino.
  const cnt = [0, 0, 0];
  for (const i of trI) cnt[data[i].y]++;
  const prior = cnt.map((c) => c / trI.length);
  const pP = teI.map(() => [...prior]);
  // Baseline 2: persistência 3x3 Laplace (matriz do treino; estado = classe em t-15m ou última válida ≤30min).
  const T3 = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
  for (let k = 1; k < trI.length; k++) T3[data[trI[k - 1]].y][data[trI[k]].y]++;
  const TM = T3.map((row) => { const s = row.reduce((a, b) => a + b, 0); return row.map((v) => v / s); });
  const pS = teI.map((i) => {
    const t = data[i].t;
    // Estado = classe da âncora em t-15m se válida; senão última válida anterior
    // (qualquer idade; staleness 30min -> prior). Só passado do pré-holdout.
    let st = -1, stT = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (data[j].t <= t - 900000) { st = data[j].y; stT = data[j].t; break; }
    }
    if (st < 0 || t - stT > 1800000) return [...prior];
    return [...TM[st]];
  });
  // Baseline 3: price-only (mesmo C, mesma padronização in-fold, só r_back_15m).
  const mu0 = mu[0], sd0 = sd[0];
  const z1 = (v) => [(sd0 > 0 ? (v - mu0) / sd0 : 0)];
  const fit1 = fitNewton(trI.map((i) => z1(data[i].x[0])), trI.map((i) => data[i].y), 1, C);
  if (!fit1.converged) fail('não-convergência price-only no fold ' + f);
  const pO = teI.map((i) => probsOf(fit1.W, z1(data[i].x[0]), 1));
  const ys = teI.map((i) => data[i].y);
  const r = {
    fold: f,
    n_train: trI.length, n_test: teI.length,
    t0: new Date(data[teI[0]].t).toISOString(), t1: new Date(data[teI[teI.length - 1]].t).toISOString(),
    modelo: metrics(pM, ys), prior: metrics(pP, ys), persistencia: metrics(pS, ys), priceonly: metrics(pO, ys),
  };
  foldRes.push(r);
  for (let k = 0; k < ys.length; k++) { oos.y.push(ys[k]); oos.model.push(pM[k]); oos.prior.push(pP[k]); oos.pers.push(pS[k]); oos.price.push(pO[k]); }
}

// ---- Baseline de referência (§12.4): menor LogLoss OOS agregado ----
const agg = {
  prior: metrics(oos.prior, oos.y),
  persistencia: metrics(oos.pers, oos.y),
  priceonly: metrics(oos.price, oos.y),
  modelo: metrics(oos.model, oos.y),
};
const order = [['prior', agg.prior.ll], ['persistencia', agg.persistencia.ll], ['priceonly', agg.priceonly.ll]].sort((a, b) => a[1] - b[1]);
const best = order[0][0];
const keyMap = { prior: 'prior', persistencia: 'pers', priceonly: 'price' };
const d = oos.y.map((y, i) => {
  const pb = oos[keyMap[best]][i], pm = oos.model[i];
  return -Math.log(Math.max(pb[y], 1e-300)) - -Math.log(Math.max(pm[y], 1e-300));
});
const N = d.length;
const mean = d.reduce((s, v) => s + v, 0) / N;
let sv = 0;
for (let i = 0; i < N; i++) sv += (d[i] - mean) * (d[i] - mean);
sv /= N - 1;
const varLR = hacVar(d, HACL);
const seReal = Math.sqrt(varLR);
const nEff = Math.min(N, (N * sv) / varLR);
// Poder realizado (§20.4 com SE_real no lugar de SE_plan, cf. §20.6; MDE operacional 0.0065).
const powerReal = normCdf(0.0065 / seReal - Z);

// ---- Critérios ----
const c1 = { delta: mean, limInf: mean - Z * seReal, req: '>0 ambos', pass: mean > 0 && mean - Z * seReal > 0 };
const perFoldWin = foldRes.map((r) => r.modelo.ll < r[best === 'prior' ? 'prior' : best === 'persistencia' ? 'persistencia' : 'priceonly'].ll);
const c2 = { foldsVencidos: perFoldWin.filter(Boolean).length + '/5', req: '>=4/5', pass: perFoldWin.filter(Boolean).length >= 4 };
const c3 = { eceOOS: agg.modelo.ece, req: '<=0.03', pass: agg.modelo.ece <= 0.03 };
const lofo = [];
for (let f = 0; f < 5; f++) {
  const dd = [];
  for (let g = 0; g < 5; g++) {
    if (g === f) continue;
    const a = g * TF, b = a + TF;
    for (let i = a; i < b; i++) dd.push(d[i]);
  }
  lofo.push(dd.reduce((s, v) => s + v, 0) / dd.length);
}
const c4 = { lofo, req: 'todos >0', pass: lofo.every((v) => v > 0) };
const verdict = c1.pass && c2.pass && c3.pass && c4.pass ? 'PASS' : 'FAIL';

const report = {
  passo: 5, spec: 'V1.4 (Portão 1 homologado, re-execução após correção numérica)',
  integridade: {
    dataset: PDB, T_pool_end: meta.T_pool_end, hash_faixa: meta.range_hash_sha256,
    folds: 5, n_train_por_fold: foldRes.map((r) => r.n_train), n_test_fold: TF, n_oos_total: N,
    purge_embargo: '15min (convenção inclusiva t>=te+15min)', holdout_selado: true,
    sobra_3_fora: true, C: C, geometria_ok: '764+(5x187)+3=1702',
    nota_correcao: 'causa raiz: chamada probsOf sem F (NaN), não overflow; hipótese de overflow refutada; guarda F-obrigatório adicionada',
  },
  folds: foldRes,
  baselines_OOS: { prior: agg.prior, persistencia: agg.persistencia, priceonly: agg.priceonly },
  baseline_referencia_12_4: best,
  deltaLL: mean,
  criterios: { c1, c2, c3, c4 },
  estatistica: { N, N_eff: nEff, SE_real: seReal, poder_realizado_MDE00065: powerReal, MDE_operacional: 0.0065 },
  veredito: verdict,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report));
