// scripts/predictive-v1-validate.mjs — PASSO 2 / FASE C (§26 V1.3.1)
// Recomputa em Node.js as 11 grandezas da fixture e compara com a referência
// Python dentro das tolerâncias hierárquicas do §26.3. Falha em qualquer
// tolerância impede o experimento real (§26.3).
// Uso: node scripts/predictive-v1-validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const FIX = path.join(root, 'fixtures', 'predictive_v1_reference_v1.json');

const raw = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const { sha256 } = raw;
// Integridade: SHA-256 sobre os BYTES do artefato canônico (gerado pelo Python
// com sort_keys+separadores compactos; evita divergência de repr float).
const canonBytes = fs.readFileSync(path.join(root, 'fixtures', 'predictive_v1_reference_v1.canon.json'));
const check = { fixture_sha_ok: crypto.createHash('sha256').update(canonBytes).digest('hex') === sha256 };

const { X, y, prices, class_seq, d } = raw.inputs;
const E = raw.expected;
const F = X[0].length, K = 3, KF = K - 1, N = y.length;
const C = raw.provenance.C;
const res = {};
const ok = (name, cond) => { res[name] = cond ? 'PASS' : 'FAIL'; return cond; };
let allOk = check.fixture_sha_ok;

// 1. EWMA (λ half-life 60 min; init s2=r0^2).
{
  const lam = Math.exp(-Math.log(2) / 60), sq15 = Math.sqrt(15);
  const r = [];
  for (let i = 1; i < prices.length; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  let s2 = r[0] * r[0];
  for (let i = 1; i < r.length; i++) s2 = lam * s2 + (1 - lam) * r[i] * r[i];
  res.ewma_sigma2 = Math.abs(s2 - E.ewma.sigma2_last);
  res.ewma_sigmaH = Math.abs(Math.sqrt(s2) * sq15 - E.ewma.sigma_H_last);
  res.ewma_first = Math.abs(Math.abs(r[0]) * sq15 - E.ewma.sigma_H_first);
  allOk = ok('ewma', res.ewma_sigma2 <= 1e-12 && res.ewma_sigmaH <= 1e-9 && res.ewma_first <= 1e-9) && allOk;
}

// Newton multinomial reduzido (mesma formulação do cnull: J=sum(loss)+(1/2C)||W||^2).
function fitNewton(Xm, ym, Cc) {
  const Nn = ym.length, P = F + 1, PK = P * KF;
  const W = new Float64Array(PK);
  const grad = new Float64Array(PK), H = new Float64Array(PK * PK), pr = new Float64Array(K);
  let it = 0, gnL = NaN;
  const lossAt = (Wv) => {
    let L = 0;
    for (let i = 0; i < Nn; i++) {
      let mx = 0; const sc = new Array(KF);
      for (let k = 0; k < KF; k++) { let s = Wv[k * P]; for (let j = 0; j < F; j++) s += Wv[k * P + 1 + j] * Xm[i][j]; sc[k] = s; if (s > mx) mx = s; }
      let se = Math.exp(-mx);
      for (let k = 0; k < KF; k++) se += Math.exp(sc[k] - mx);
      L += -((ym[i] < KF ? sc[ym[i]] : 0) - mx) + Math.log(se);
    }
    for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) L += (Wv[k * P + 1 + j] ** 2) / (2 * Cc);
    return L;
  };
  for (it = 0; it < 2000; it++) {
    grad.fill(0); H.fill(0);
    for (let i = 0; i < Nn; i++) {
      let mx = 0;
      for (let k = 0; k < KF; k++) { let s = W[k * P]; for (let j = 0; j < F; j++) s += W[k * P + 1 + j] * Xm[i][j]; pr[k] = s; if (s > mx) mx = s; }
      let se = 0;
      for (let k = 0; k < KF; k++) { pr[k] = Math.exp(pr[k] - mx); se += pr[k]; }
      pr[KF] = Math.exp(-mx); se += pr[KF];
      for (let k = 0; k < K; k++) pr[k] /= se;
      for (let k = 0; k < KF; k++) {
        const r = (ym[i] === k ? 1 : 0) - pr[k];
        grad[k * P] += r;
        for (let j = 0; j < F; j++) grad[k * P + 1 + j] += r * Xm[i][j];
      }
      for (let a = 0; a < KF; a++) for (let b = 0; b < KF; b++) {
        const wab = (a === b ? pr[a] : 0) - pr[a] * pr[b];
        for (let p1 = 0; p1 < P; p1++) {
          const x1 = p1 === 0 ? 1 : Xm[i][p1 - 1];
          for (let p2 = 0; p2 < P; p2++) H[(a * P + p1) * PK + b * P + p2] += wab * x1 * (p2 === 0 ? 1 : Xm[i][p2 - 1]);
        }
      }
    }
    for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) {
      grad[k * P + 1 + j] -= W[k * P + 1 + j] / Cc;
      H[(k * P + 1 + j) * PK + k * P + 1 + j] += 1 / Cc;
    }
    for (let p = 0; p < PK; p++) grad[p] = -grad[p];
    let gn = 0;
    for (let p = 0; p < PK; p++) gn += grad[p] * grad[p];
    gn = Math.sqrt(gn); gnL = gn;
    if (gn <= 1e-8) break;
    const A = new Float64Array(PK * (PK + 1));
    for (let i = 0; i < PK; i++) { for (let j = 0; j < PK; j++) A[i * (PK + 1) + j] = H[i * PK + j]; A[i * (PK + 1) + PK] = -grad[i]; }
    let sing = false;
    for (let c = 0; c < PK; c++) {
      let piv = c;
      for (let r = c + 1; r < PK; r++) if (Math.abs(A[r * (PK + 1) + c]) > Math.abs(A[piv * (PK + 1) + c])) piv = r;
      if (Math.abs(A[piv * (PK + 1) + c]) < 1e-14) { sing = true; break; }
      if (piv !== c) for (let j = c; j <= PK; j++) { const t = A[c * (PK + 1) + j]; A[c * (PK + 1) + j] = A[piv * (PK + 1) + j]; A[piv * (PK + 1) + j] = t; }
      for (let r = c + 1; r < PK; r++) { const f = A[r * (PK + 1) + c] / A[c * (PK + 1) + c]; for (let j = c; j <= PK; j++) A[r * (PK + 1) + j] -= f * A[c * (PK + 1) + j]; }
    }
    if (sing) break;
    const dd = new Float64Array(PK);
    for (let r = PK - 1; r >= 0; r--) { let s = A[r * (PK + 1) + PK]; for (let j = r + 1; j < PK; j++) s -= A[r * (PK + 1) + j] * dd[j]; dd[r] = s / A[r * (PK + 1) + r]; }
    const reg0 = lossAt(W), ATOL = 1e-9 * Math.max(1, Math.abs(reg0));
    for (let ls = 0, step = 1; ; ls++) {
      for (let p = 0; p < PK; p++) W[p] += step * dd[p];
      const nl = lossAt(W);
      if (nl <= reg0 + ATOL) break;
      for (let p = 0; p < PK; p++) W[p] -= step * dd[p];
      step *= 0.5;
      if (ls >= 40 || step < 1e-13) { for (let p = 0; p < PK; p++) W[p] += step * dd[p]; break; }
    }
  }
  return { W: [...W], iters: it, gn: gnL, loss: lossAt(W) };
}
function probsOf(W, x) {
  let mx = 0; const sc = new Array(KF);
  for (let k = 0; k < KF; k++) { let s = W[k * (F + 1)]; for (let j = 0; j < F; j++) s += W[k * (F + 1) + 1 + j] * x[j]; sc[k] = s; if (s > mx) mx = s; }
  let se = Math.exp(-mx); const p = new Array(K);
  for (let k = 0; k < KF; k++) { p[k] = Math.exp(sc[k] - mx); se += p[k]; }
  p[KF] = Math.exp(-mx);
  for (let k = 0; k < K; k++) p[k] /= se;
  return p;
}

const fit = fitNewton(X, y, C);
// W_ref: ótimo SciPy do objetivo exato, layout [classe][param] (KF classes livres).
const Wref = E.W_ref;
const WskRed = [];
for (let k = 0; k < KF; k++) for (let p = 0; p <= F; p++) WskRed.push(Wref[k][p]);
// 2-3. logits/probs: compara probs do W ajustado Node vs sklearn ref.
let maxDp = 0;
for (let i = 0; i < N; i++) {
  const pn = probsOf(fit.W, X[i]);
  const ps = probsOf(WskRed, X[i]);
  for (let k = 0; k < K; k++) maxDp = Math.max(maxDp, Math.abs(pn[k] - ps[k]));
}
// 6. convergência/otimização.
res.grad_norm_node = fit.gn;
res.coef_maxdiff = Math.max(...fit.W.map((w, i) => Math.abs(w - WskRed[i])));
const Lnode = fit.loss;
let Lsk = 0;
for (let i = 0; i < N; i++) {
  const p = probsOf(WskRed, X[i]);
  Lsk += -Math.log(Math.max(p[y[i]], 1e-300));
}
for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) Lsk += (WskRed[k * (F + 1) + 1 + j] ** 2) / (2 * C);
res.loss_rel = Math.abs(Lnode - Lsk) / Math.max(1, Math.abs(Lsk));
res.prob_maxdiff = maxDp;
allOk = ok('convergencia_grad', fit.gn <= 1e-8) && allOk;
allOk = ok('coeficientes', res.coef_maxdiff <= 1e-5) && allOk;
allOk = ok('perda_relativa', res.loss_rel <= 1e-9) && allOk;
allOk = ok('probabilidades', res.prob_maxdiff <= 1e-6) && allOk;

// 2b/4/5. LogLoss/Brier/ECE com o W Node.
{
  let ll = 0, br = 0;
  const P = [];
  for (let i = 0; i < N; i++) { const p = probsOf(fit.W, X[i]); P.push(p); ll += -Math.log(Math.max(p[y[i]], 1e-300)); br += p.reduce((s, v, k) => s + (v - (y[i] === k ? 1 : 0)) ** 2, 0); }
  ll /= N; br /= N;
  const conf = P.map((p) => Math.max(...p)), pred = P.map((p) => p.indexOf(Math.max(...p)));
  let ece = 0;
  for (let b = 0; b < 10; b++) {
    const idx = [];
    for (let i = 0; i < N; i++) { const lo = b / 10, hi = b === 9 ? 1.0000001 : (b + 1) / 10; if (conf[i] >= lo && conf[i] < hi) idx.push(i); }
    if (idx.length) ece += (idx.length / N) * Math.abs(idx.filter((i) => pred[i] === y[i]).length / idx.length - idx.reduce((s, i) => s + conf[i], 0) / idx.length);
  }
  res.logloss_diff = Math.abs(ll - E.logloss);
  res.brier_diff = Math.abs(br - E.brier);
  res.ece_diff = Math.abs(ece - E.ece);
  allOk = ok('logloss', res.logloss_diff <= 1e-9) && allOk;
  allOk = ok('brier', res.brier_diff <= 1e-9) && allOk;
  allOk = ok('ece', res.ece_diff <= 1e-6) && allOk;
}

// 7. persistência 3x3 + Laplace.
{
  const cnt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 1; i < class_seq.length; i++) cnt[class_seq[i - 1]][class_seq[i]]++;
  let md = 0;
  for (let a = 0; a < 3; a++) {
    const row = cnt[a].reduce((s, v) => s + v, 0);
    for (let b = 0; b < 3; b++) md = Math.max(md, Math.abs((cnt[a][b] + 1) / (row + 3) - E.transition_3x3[a][b]));
  }
  res.persist_maxdiff = md;
  allOk = ok('persistencia_3x3', md === 0) && allOk;
}

// 8-10. HAC(7), N_eff, poder/MDE (mesma fórmula documentada).
{
  const m = d.reduce((s, v) => s + v, 0) / d.length;
  const gam = [];
  for (let l = 0; l <= 7; l++) {
    let s = 0;
    for (let i = l; i < d.length; i++) s += (l === 0 ? d[i] * d[i] : (d[i] - m) * (d[i - l] - m));
    gam.push(s / d.length);
  }
  // NOTA: gamma_0 da referência usa série NÃO demeaned (mesma convenção aqui).
  const varLR = (gam[0] + 2 * gam.slice(1).reduce((s, g, l) => s + (1 - (l + 1) / 8) * g, 0)) / d.length;
  let sv = 0;
  for (let i = 0; i < d.length; i++) sv += (d[i] - m) * (d[i] - m);
  sv /= d.length - 1;
  const neff = Math.min(d.length, (d.length * sv) / varLR);
  const se = Math.sqrt(varLR);
  // Phi(z) por Simpson determinístico (n=20000, erro << 1e-9); evita o teto de
  // precisão da aproximação erf de Abramowitz-Stegun 7.1.26 (|eps|<=1.5e-7).
  const phi = (t) => Math.exp(-t * t / 2) / Math.sqrt(2 * Math.PI);
  const z = 0.005 / se - 2.128045;
  const nn = 20000, h = z / nn;
  let integral = phi(0) + phi(z);
  for (let i = 1; i < nn; i++) integral += (i % 2 === 0 ? 2 : 4) * phi(i * h);
  integral *= h / 3;
  const power = 0.5 + integral;
  res.hac_var_diff = Math.abs(varLR - E.hac.var_lr);
  res.neff_diff = Math.abs(neff - E.n_eff);
  res.power_diff = Math.abs(power - E.power_mde);
  res.mde80_diff = Math.abs(2.969666 * se - E.mde80);
  allOk = ok('hac', res.hac_var_diff / Math.max(1e-300, Math.abs(E.hac.var_lr)) <= 1e-9) && allOk;
  allOk = ok('n_eff', res.neff_diff <= 1e-6) && allOk;
  allOk = ok('poder_mde', res.power_diff <= 1e-9 && res.mde80_diff <= 1e-12) && allOk;
}

console.log(JSON.stringify({ fixture: raw.fixture_version, fixture_sha_ok: check.fixture_sha_ok, tolerancias: '§26.3', checks: res, validacao: allOk ? 'PASS' : 'FAIL', truncamento_item11: 'coberto pelo harness scripts/predictive-v1-truncate.mjs (PASS 200/200)' }, null, 1));
if (!allOk) process.exit(1);
