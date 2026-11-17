// scripts/predictive-v1-cnull.mjs — PASSO 2 / FASE B (§13.2 V1.3.1)
// Simulação sintética NULA em Node.js: X~N(0,1) indep, Y~Cat(0.25,.50,.25),
// sem relação causal. N_train x C, 1000 réplicas, seeds PRED-V1-CNULL|N|C|rep,
// teste independente N=4000, prior estimado no treino.
// Objetivo: sum(loss) + (1/2C)||W||^2, SEM penalizar intercepto (Newton/IRLS).
// NÃO seleciona nem congela C: só evidência para o Portão 1.
// D1: §13.2-texto lista N {350,700,1400}; tabela de referência e diretriz usam
// {350,960,1400} -> executado {350,960,1400} (diretriz homologada), divergência registrada.
// Uso: node scripts/predictive-v1-cnull.mjs
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNormal(rng) {
  let spare = null;
  return function () {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    const m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}

// Regressão logística multinomial com parametrização reduzida (K-1 colunas livres,
// classe K-1 como referência com escore 0): 2*(F+1) = 12 parâmetros (§10.2),
// Hessiana 12x12 positiva-definida. Predições idênticas a qualquer ótimo da
// formulação completa (invariância softmax). Newton exato, tol grad 1e-8,
// max 2000 iters (§13.3).
function fitMultinomial(X, y, F, C) {
  const N = y.length, P = F + 1, PK = P * KF;
  const W = new Float64Array(PK); // zero-init
  const grad = new Float64Array(PK);
  const H = new Float64Array(PK * PK);
  const probs = new Float64Array(K);
  let it = 0, gnLast = NaN;
  for (it = 0; it < 2000; it++) {
    grad.fill(0); H.fill(0);
    let loss = 0;
    for (let i = 0; i < N; i++) {
      const row = i * F;
      let mx = 0; // classe K-1 (referência) tem escore 0
      for (let k = 0; k < KF; k++) {
        let s = W[k * P];
        for (let j = 0; j < F; j++) s += W[k * P + 1 + j] * X[row + j];
        probs[k] = s;
        if (s > mx) mx = s;
      }
      let se = 0;
      for (let k = 0; k < KF; k++) { probs[k] = Math.exp(probs[k] - mx); se += probs[k]; }
      probs[KF] = Math.exp(0 - mx); se += probs[KF];
      for (let k = 0; k < K; k++) probs[k] /= se;
      loss += -Math.log(Math.max(probs[y[i]], 1e-300));
      for (let k = 0; k < KF; k++) {
        const r = (y[i] === k ? 1 : 0) - probs[k];
        grad[k * P] += r;
        for (let j = 0; j < F; j++) grad[k * P + 1 + j] += r * X[row + j];
      }
      for (let a = 0; a < KF; a++) for (let b = 0; b < KF; b++) {
        const wab = (a === b ? probs[a] : 0) - probs[a] * probs[b];
        if (wab === 0) continue;
        for (let p1 = 0; p1 < P; p1++) {
          const x1 = p1 === 0 ? 1 : X[row + p1 - 1];
          for (let p2 = 0; p2 < P; p2++) {
            const x2 = p2 === 0 ? 1 : X[row + p2 - 1];
            H[(a * P + p1) * PK + b * P + p2] += wab * x1 * x2;
          }
        }
      }
    }
    // Minimização de J = NLL + (1/2C)||W||^2 (sem intercepto).
    // O acumulado acima é: gradiente da LOG-VEROSSIMILHANÇA (r = y-p) e blocos
    // de Fisher wab*xx', que SÃO a Hessiana da NLL (PSD). Conversão:
    // grad_J = -grad_LL + W/C (não-intercepto); H_J = Fisher + (1/C)*I.
    for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) {
      grad[k * P + 1 + j] -= W[k * P + 1 + j] / C;
      H[(k * P + 1 + j) * PK + k * P + 1 + j] += 1 / C;
    }
    for (let p = 0; p < PK; p++) grad[p] = -grad[p];
    let gn = 0;
    for (let p = 0; p < PK; p++) gn += grad[p] * grad[p];
    gn = Math.sqrt(gn);
    gnLast = gn;
    if (DBG.on && (it < 6 || it % 500 === 0)) console.error(JSON.stringify({ N: DBG.N, C: DBG.C, it, gn }));
    if (gn <= 1e-8) break;
    // Newton (minimização): resolve H d = -g e aplica W += d.
    const A = new Float64Array(PK * (PK + 1));
    for (let i = 0; i < PK; i++) {
      for (let j = 0; j < PK; j++) A[i * (PK + 1) + j] = H[i * PK + j];
      A[i * (PK + 1) + PK] = -grad[i];
    }
    let singular = false;
    for (let c = 0; c < PK; c++) {
      let piv = c;
      for (let r = c + 1; r < PK; r++) if (Math.abs(A[r * (PK + 1) + c]) > Math.abs(A[piv * (PK + 1) + c])) piv = r;
      if (Math.abs(A[piv * (PK + 1) + c]) < 1e-14) { singular = true; break; }
      if (piv !== c) for (let j = c; j <= PK; j++) { const t = A[c * (PK + 1) + j]; A[c * (PK + 1) + j] = A[piv * (PK + 1) + j]; A[piv * (PK + 1) + j] = t; }
      for (let r = c + 1; r < PK; r++) {
        const f = A[r * (PK + 1) + c] / A[c * (PK + 1) + c];
        for (let j = c; j <= PK; j++) A[r * (PK + 1) + j] -= f * A[c * (PK + 1) + j];
      }
    }
    if (singular) break;
    const d = new Float64Array(PK);
    for (let r = PK - 1; r >= 0; r--) {
      let s = A[r * (PK + 1) + PK];
      for (let j = r + 1; j < PK; j++) s -= A[r * (PK + 1) + j] * d[j];
      d[r] = s / A[r * (PK + 1) + r];
    }
    // backtracking: garante descida da perda regularizada
    let step = 1, reg0 = loss;
    for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) reg0 += (W[k * P + 1 + j] ** 2) / (2 * C);
    // Aceitação com tolerância de ruído float (passo de Newton que não piora
    // além de 1e-9 relativo é aceito; o critério honesto de convergência
    // continua sendo a norma do gradiente <= 1e-8).
    const ACC_TOL = 1e-9 * Math.max(1, Math.abs(reg0));
    for (let ls = 0; ls < 40; ls++) {
      for (let p = 0; p < PK; p++) W[p] += step * d[p];
      let nl = 0;
      for (let i = 0; i < N; i++) {
        const row = i * F;
        let mx = 0;
        const sc = new Float64Array(KF);
        for (let k = 0; k < KF; k++) {
          let s = W[k * P];
          for (let j = 0; j < F; j++) s += W[k * P + 1 + j] * X[row + j];
          sc[k] = s; if (s > mx) mx = s;
        }
        let se = Math.exp(0 - mx);
        for (let k = 0; k < KF; k++) se += Math.exp(sc[k] - mx);
        nl += -((y[i] < KF ? sc[y[i]] : 0) - mx) + Math.log(se);
      }
      for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) nl += (W[k * P + 1 + j] ** 2) / (2 * C);
      if (nl <= reg0 + ACC_TOL) { if (DBG.on && it < 5) console.error(JSON.stringify({ N: DBG.N, C: DBG.C, it, step, nl, reg0 })); break; }
      for (let p = 0; p < PK; p++) W[p] -= step * d[p];
      step *= 0.5;
      if (step < 1e-12) { for (let p = 0; p < PK; p++) W[p] += step * d[p]; break; }
    }
  }
  return { W, iters: it, gn: gnLast };
}
function predictProbs(W, x, F, K) {
  const sc = new Array(KF);
  let mx = 0;
  for (let k = 0; k < KF; k++) {
    let s = W[k * (F + 1)];
    for (let j = 0; j < F; j++) s += W[k * (F + 1) + 1 + j] * x[j];
    sc[k] = s; if (s > mx) mx = s;
  }
  let se = Math.exp(0 - mx);
  const p = new Array(K);
  for (let k = 0; k < KF; k++) { p[k] = Math.exp(sc[k] - mx); se += p[k]; }
  p[KF] = Math.exp(0 - mx);
  for (let k = 0; k < K; k++) p[k] /= se;
  return p;
}

const F = 5, K = 3, KF = K - 1, NTEST = 4000, REPS = Number(process.env.CNULL_REPS || 1000);
// CNULL_NS permite selecionar subconjunto da grade (ex.: 764) sem tocar na metodologia.
const NS = process.env.CNULL_NS ? process.env.CNULL_NS.split(',').map(Number) : [350, 960, 1400];
const CS = [0.01, 0.1, 1.0];
const DBG = { on: false };
const PRIOR = [0.25, 0.5, 0.25];
function sampleY(rng) {
  const u = rng();
  return u < 0.25 ? 0 : (u < 0.75 ? 1 : 2);
}
function p95(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
const table = [];
for (const N of NS) {
  for (const Cc of CS) {
    const t0 = Date.now();
    const dlls = new Array(REPS), sigmas = new Array(REPS);
    let maxIter = 0, nonConv = 0;
    for (let rep = 0; rep < REPS; rep++) {
      const rng = mulberry32(fnv1a('PRED-V1-CNULL|' + N + '|' + Cc + '|' + rep));
      const g = makeNormal(rng);
      const Xtr = new Float64Array(N * F), ytr = new Array(N);
      for (let i = 0; i < N; i++) { for (let j = 0; j < F; j++) Xtr[i * F + j] = g(); ytr[i] = sampleY(rng); }
      const cnt = [0, 0, 0];
      for (let i = 0; i < N; i++) cnt[ytr[i]]++;
      const prior = cnt.map((c) => c / N);
      DBG.on = !!process.env.CNULL_DEBUG && ((N === 960 && Cc === 0.01 && (rep === 3 || rep === 0)));
      DBG.N = N; DBG.C = Cc;
      const fit = fitMultinomial(Xtr, ytr, F, Cc);
      DBG.on = false;
      if (fit.iters >= 2000) nonConv++;
      if (process.env.CNULL_DEBUG) console.error(JSON.stringify({ N, C: Cc, rep, iters: fit.iters }));
      if (process.env.CNULL_DEBUG && N === 350 && Cc === 0.1 && rep === 0) {
        let wn = 0;
        for (let p = 0; p < fit.W.length; p++) wn += fit.W[p] * fit.W[p];
        console.error(JSON.stringify({ wnorm: Math.sqrt(wn), finalGn: fit.gn, iters: fit.iters }));
      }
      if (fit.iters > maxIter) maxIter = fit.iters;
      const Xte = new Float64Array(NTEST * F), yte = new Array(NTEST);
      for (let i = 0; i < NTEST; i++) { for (let j = 0; j < F; j++) Xte[i * F + j] = g(); yte[i] = sampleY(rng); }
      let sum = 0;
      const d = new Array(NTEST);
      for (let i = 0; i < NTEST; i++) {
        const x = new Array(F);
        for (let j = 0; j < F; j++) x[j] = Xte[i * F + j];
        const pm = predictProbs(fit.W, x, F, K);
        const lp = -Math.log(Math.max(prior[yte[i]], 1e-300));
        const lm = -Math.log(Math.max(pm[yte[i]], 1e-300));
        d[i] = lp - lm; sum += d[i];
      }
      const mean = sum / NTEST;
      let v = 0;
      for (let i = 0; i < NTEST; i++) v += (d[i] - mean) * (d[i] - mean);
      dlls[rep] = mean;
      sigmas[rep] = Math.sqrt(v / (NTEST - 1));
    }
    const deg = dlls.map((x) => Math.max(0, -x));
    const gain = dlls.map((x) => Math.max(0, x));
    table.push({
      N, C: Cc,
      degradacao_media: deg.reduce((a, b) => a + b, 0) / REPS,
      degradacao_p95: p95(deg),
      ganho_espurio_p95: p95(gain),
      sigma_d_null: sigmas.reduce((a, b) => a + b, 0) / REPS,
      max_iters_usados: maxIter,
      reps_nao_convergidos: nonConv,
    });
    console.error(JSON.stringify({ combo: N + 'x' + Cc, ms: Date.now() - t0, maxIter }));
  }
}
console.log(JSON.stringify({ spec: 'V1.3.1 §13.2', reps: REPS, nTestNull: NTEST, objective: 'sum(loss)+(1/2C)||W||^2 sem penalizar intercepto', note: 'N {350,960,1400} pela diretriz homologada; texto do §13.2 diz {350,700,1400} (D1)', table }, null, 1));
