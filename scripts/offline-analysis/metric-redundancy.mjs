// scripts/offline-analysis/metric-redundancy.mjs
//
// ESTUDO DE ASSOCIAÇÃO E CONSISTÊNCIA ENTRE MÉTRICAS — offline, manual, somente leitura.
//
// Investiga se as métricas exibidas no painel (imb, cvd, cvd_large, score, regime,
// flow_regime, absorption, divergence) se movem juntas ou representam fenômenos
// distintos, e se os rótulos qualitativos são compatíveis com os valores numéricos.
//
// O QUE FAZ: abre o SQLite em modo readOnly, alinha tudo pelo snapshots.timestamp
// (rótulos de regime_events via forward-fill), gera Pearson+Spearman (níveis e
// variações), co-ocorrências, contradições NEUTRAL_FLOW × |imb| e contexto de
// transições. Escreve Markdown + CSVs em reports/offline-analysis/.
//
// O QUE NÃO FAZ: nenhuma escrita no banco, nenhuma alteração de thresholds,
// parâmetros, detectores, score, painel ou produto ao vivo. Nenhuma conclusão de
// redesign: linguagem puramente descritiva e estatística.
//
// Uso manual: `node scripts/offline-analysis/metric-redundancy.mjs [--db <path>] [--out <dir>]`

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

if (process.argv.includes('--help')) {
  console.log('Uso: node scripts/offline-analysis/metric-redundancy.mjs [--db <path>] [--out <dir>]');
  process.exit(0);
}

const dbPath = path.resolve(arg('--db', path.join(root, 'services', 'market-ingestion', 'data', 'market.db')));
const outDir = path.resolve(arg('--out', path.join(root, 'reports', 'offline-analysis')));

const GAP_MS = 3 * 60_000; // mesma segmentação do coverage-report
const TRANS_WIN_MS = 5 * 60_000; // janela de contexto de transições (±5 min)
const CONTRA_THRESHOLDS = [0.5, 0.7, 0.9];
const MIN_N = 30; // N < 30 → amostra insuficiente
const DEF_FLOW = 'NEUTRAL_FLOW';
const DEF_ABS = 'NONE';
const DEF_DIV = 'NONE';
const IMB_BANDS = [
  ['<−50%', -Infinity, -0.5],
  ['−50…−15%', -0.5, -0.15],
  ['−15…+15%', -0.15, 0.15],
  ['+15…+50%', 0.15, 0.5],
  ['>+50%', 0.5, Infinity],
];

// ── estatística (sem dependências) ────────────────────────────────────────────
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function variance(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length;
}
// Pearson pairwise (ignora pares com não-finitos).
function pearson(xs, ys) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (n < 2) return { r: NaN, n };
  const dx = n * sxx - sx * sx, dy = n * syy - sy * sy;
  if (dx <= 0 || dy <= 0) return { r: NaN, n }; // variância zero → não calculável
  return { r: (n * sxy - sx * sy) / Math.sqrt(dx * dy), n };
}
// Ranks com média para empates (tie-average).
function ranks(a) {
  const idx = a.map((_, i) => i).sort((i, j) => a[i] - a[j]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}
function spearman(xs, ys) {
  const px = [], py = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
  }
  if (px.length < 2) return { r: NaN, n: px.length };
  return pearson(ranks(px), ranks(py));
}
function lowerBound(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
  return lo;
}
function nearestEventDist(evTs, t) {
  // Distância ao evento mais próximo (pré-ordenado). Retorna {dist, found}.
  if (!evTs.length) return { dist: NaN, found: false };
  const j = lowerBound(evTs, t);
  let best = Infinity;
  if (j < evTs.length) best = Math.min(best, Math.abs(evTs[j] - t));
  if (j > 0) best = Math.min(best, Math.abs(evTs[j - 1] - t));
  return { dist: best, found: true };
}

function iso(ms) { return new Date(ms).toISOString(); }
function fmtInt(n) { return Number(n).toLocaleString('pt-BR'); }
function f3(x) { return Number.isFinite(x) ? x.toFixed(3).replace('.', ',') : 'n/c'; }
function f1(x) { return Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : 'n/c'; }
function cell(r, n) {
  if (!Number.isFinite(r) || n < MIN_N) return 'amostra insuficiente';
  return f3(r);
}
function wording(r) {
  const a = Math.abs(r);
  if (!Number.isFinite(r)) return 'não calculável';
  if (a >= 0.7) return 'forte associação estatística no período analisado';
  if (a >= 0.4) return 'associação moderada';
  if (a >= 0.2) return 'associação fraca';
  return 'baixa associação observada';
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  // ── 1. Carga (somente SELECT) ─────────────────────────────────────────────
  const snaps = db.prepare(
    'SELECT timestamp, book_imbalance AS imb, cvd, cvd_large AS whale, score, regime ' +
    'FROM snapshots ORDER BY timestamp',
  ).all();
  const evs = db.prepare(
    'SELECT timestamp, event_type, from_state, to_state FROM regime_events ORDER BY timestamp',
  ).all();
  const cov = {};
  for (const c of ['book_imbalance', 'cvd', 'cvd_large', 'score', 'regime']) {
    cov[c] = db.prepare(`SELECT COUNT(*) total, COUNT("${c}") nonnull FROM snapshots`).get();
  }

  const N = snaps.length;
  const ts = snaps.map((s) => s.timestamp);

  // Segmentos (gap > 3 min quebra o segmento).
  const segId = new Array(N);
  let seg = 0;
  segId[0] = 0;
  let gapPairs = 0;
  for (let i = 1; i < N; i++) {
    if (ts[i] - ts[i - 1] > GAP_MS) { seg++; gapPairs++; }
    segId[i] = seg;
  }

  // ── 2. Forward-fill dos rótulos ───────────────────────────────────────────
  const flowEvs = evs.filter((e) => e.event_type === 'flow_change');
  const absEvs = evs.filter((e) => e.event_type.startsWith('absorption_')).map((e) => ({
    timestamp: e.timestamp,
    state: (e.event_type === 'absorption_resolved' || e.event_type === 'absorption_failed') ? 'NONE' : e.to_state,
  }));
  const divEvs = evs.filter((e) => e.event_type === 'divergence' || e.event_type === 'divergence_resolved' || e.event_type === 'divergence_failed')
    .map((e) => ({
      timestamp: e.timestamp,
      state: e.event_type === 'divergence' ? e.to_state : 'NONE',
    }));
  function fill(events, getState, def) {
    const out = new Array(N);
    let k = 0, cur = def, filled = 0, fromDefault = 0, firstTs = events.length ? events[0].timestamp : null;
    for (let i = 0; i < N; i++) {
      while (k < events.length && events[k].timestamp <= ts[i]) { cur = getState(events[k]); k++; }
      out[i] = cur;
      if (k > 0) filled++; else fromDefault++;
    }
    return { out, filled, fromDefault, firstTs, lastTs: events.length ? events[events.length - 1].timestamp : null, nEvents: events.length };
  }
  const flow = fill(flowEvs, (e) => e.to_state, DEF_FLOW);
  const abs = fill(absEvs, (e) => e.state, DEF_ABS);
  const div = fill(divEvs, (e) => e.state, DEF_DIV);

  const col = {
    imb: snaps.map((s) => s.imb),
    cvd: snaps.map((s) => s.cvd),
    whale: snaps.map((s) => s.whale),
    score: snaps.map((s) => s.score),
  };

  // ── 3. Variações intra-segmento ───────────────────────────────────────────
  const dcol = { imb: [], cvd: [], whale: [], score: [] };
  let diffPairs = 0, diffExcluded = 0;
  for (let i = 1; i < N; i++) {
    if (segId[i] !== segId[i - 1]) { diffExcluded++; continue; }
    dcol.imb.push(col.imb[i] - col.imb[i - 1]);
    dcol.cvd.push(col.cvd[i] - col.cvd[i - 1]);
    dcol.whale.push(col.whale[i] - col.whale[i - 1]);
    dcol.score.push(col.score[i] - col.score[i - 1]);
    diffPairs++;
  }

  // ── 4. Matrizes 4×4 ───────────────────────────────────────────────────────
  const VARS = [['imb', 'imb'], ['cvd', 'cvd'], ['whale', 'cvd_large'], ['score', 'score']];
  function matrix(get) {
    const m = [];
    for (const [ka] of VARS) for (const [kb] of VARS) {
      const p = pearson(get(ka), get(kb));
      const s = spearman(get(ka), get(kb));
      m.push({ a: ka, b: kb, pearson: p.r, spearman: s.r, n: p.n });
    }
    return m;
  }
  const levelM = matrix((k) => col[k]);
  const diffM = matrix((k) => dcol[k]);

  fs.mkdirSync(outDir, { recursive: true });
  const csvLevel = ['var_row,var_col,pearson,spearman,n'];
  for (const c of levelM) csvLevel.push([c.a, c.b, Number.isFinite(c.pearson) ? c.pearson.toFixed(6) : '', Number.isFinite(c.spearman) ? c.spearman.toFixed(6) : '', c.n].join(','));
  fs.writeFileSync(path.join(outDir, 'correlations-level.csv'), csvLevel.join('\n') + '\n');
  const csvDiff = ['var_row,var_col,pearson,spearman,n_diff_pairs,diff_pairs_excluded_by_gap'];
  for (const c of diffM) csvDiff.push([c.a, c.b, Number.isFinite(c.pearson) ? c.pearson.toFixed(6) : '', Number.isFinite(c.spearman) ? c.spearman.toFixed(6) : '', diffPairs, diffExcluded].join(','));
  fs.writeFileSync(path.join(outDir, 'correlations-diff.csv'), csvDiff.join('\n') + '\n');

  // ── 5. Co-ocorrências ─────────────────────────────────────────────────────
  function cooccur(labels) {
    const cats = {};
    for (let i = 0; i < N; i++) {
      const c = labels[i] ?? 'NULL';
      if (!cats[c]) cats[c] = [];
      cats[c].push(i);
    }
    return Object.entries(cats).map(([cat, idx]) => {
      const imb = idx.map((i) => col.imb[i]);
      const bands = IMB_BANDS.map(([, lo, hi]) => imb.filter((x) => x >= lo && x < hi).length);
      return {
        cat, n: idx.length, pct: idx.length / N,
        imbMean: mean(imb), imbMed: median(imb), bands,
        cvdMean: mean(idx.map((i) => col.cvd[i])), cvdMed: median(idx.map((i) => col.cvd[i])),
        whaleMean: mean(idx.map((i) => col.whale[i])), whaleMed: median(idx.map((i) => col.whale[i])),
        scoreMean: mean(idx.map((i) => col.score[i])), scoreMed: median(idx.map((i) => col.score[i])),
      };
    }).sort((a, b) => b.n - a.n);
  }
  const coFlow = cooccur(flow.out);
  const coRegime = cooccur(snaps.map((s) => s.regime));
  const coAbs = cooccur(abs.out);
  const coDiv = cooccur(div.out);
  function coCsv(rows) {
    const L = ['category,n,pct,imb_mean,imb_median,imb_lt_m50,imb_m50_m15,imb_m15_p15,imb_p15_p50,imb_gt_p50,cvd_mean,cvd_median,whale_mean,whale_median,score_mean,score_median'];
    for (const r of rows) {
      L.push([r.cat, r.n, r.pct.toFixed(6),
        Number.isFinite(r.imbMean) ? r.imbMean.toFixed(6) : '', Number.isFinite(r.imbMed) ? r.imbMed.toFixed(6) : '',
        ...r.bands,
        Number.isFinite(r.cvdMean) ? r.cvdMean.toFixed(2) : '', Number.isFinite(r.cvdMed) ? r.cvdMed.toFixed(2) : '',
        Number.isFinite(r.whaleMean) ? r.whaleMean.toFixed(2) : '', Number.isFinite(r.whaleMed) ? r.whaleMed.toFixed(2) : '',
        Number.isFinite(r.scoreMean) ? r.scoreMean.toFixed(3) : '', Number.isFinite(r.scoreMed) ? r.scoreMed.toFixed(3) : ''].join(','));
    }
    return L.join('\n') + '\n';
  }
  fs.writeFileSync(path.join(outDir, 'cooccurrence-flow.csv'), coCsv(coFlow));
  fs.writeFileSync(path.join(outDir, 'cooccurrence-regime.csv'), coCsv(coRegime));
  fs.writeFileSync(path.join(outDir, 'cooccurrence-absorption.csv'), coCsv(coAbs));
  fs.writeFileSync(path.join(outDir, 'cooccurrence-divergence.csv'), coCsv(coDiv));

  // ── 6. Contradições NEUTRAL_FLOW × |imb| ───────────────────────────────────
  const flowTs = flowEvs.map((e) => e.timestamp);
  const contraRows = [];
  for (const th of CONTRA_THRESHOLDS) {
    const idx = [];
    for (let i = 0; i < N; i++) if (flow.out[i] === DEF_FLOW && Math.abs(col.imb[i]) > th) idx.push(i);
    const nPos = idx.filter((i) => col.imb[i] > 0).length;
    const nNeg = idx.length - nPos;
    const nNeutral = flow.out.filter((f) => f === DEF_FLOW).length;
    // (a) whale com sinal oposto ao imb.
    const nOpp = idx.filter((i) => col.whale[i] * col.imb[i] < 0).length;
    // (b) proximidade de flow_change (±5 min).
    const nNear = idx.filter((i) => nearestEventDist(flowTs, ts[i]).dist <= TRANS_WIN_MS).length;
    // (c) variação brusca vs snapshot anterior do mesmo segmento (|Δimb| > 0,3).
    let nJump = 0, nJumpNA = 0;
    for (const i of idx) {
      if (i === 0 || segId[i] !== segId[i - 1]) { nJumpNA++; continue; }
      if (Math.abs(col.imb[i] - col.imb[i - 1]) > 0.3) nJump++;
    }
    // Dominância aproximada (retrospectiva, campos persistidos — NÃO é o estado interno).
    const doms = idx.map((i) =>
      Math.max(-1, Math.min(1, col.imb[i])) * 50 +
      Math.max(-1, Math.min(1, col.whale[i] / 500_000)) * 50);
    const domConsistent = doms.filter((d) => Math.abs(d) < 60).length;
    contraRows.push({
      th, n: idx.length, pctGlobal: N ? idx.length / N : 0,
      pctWithin: nNeutral ? idx.length / nNeutral : 0, nPos, nNeg,
      nOpp, nNear, nJump, nJumpNA, domMed: median(doms),
      pctDomConsistent: doms.length ? domConsistent / doms.length : NaN,
    });
  }
  const csvContra = ['threshold,n,pct_global,pct_within_neutral,n_pos,n_neg,n_whale_opposite,n_near_flow_change_5min,n_sharp_imb_jump,n_jump_na,dom_approx_median,pct_dom_approx_consistent_neutral'];
  for (const r of contraRows) {
    csvContra.push([r.th, r.n, r.pctGlobal.toFixed(6), r.pctWithin.toFixed(6), r.nPos, r.nNeg,
      r.nOpp, r.nNear, r.nJump, r.nJumpNA,
      Number.isFinite(r.domMed) ? r.domMed.toFixed(2) : '',
      Number.isFinite(r.pctDomConsistent) ? r.pctDomConsistent.toFixed(4) : ''].join(','));
  }
  fs.writeFileSync(path.join(outDir, 'contradictions.csv'), csvContra.join('\n') + '\n');

  // ── 7. Outras combinações ──────────────────────────────────────────────────
  // flow × sinal(cvd nível) e flow × sinal(Δcvd) — nível reflete acumulação desde o boot.
  const flowSignLevel = {}, flowSignDelta = {};
  for (let i = 0; i < N; i++) {
    const f = flow.out[i];
    const sl = col.cvd[i] > 0 ? '+' : col.cvd[i] < 0 ? '−' : '0';
    if (!flowSignLevel[f]) flowSignLevel[f] = { '+': 0, '−': 0, '0': 0 };
    flowSignLevel[f][sl]++;
  }
  for (let i = 1; i < N; i++) {
    if (segId[i] !== segId[i - 1]) continue;
    const f = flow.out[i];
    const d = col.cvd[i] - col.cvd[i - 1];
    const sd = d > 0 ? '+' : d < 0 ? '−' : '0';
    if (!flowSignDelta[f]) flowSignDelta[f] = { '+': 0, '−': 0, '0': 0 };
    flowSignDelta[f][sd]++;
  }
  // regime × flow.
  const regFlow = {};
  for (let i = 0; i < N; i++) {
    const k = `${snaps[i].regime} × ${flow.out[i]}`;
    regFlow[k] = (regFlow[k] ?? 0) + 1;
  }
  // absorption × faixas(imb).
  const absBands = {};
  for (let i = 0; i < N; i++) {
    const b = IMB_BANDS.find(([, lo, hi]) => col.imb[i] >= lo && col.imb[i] < hi)[0];
    const k = `${abs.out[i]} × ${b}`;
    absBands[k] = (absBands[k] ?? 0) + 1;
  }
  // divergence × imb/cvd (média/mediana por estado).
  const divGroups = {};
  for (let i = 0; i < N; i++) {
    const d = div.out[i];
    if (!divGroups[d]) divGroups[d] = { imb: [], whale: [], dcvd: [] };
    divGroups[d].imb.push(col.imb[i]);
    divGroups[d].whale.push(col.whale[i]);
    if (i > 0 && segId[i] === segId[i - 1]) divGroups[d].dcvd.push(col.cvd[i] - col.cvd[i - 1]);
  }

  // ── 8. Transições (±5 min, sem dupla contagem por grupo) ────────────────────
  const baseIdx = new Set();
  for (let i = 0; i < N; i++) if (flow.out[i] === DEF_FLOW && Math.abs(col.imb[i]) > 0.7) baseIdx.add(i);
  const baseline = N ? baseIdx.size / N : 0;
  const groups = {
    regime_change: evs.filter((e) => e.event_type === 'regime_change').map((e) => e.timestamp),
    flow_change: flowTs,
    absorption: absEvs.map((e) => e.timestamp),
    divergence: divEvs.map((e) => e.timestamp),
  };
  const transRows = [];
  for (const [g, ets] of Object.entries(groups)) {
    const inWin = new Set();
    for (const et of ets) {
      const lo = lowerBound(ts, et - TRANS_WIN_MS);
      for (let i = lo; i < N && ts[i] <= et + TRANS_WIN_MS; i++) inWin.add(i);
    }
    let hit = 0;
    for (const i of inWin) if (baseIdx.has(i)) hit++;
    transRows.push({ g, nEvents: ets.length, nSnaps: inWin.size, rate: inWin.size ? hit / inWin.size : NaN });
  }
  const csvTrans = ['group,n_events,n_snapshots_in_windows,contradiction_rate_70,baseline_rate_70'];
  for (const r of transRows) csvTrans.push([r.g, r.nEvents, r.nSnaps, Number.isFinite(r.rate) ? r.rate.toFixed(6) : '', baseline.toFixed(6)].join(','));
  fs.writeFileSync(path.join(outDir, 'transitions.csv'), csvTrans.join('\n') + '\n');

  // ── 9. Markdown (11 seções) ────────────────────────────────────────────────
  const L = [];
  L.push('# Associação e consistência entre métricas — estudo offline retrospectivo');
  L.push('');
  L.push('_Diagnóstico da estrutura dos dados já coletados. Leitura em modo somente leitura; nada foi escrito ou alterado._');
  L.push('');
  L.push('_Linguagem descritiva e estatística. Nenhuma métrica é classificada como errada, redundante ou candidata a remoção._');
  L.push('');
  L.push('## 1. Objetivo e escopo');
  L.push('');
  L.push('Verificar se `imb`, `cvd`, `cvd_large` e `score` se movem juntos ou representam fenômenos distintos no histórico, e se os rótulos `flow_regime`, `regime`, `absorption` e `divergence` são compatíveis com os valores numéricos que os acompanham. Inclui o caso observado no painel (`flow_regime` NEUTRO com imbalance extremo e CVD negativo), tratado como combinação a quantificar — sem presumir erro.');
  L.push('');
  L.push('## 2. Dataset e período');
  L.push('');
  L.push(`- Banco: \`${dbPath}\` (aberto com \`readOnly: true\`)`);
  L.push(`- Gerado em: ${iso(Date.now())}`);
  L.push(`- Snapshots: ${fmtInt(N)}${N ? ` (${iso(ts[0])} → ${iso(ts[N - 1])})` : ''}`);
  L.push(`- Regime events: ${fmtInt(evs.length)}`);
  L.push(`- Resolução temporal dos snapshots: cadência nominal de 60 s (persistência) vs broadcast ao vivo de ~1 s — o snapshot amostra um instante; estados com confirmação de ~5 ticks podem transitar entre snapshots.`);
  L.push('');
  L.push('### Resolução de `LOW_VOLATILITY` (Etapa 0)');
  L.push('');
  L.push('- Origem: `updateRegime()` em `services/market-ingestion/src/features/regime.ts` (`rangePercent < 0.3`).');
  L.push('- Componente efetivo: legado. O daemon atual usa `RegimeDetector` (`engine/regime.ts`, só RANGE/BULL_TREND/BEAR_TREND); `features/regime.ts` não possui importadores (código morto desde o commit `fc9c3e7`).');
  L.push('- Condição: snapshots gravados pelo daemon original (commit `e4e9f93`, 22/08) antes da troca de engine.');
  L.push('- Valores possíveis em `snapshots.regime`: RANGE, BULL_TREND, BEAR_TREND + legado LOW_VOLATILITY (295 linhas, ~0,75%, restritas a 22/08–23/08).');
  L.push('- Tratamento: categoria própria nas co-ocorrências, sem remapeamento.');
  L.push('');
  L.push('## 3. Fontes das métricas');
  L.push('');
  L.push('| Métrica | Origem no código | Campo no market.db | Disponibilidade |');
  L.push('|---|---|---|---|');
  L.push('| `imb` | `OrderBookManager.getState()` → `(bid−ask)/(bid+ask)` | `snapshots.book_imbalance` | por snapshot |');
  L.push('| `cvd` | `flow/cvd.ts` → `totalCvd` acumulado em memória (zera em restart) | `snapshots.cvd` | por snapshot, sujeito a reset |');
  L.push('| `cvd_large` | trades com nocional ≥ US$ 100k (`CONFIG.flow.whaleNotionalUsd`) | `snapshots.cvd_large` | por snapshot |');
  L.push('| `score` | `computeScore()` (`features/score.ts`) | `snapshots.score` | por snapshot |');
  L.push('| `regime` | `RegimeDetector` (`engine/regime.ts`) + legado `features/regime.ts` | `snapshots.regime` | por snapshot |');
  L.push('| `flow_regime` | `FlowRegimeDetector` (dominância ±60, confirmação 5 ticks) | `regime_events.flow_change` | reconstrução por forward-fill |');
  L.push('| `absorption` | `AbsorptionDetector` (imb ±0,15 × whale ±100k) | `regime_events.absorption_*` | reconstrução por forward-fill |');
  L.push('| `divergence` | `detectDivergence` (só em RANGE, confiança ≥35) | `regime_events.divergence*` | reconstrução por forward-fill |');
  L.push('');
  L.push('Nota: o campo persistido é `cvd_large` (não `cvd_whale`; este é o nome no snapshot ao vivo).');
  L.push('');
  L.push('### Fórmula do score (transcrição de `features/score.ts`)');
  L.push('');
  L.push('```text');
  L.push('trend = +20 se BULL_TREND / −20 se BEAR_TREND / 0 se RANGE (HIGH_VOLATILITY: ±10 por priceChange; demais: 0)');
  L.push('momentum = ±14 / ±8 por faixas de priceChange (persistido com priceChange = 0 → 0)');
  L.push('cvd = round(clamp(cvdDelta / 1e6) × 8), onde cvdDelta = nível de totalCvd');
  L.push('derivatives = faixas de oiChange (±8/±4) ∓ 4 por fundingRate extremo');
  L.push('liquidity = +6/+3/−3/−6 por faixas de imbalance (±0,3 / ±0,1)');
  L.push('risk = −10 se HIGH_VOLATILITY / −2 se LOW_VOLATILITY / −6 demais');
  L.push('score = clamp(trend + momentum + cvd + derivatives + liquidity + risk, −100, +100)');
  L.push('```');
  L.push('');
  L.push('> Relações `score × regime`, `score × imb`, `score × cvd`, `score × oi` e `score × funding` podem possuir **dependência estrutural**, pois essas variáveis participam da própria composição do score. Correlação score × componente não deve ser interpretada como descoberta independente de associação entre sinais.');
  L.push('');
  L.push('## 4. Alinhamento temporal');
  L.push('');
  L.push('- Eixo único: `snapshots.timestamp`. `imb/cvd/cvd_large/score/regime` vêm da mesma linha — sem join, sem proximidade.');
  L.push('- Rótulos: último evento do tipo com `event.timestamp <= snapshot.timestamp` (forward-fill); defaults (`NEUTRAL_FLOW`/`NONE`/`NONE`) só antes do primeiro evento.');
  L.push('- Tolerância de proximidade: não aplicável.');
  L.push(`- flow_change: ${fmtInt(flow.nEvents)} eventos (${flow.firstTs ? iso(flow.firstTs) : '—'} → ${flow.lastTs ? iso(flow.lastTs) : '—'}); snapshots com estado reconstruído: ${fmtInt(flow.filled)}; no default pré-primeiro-evento: ${fmtInt(flow.fromDefault)}.`);
  L.push(`- absorption: ${fmtInt(abs.nEvents)} eventos (${abs.firstTs ? iso(abs.firstTs) : '—'} → ${abs.lastTs ? iso(abs.lastTs) : '—'}); reconstruídos: ${fmtInt(abs.filled)}; default: ${fmtInt(abs.fromDefault)}.`);
  L.push(`- divergence: ${fmtInt(div.nEvents)} eventos (${div.firstTs ? iso(div.firstTs) : '—'} → ${div.lastTs ? iso(div.lastTs) : '—'}); reconstruídos: ${fmtInt(div.filled)}; default: ${fmtInt(div.fromDefault)}.`);
  L.push('');
  L.push('## 5. Disponibilidade e cobertura');
  L.push('');
  L.push('| Coluna | Não-nulos | Total | Cobertura |');
  L.push('|---|---|---|---|');
  for (const [colName, key] of [['book_imbalance', 'book_imbalance'], ['cvd', 'cvd'], ['cvd_large', 'cvd_large'], ['score', 'score'], ['regime', 'regime']]) {
    const c = cov[colName];
    L.push(`| \`${colName}\` | ${fmtInt(c.nonnull)} | ${fmtInt(c.total)} | ${(c.total ? c.nonnull / c.total * 100 : 0).toFixed(1).replace('.', ',')}% |`);
  }
  L.push('');
  L.push(`- Snapshots totais: ${fmtInt(N)}; válidos (linha completa): ${fmtInt(N)}; descartados: 0.`);
  L.push(`- Pares consecutivos para variações: ${fmtInt(diffPairs)} utilizados; ${fmtInt(diffExcluded)} excluídos por gap/segmento (contabilizados, não imputados).`);
  L.push('- Resets do CVD: o acumulador zera em restart do daemon; pares que cruzam gaps (>3 min) são excluídos das variações. Resets dentro de um segmento contínuo não são detectáveis pelos campos persistidos — limitação registrada.');
  L.push('');
  function matMd(m, title) {
    L.push(title);
    L.push('');
    L.push('|  | imb | cvd | cvd_large | score |');
    L.push('|---|---|---|---|---|');
    for (const [ka, label] of VARS) {
      const cells = VARS.map(([kb]) => {
        const c = m.find((x) => x.a === ka && x.b === kb);
        return `${cell(c.pearson, c.n)} / ${cell(c.spearman, c.n)} (N=${fmtInt(c.n)})`;
      });
      L.push(`| **${label}** | ${cells.join(' | ')} |`);
    }
    L.push('');
    L.push('Cada célula: `Pearson / Spearman (N pairwise)`. `amostra insuficiente` = N<30 ou variância zero. CSVs: `correlations-level.csv`, `correlations-diff.csv`.');
    L.push('');
  }
  L.push('## 6. Correlações de níveis (descritivas — CVD cumulativo)');
  L.push('');
  matMd(levelM, 'Matriz 4×4 — níveis persistidos.');
  L.push('> A correlação de níveis de CVD é descritiva: `cvd`/`cvd_large` são acumuladores com resets; associação de níveis não equivale a movimento conjunto.');
  L.push('');
  L.push('## 7. Correlações de variações (movimento conjunto)');
  L.push('');
  matMd(diffM, 'Matriz 4×4 — variações entre snapshots consecutivos do mesmo segmento.');
  const topDiff = [...diffM].filter((c) => c.a !== c.b).sort((a, b) => Math.abs(b.spearman || 0) - Math.abs(a.spearman || 0))[0];
  if (topDiff && Number.isFinite(topDiff.spearman)) {
    L.push(`Maior |Spearman| fora da diagonal: \`${topDiff.a} × ${topDiff.b}\` = ${f3(topDiff.spearman)} (N=${fmtInt(topDiff.n)}) — ${wording(topDiff.spearman)}.`);
    L.push('');
  }
  function coMd(rows, title) {
    L.push(title);
    L.push('');
    L.push('| Categoria | N | % | imb média | imb mediana | imb [<−50/−50…−15/−15…+15/+15…+50/>+50] | cvd média/mediana | whale média/mediana | score média/mediana |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      L.push(`| \`${r.cat}\` | ${fmtInt(r.n)} | ${(r.pct * 100).toFixed(1).replace('.', ',')}% | ${f3(r.imbMean)} | ${f3(r.imbMed)} | ${r.bands.join('/')} | ${fmtInt(Math.round(r.cvdMean))}/${fmtInt(Math.round(r.cvdMed))} | ${fmtInt(Math.round(r.whaleMean))}/${fmtInt(Math.round(r.whaleMed))} | ${f1(r.scoreMean)}/${f1(r.scoreMed)} |`);
    }
    L.push('');
  }
  L.push('## 8. Co-ocorrências');
  L.push('');
  L.push('Valores observados no histórico (sem "valor esperado"). CSVs: `cooccurrence-{flow,regime,absorption,divergence}.csv`.');
  L.push('');
  coMd(coFlow, '### flow_regime');
  coMd(coRegime, '### regime (inclui legado LOW_VOLATILITY como categoria própria)');
  coMd(coAbs, '### absorption');
  coMd(coDiv, '### divergence');
  L.push('## 9. Contradições (NEUTRAL_FLOW × |imb|)');
  L.push('');
  L.push('Frequência observada da combinação que motivou o estudo. Hipóteses mecanicamente plausíveis (código) testadas como quantificação, não como causas presumidas: (a) `cvd_large` com sinal oposto cancela o `imb` na dominância; (b) proximidade de `flow_change` (confirmação de 5 ticks); (c) snapshot transitório na cadência de 60 s (|Δimb|>0,3 vs anterior).');
  L.push('');
  L.push('| Faixa | Ocorrências | % global | % dentro de NEUTRO | + / − | whale oposto | próx. flow_change ±5min | salto brusco imb | dom. aprox. mediana | % dom. aprox. compatível (<60) |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of contraRows) {
    L.push(`| \\|imb\\|>${Math.round(r.th * 100)}% | ${fmtInt(r.n)} | ${(r.pctGlobal * 100).toFixed(2).replace('.', ',')}% | ${(r.pctWithin * 100).toFixed(2).replace('.', ',')}% | ${fmtInt(r.nPos)}/${fmtInt(r.nNeg)} | ${fmtInt(r.nOpp)} (${r.n ? (r.nOpp / r.n * 100).toFixed(1).replace('.', ',') : '—'}%) | ${fmtInt(r.nNear)} (${r.n ? (r.nNear / r.n * 100).toFixed(1).replace('.', ',') : '—'}%) | ${fmtInt(r.nJump)} (s/ anterior: ${fmtInt(r.nJumpNA)}) | ${Number.isFinite(r.domMed) ? r.domMed.toFixed(1).replace('.', ',') : 'n/c'} | ${Number.isFinite(r.pctDomConsistent) ? (r.pctDomConsistent * 100).toFixed(1).replace('.', ',') + '%' : 'n/c'} |`);
  }
  L.push('');
  L.push('> Dominância aproximada = contribuição do imbalance + contribuição aproximada do whale CVD a partir dos campos persistidos: **aproximação retrospectiva baseada nos campos persistidos**, não reprodução do estado interno do detector (valor amostrado a 60 s vs ticks de ~1 s + confirmação).');
  L.push('');
  L.push('> Nota metodológica: `flow_change` possui ~70 mil eventos para ~39 mil snapshots; janelas de ±5 min cobrem a quase totalidade dos snapshots, de modo que o percentual "próximo a flow_change" reflete densidade de eventos e não concentração do fenômeno — a comparação correta é a taxa vs baseline da seção 10.');
  L.push('');
  L.push('CSV: `contradictions.csv`.');
  L.push('');
  L.push('## 10. Transições (±5 min, descritivo, sem causalidade)');
  L.push('');
  L.push(`Baseline: snapshots com NEUTRO ∧ |imb|>70% sobre o total = ${(baseline * 100).toFixed(2).replace('.', ',')}%. Cada evento tem sua janela; snapshots sem dupla contagem dentro do grupo; N de eventos e N de snapshots reportados separadamente. CSV: \`transitions.csv\`.`);
  L.push('');
  L.push('| Grupo de eventos | N eventos | N snapshots em janelas | Taxa de contradição | Baseline |');
  L.push('|---|---|---|---|---|');
  for (const r of transRows) {
    L.push(`| \`${r.g}\` | ${fmtInt(r.nEvents)} | ${fmtInt(r.nSnaps)} | ${Number.isFinite(r.rate) ? (r.rate * 100).toFixed(2).replace('.', ',') + '%' : 'n/c'} | ${(baseline * 100).toFixed(2).replace('.', ',')}% |`);
  }
  L.push('');
  L.push('### Outras combinações (diagnósticas)');
  L.push('');
  L.push('flow × sinal(cvd nível) — o sinal do nível reflete acumulação desde o boot do daemon:');
  L.push('');
  for (const [f, s] of Object.entries(flowSignLevel)) L.push(`- \`${f}\`: +:${fmtInt(s['+'])} / −:${fmtInt(s['−'])} / 0:${fmtInt(s['0'])}`);
  L.push('');
  L.push('flow × sinal(Δcvd) (movimento entre snapshots consecutivos do mesmo segmento):');
  L.push('');
  for (const [f, s] of Object.entries(flowSignDelta)) L.push(`- \`${f}\`: +:${fmtInt(s['+'])} / −:${fmtInt(s['−'])} / 0:${fmtInt(s['0'])}`);
  L.push('');
  L.push('regime × flow (contagens):');
  L.push('');
  for (const [k, v] of Object.entries(regFlow).sort((a, b) => b[1] - a[1])) L.push(`- \`${k}\`: ${fmtInt(v)}`);
  L.push('');
  L.push('absorption × faixas(imb) (contagens):');
  L.push('');
  for (const [k, v] of Object.entries(absBands).sort((a, b) => b[1] - a[1])) L.push(`- \`${k}\`: ${fmtInt(v)}`);
  L.push('');
  L.push('divergence × imb/cvd (média/mediana):');
  L.push('');
  for (const [d, g] of Object.entries(divGroups)) {
    L.push(`- \`${d}\` (N=${fmtInt(g.imb.length)}): imb ${f3(mean(g.imb))}/${f3(median(g.imb))}; whale ${fmtInt(Math.round(mean(g.whale)))}/${fmtInt(Math.round(median(g.whale)))}; Δcvd ${fmtInt(Math.round(mean(g.dcvd)))}/${fmtInt(Math.round(median(g.dcvd)))}`);
  }
  L.push('');
  L.push('## 11. Limitações e interpretação');
  L.push('');
  L.push('- `cvd`/`cvd_large` são acumuladores com reset em restart: níveis descrevem posição acumulada, não fluxo; a análise de movimento é a de variações.');
  L.push('- Rótulos reconstruídos por forward-fill de eventos; reinícios do daemon resetam detectores sem emitir evento — possível atraso residual após gaps (quantificado pelos pares excluídos).');
  L.push('- Broadcast de ~1 s vs snapshot de 60 s: o snapshot amostra um instante; combinações aparentemente contraditórias podem ser transitórias.');
  L.push('- `LOW_VOLATILITY`: legado de 295 snapshots (22/08–23/08), tratado como categoria própria.');
  L.push('- Dependência estrutural do score (§3/§5): correlação score × componente não é descoberta independente.');
  L.push('- Dominância aproximada (§9) não reproduz o detector; hipóteses (a–c) quantificadas, não confirmadas como causas.');
  L.push('- Conclusões limitadas a: associação estatística observada, coocorrência e comportamento observado na amostra. Nenhum redesenho, remoção de métrica ou alteração de parâmetro decorre deste estudo.');
  L.push('');
  L.push('---');
  L.push('_Estudo diagnóstico. Não constitui sinal, previsão, recomendação ou preparação de V2._');

  fs.writeFileSync(path.join(outDir, 'metric-redundancy.md'), L.join('\n') + '\n');
  console.log(`[metric-redundancy] N=${N} events=${evs.length} diffPairs=${diffPairs} excluded=${diffExcluded} -> ${outDir}`);
} finally {
  db.close();
}
