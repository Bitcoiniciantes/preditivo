// scripts/predictive-v1-core.mjs — núcleo determinístico de construção (V1.3.1).
// Usado pelo construtor do dataset (faixa fechada) e pelo harness de truncamento
// (faixa truncada em t). NÃO lê banco, NÃO escreve arquivos, NÃO treina.
export const SPEC = {
  version: 'V1.3.1',
  anchorStep: 900000,
  tol: 90000,
  gapReset: 180000,
  warmup: 180,
  lam: Math.exp(-Math.log(2) / 60),
  sq15: Math.sqrt(15),
  k: 0.6745,
  normN: 13,
  normStep: 300000,
  eps: 1e-12,
  zclip: 5,
  resetCluster: 300000,
  resetExcl: 3900000,
};

function med(a) {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// rows: array {t,p,o,b,c,w,f} ordenado por (t) — desempate por id feito na query.
// caps: { cut, featCap, labelCap, anchorMaxT }.
export function computeAll(rows, caps) {
  const { cut, featCap, labelCap, anchorMaxT } = caps;
  const S = SPEC;
  const n = rows.length;
  const T = new Array(n), P = new Array(n), O = new Array(n),
    B = new Array(n), C = new Array(n), W = new Array(n), F = new Array(n);
  for (let i = 0; i < n; i++) {
    T[i] = rows[i].t; P[i] = rows[i].p; O[i] = rows[i].o; B[i] = rows[i].b;
    C[i] = rows[i].c; W[i] = rows[i].w; F[i] = rows[i].f;
  }
  // Fronteira de features: último índice com T <= featCap.
  let nF = n;
  {
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= featCap) lo = m + 1; else hi = m; }
    nF = lo;
  }
  function asofF(t) {
    let lo = 0, hi = nF - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  function asofL(t) {
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  const gaps = [];
  for (let i = 1; i < nF; i++) if (T[i] - T[i - 1] > S.gapReset) gaps.push(T[i]);
  // Grade 1-min + EWMA (só linhas de features). A grade vai até featCap para que
  // o minuto J de qualquer âncora <= featCap exista no mapa; minutos sem
  // snapshot fresco fazem hold (sem update, sem restart) — restart só em gap
  // evidenciado (>180 s entre snapshots consecutivos).
  const j0 = nF > 0 ? Math.floor((T[0] - cut) / 60000) : 0;
  const jMax = nF > 0 ? Math.ceil((featCap - cut) / 60000) : -1;
  const useS = new Map(), sigH = new Map(), r1 = new Map();
  {
    let vc = 0, s2 = 0;
    for (let j = j0; j <= jMax; j++) {
      const m = cut + j * 60000;
      let rst = false;
      for (let g = 0; g < gaps.length; g++) if (gaps[g] > m - 60000 && gaps[g] <= m) { rst = true; break; }
      const a = asofF(m);
      let ok = false, r = 0;
      if (!rst && a >= 0 && m - T[a] <= S.tol && P[a] > 0) {
        const a0 = asofF(m - 60000);
        if (a0 >= 0 && m - 60000 - T[a0] <= S.tol && P[a0] > 0) { ok = true; r = Math.log(P[a] / P[a0]); }
      }
      if (rst) { vc = 0; s2 = 0; }
      else if (ok) { vc++; s2 = (vc === 1) ? r * r : S.lam * s2 + (1 - S.lam) * r * r; r1.set(j, r); }
      useS.set(j, vc >= S.warmup);
      sigH.set(j, Math.sqrt(s2) * S.sq15);
    }
  }
  const resets = [];
  {
    let z = -1;
    for (let i = 0; i < nF; i++) {
      if (C[i] === 0) { if (z < 0) z = T[i]; }
      else if (z >= 0) { resets.push(z); z = -1; }
    }
    if (z >= 0) resets.push(z);
  }
  const resetIn = (a, b) => { for (let i = 0; i < resets.length; i++) if (resets[i] > a && resets[i] <= b) return true; return false; };
  function frozenRuns(X) {
    const runs = [];
    let s = 0;
    for (let i = 1; i <= nF; i++) {
      if (i < nF && X[i] === X[i - 1]) continue;
      if (i - s >= 5) runs.push([s, i - 1]);
      s = i;
    }
    return runs;
  }
  const frzP = frozenRuns(P), frzO = frozenRuns(O);
  const inRuns = (runs, idx) => { for (let k = 0; k < runs.length; k++) if (idx >= runs[k][0] && idx <= runs[k][1]) return true; return false; };
  function pts(X, t0, step, count) {
    const out = [];
    for (let k = 0; k < count; k++) {
      const tt = t0 - k * step, a = asofF(tt);
      if (a < 0 || tt - T[a] > S.tol || !isFinite(X[a])) return null;
      out.push(X[a]);
    }
    return out;
  }
  const anchors = [];
  for (let ak = 0; ; ak++) {
    const t = cut + ak * S.anchorStep;
    if (t + S.anchorStep > anchorMaxT) break;
    const J = Math.round((t - cut) / 60000);
    let cat = null;
    const sig = sigH.get(J), usable = useS.get(J);
    if (!usable || !(sig > 0) || !isFinite(sig)) cat = 'warm-up';
    let Pt = -1, Pf = -1;
    if (!cat) {
      Pt = asofF(t);
      if (Pt < 0 || t - T[Pt] > S.tol) cat = Pt < 0 ? 'falta de preço' : 'preço stale';
      else if (!(P[Pt] > 0)) cat = 'preço stale';
    }
    if (!cat) {
      Pf = asofL(t + S.anchorStep);
      if (Pf < 0 || T[Pf] > labelCap || t + S.anchorStep - T[Pf] > S.tol) {
        cat = (Pf < 0 || (Pf >= 0 && T[Pf] > labelCap)) ? 'falta de preço futuro' : 'ponto futuro fora da tolerância';
        if (Pf >= 0 && T[Pf] <= labelCap && !(P[Pf] > 0)) cat = 'ponto futuro fora da tolerância';
      } else if (!(P[Pf] > 0)) cat = 'ponto futuro fora da tolerância';
    }
    if (!cat) {
      const a = asofF(t - S.anchorStep);
      if (a < 0 || t - S.anchorStep - T[a] > S.tol || !(P[a] > 0)) cat = 'preço stale';
    }
    if (!cat && B[Pt] === 0) cat = 'book stale/invalid';
    const srcV = (X, miss, checkReset) => {
      const a = asofF(t), b = asofF(t - S.normStep);
      if (a < 0 || t - T[a] > S.tol || b < 0 || t - S.normStep - T[b] > S.tol) return miss;
      if (checkReset && resetIn(t - S.resetExcl, t)) return 'CVD reset';
      return null;
    };
    if (!cat) { const e = srcV(C, 'CVD stale', true); if (e) cat = e; }
    if (!cat) { const e = srcV(W, 'whale CVD stale', true); if (e) cat = e; }
    let oiFrozen = false;
    if (!cat) {
      const a = asofF(t), b = asofF(t - S.normStep);
      if (a < 0 || t - T[a] > S.tol || b < 0 || t - S.normStep - T[b] > S.tol) cat = 'OI stale/invalid';
      else if (O[a] === 0) cat = 'OI stale/invalid';
      else if (inRuns(frzO, a)) { cat = 'OI stale/invalid'; oiFrozen = true; }
    }
    const priceFrozen = !cat && Pt >= 0 && inRuns(frzP, Pt);
    const norm = (X) => {
      const v = pts(X, t - S.normStep, S.normStep, S.normN);
      if (!v) return { err: 'janela causal insuficiente para normalização' };
      const dl = [];
      for (let i = 0; i < S.normN - 1; i++) dl.push(v[i] - v[i + 1]);
      const m0 = med(dl);
      const mad = med(dl.map((x) => Math.abs(x - m0)));
      const sc = 1.4826 * mad;
      if (!(sc > S.eps)) return { err: 'degenerate_normalization' };
      return { d: dl[0], m: m0, mad, sc, z: Math.max(-S.zclip, Math.min(S.zclip, (dl[0] - m0) / sc)) };
    };
    let feat = null;
    if (!cat) {
      const nc = norm(C); if (nc.err) cat = nc.err;
      else {
        const nw = norm(W); if (nw.err) cat = nw.err;
        else {
          const no = norm(O); if (no.err) cat = no.err;
          else {
            const a15 = asofF(t - S.anchorStep);
            feat = {
              Pt: P[Pt], P15: P[a15], Pf: P[Pf],
              r_back_15m: Math.log(P[Pt] / P[a15]),
              imb: B[Pt], fund: F[Pt],
              cd: nc.d, cm: nc.m, cmad: nc.mad, cs: nc.sc, cz: nc.z,
              wd: nw.d, wm: nw.m, wmad: nw.mad, ws: nw.sc, wz: nw.z,
              od: no.d, om: no.m, omad: no.mad, os: no.sc, oz: no.z,
              sig,
            };
          }
        }
      }
    }
    let px = -1;
    { let s = 0, c0 = 0; for (let j2 = 1; j2 <= 60; j2++) { const v = r1.get(J - j2); if (v !== undefined) { s += Math.abs(v); c0++; } } if (c0 >= 30) px = s / c0; }
    anchors.push({ t, cat, feat, px, priceFrozen: !!priceFrozen, oiFrozen });
  }
  return { anchors, gaps: gaps.length, resets: resets.length, resetTimes: resets, gapTimes: gaps };
}

export function labelOf(a) {
  const r = Math.log(a.feat.Pf / a.feat.Pt);
  const th = SPEC.k * a.feat.sig;
  return { r, cls: r > th ? 'UP' : (r < -th ? 'DOWN' : 'RANGE') };
}
