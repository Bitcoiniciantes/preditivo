// scripts/predictive-v1-math.mjs — matemática compartilhada do produto preditivo.
// Newton multinomial reduzido (2*(F+1) params, §10.2), softmax, métricas, HAC(7),
// Phi por Simpson. Coberto pela auto-checagem de fixture no harness WF.
// F é OBRIGATÓRIO em probsOf (guarda contra omissão -> NaN silencioso).
export const KF = 2, KK = 3;

export function fitNewton(Xm, ym, F, Cc) {
  const N = ym.length, P = F + 1, PK = P * KF;
  const W = new Float64Array(PK);
  const grad = new Float64Array(PK), H = new Float64Array(PK * PK), pr = new Float64Array(KK);
  const lossAt = (Wv) => {
    let L = 0;
    for (let i = 0; i < N; i++) {
      let mx = 0; const sc = [0, 0];
      for (let k = 0; k < KF; k++) { let s = Wv[k * P]; for (let j = 0; j < F; j++) s += Wv[k * P + 1 + j] * Xm[i][j]; sc[k] = s; if (s > mx) mx = s; }
      let se = Math.exp(-mx);
      for (let k = 0; k < KF; k++) se += Math.exp(sc[k] - mx);
      L += -((ym[i] < KF ? sc[ym[i]] : 0) - mx) + Math.log(se);
    }
    for (let k = 0; k < KF; k++) for (let j = 0; j < F; j++) L += (Wv[k * P + 1 + j] ** 2) / (2 * Cc);
    return L;
  };
  let it = 0, gnL = NaN;
  for (it = 0; it < 2000; it++) {
    grad.fill(0); H.fill(0);
    for (let i = 0; i < N; i++) {
      let mx = 0;
      for (let k = 0; k < KF; k++) { let s = W[k * P]; for (let j = 0; j < F; j++) s += W[k * P + 1 + j] * Xm[i][j]; pr[k] = s; if (s > mx) mx = s; }
      let se = 0;
      for (let k = 0; k < KF; k++) { pr[k] = Math.exp(pr[k] - mx); se += pr[k]; }
      pr[KF] = Math.exp(-mx); se += pr[KF];
      for (let k = 0; k < KK; k++) pr[k] /= se;
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
    if (sing) return { W: [...W], iters: it, gn: gnL, converged: false };
    const dd = new Float64Array(PK);
    for (let r = PK - 1; r >= 0; r--) { let s = A[r * (PK + 1) + PK]; for (let j = r + 1; j < PK; j++) s -= A[r * (PK + 1) + j] * dd[j]; dd[r] = s / A[r * (PK + 1) + r]; }
    const reg0 = lossAt(W), ATOL = 1e-9 * Math.max(1, Math.abs(reg0));
    let acc = false;
    for (let ls = 0, step = 1; ls < 40; ls++) {
      for (let p = 0; p < PK; p++) W[p] += step * dd[p];
      if (lossAt(W) <= reg0 + ATOL) { acc = true; break; }
      for (let p = 0; p < PK; p++) W[p] -= step * dd[p];
      step *= 0.5;
    }
    if (!acc) return { W: [...W], iters: it, gn: gnL, converged: false };
  }
  return { W: [...W], iters: it, gn: gnL, converged: gnL <= 1e-8 };
}

export function probsOf(W, x, F) {
  if (!Number.isInteger(F) || F < 1) throw new Error('probsOf: F obrigatório');
  let mx = 0; const sc = [0, 0];
  for (let k = 0; k < KF; k++) { let s = W[k * (F + 1)]; for (let j = 0; j < F; j++) s += W[k * (F + 1) + 1 + j] * x[j]; sc[k] = s; if (s > mx) mx = s; }
  let se = Math.exp(-mx); const p = [0, 0, 0];
  for (let k = 0; k < KF; k++) { p[k] = Math.exp(sc[k] - mx); se += p[k]; }
  p[KF] = Math.exp(-mx);
  for (let k = 0; k < KK; k++) p[k] /= se;
  return p;
}

export function metrics(probsList, ys) {
  const N = ys.length;
  let ll = 0, br = 0;
  for (let i = 0; i < N; i++) {
    const P = probsList[i];
    ll += -Math.log(Math.max(P[ys[i]], 1e-300));
    br += P.reduce((s, v, k) => s + (v - (ys[i] === k ? 1 : 0)) ** 2, 0);
  }
  const conf = probsList.map((p) => Math.max(...p));
  const pred = probsList.map((p) => p.indexOf(Math.max(...p)));
  let ece = 0;
  for (let b = 0; b < 10; b++) {
    const idx = [];
    for (let i = 0; i < N; i++) { const lo = b / 10, hi = b === 9 ? 1.0000001 : (b + 1) / 10; if (conf[i] >= lo && conf[i] < hi) idx.push(i); }
    if (idx.length) ece += (idx.length / N) * Math.abs(idx.filter((i) => pred[i] === ys[i]).length / idx.length - idx.reduce((s, i) => s + conf[i], 0) / idx.length);
  }
  return { ll: ll / N, brier: br / N, ece };
}

export function hacVar(d, lags) {
  const N = d.length, m = d.reduce((s, v) => s + v, 0) / N;
  const gam = [];
  for (let l = 0; l <= lags; l++) { let s = 0; for (let i = l; i < N; i++) s += (l === 0 ? d[i] * d[i] : (d[i] - m) * (d[i - l] - m)); gam.push(s / N); }
  return (gam[0] + 2 * gam.slice(1).reduce((s, g, l) => s + (1 - (l + 1) / (lags + 1)) * g, 0)) / N;
}

export function normCdf(z) {
  const nn = 20000, h = z / nn;
  const ph = (t) => Math.exp(-t * t / 2) / Math.sqrt(2 * Math.PI);
  let s = ph(0) + ph(z);
  for (let i = 1; i < nn; i++) s += (i % 2 === 0 ? 2 : 4) * ph(i * h);
  return 0.5 + (s * h) / 3;
}
