// scripts/predictive-v1-truncate.mjs — PASSO 2 / FASE C (§23, §24 V1.3.1)
// Recomputa 200 âncoras determinísticas a partir de market.db (mode=ro) com a
// fonte truncada em t (features) / t+15m (rótulo), via predictive-v1-core.mjs,
// e compara com data/predictive_v1.db. Divergência fora das tolerâncias = VAZAMENTO.
// --canary: injeta deliberadamente P_(t+1m) no r_back_15m e exige detecção (flag).
// Uso: node scripts/predictive-v1-truncate.mjs [--canary]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAll, labelOf, SPEC } from './predictive-v1-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const MARKET = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const PDB = path.join(root, 'data', 'predictive_v1.db');
const CANARY = process.argv.includes('--canary');

const CUT = Date.parse('2026-08-26T12:58:00Z');
const FTOL = 1e-12;

const pdb = new DatabaseSync(PDB, { readOnly: true });
const T_pool_end = Number(pdb.prepare("SELECT v FROM meta WHERE k='T_pool_end'").get().v);
const stored = pdb.prepare(
  'SELECT a.anchor_t AS t, a.valid AS v, a.discard_reason AS cat, ' +
  'f.P_t AS Pt, f.r_back_15m AS rb, f.book_imbalance AS ib, f.cvd_z AS cz, f.whale_z AS wz, f.doi_z AS oz, f.sigma_H AS sig, ' +
  'l.r_fwd_15m AS rf, l.class AS cls ' +
  'FROM anchors a LEFT JOIN features f ON f.anchor_t=a.anchor_t LEFT JOIN labels l ON l.anchor_t=a.anchor_t ' +
  'ORDER BY a.anchor_t'
).all();
pdb.close();

const mdb = new DatabaseSync(MARKET, { readOnly: true });
// Tempos de gaps/resets para estratificação (mesmo núcleo, faixa fechada).
const allRows = mdb.prepare(
  'SELECT id, timestamp AS t, price AS p, oi AS o, book_imbalance AS b, cvd AS c, cvd_large AS w, funding_rate AS f ' +
  'FROM snapshots WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp, id'
).all(CUT - 6 * 3600000, T_pool_end);
const full = computeAll(allRows, { cut: CUT, featCap: T_pool_end, labelCap: T_pool_end, anchorMaxT: T_pool_end });

// Seleção determinística de 200 âncoras com cobertura de bordas (§23.3).
const byT = new Map(stored.map((r) => [r.t, r]));
const edge = new Set();
const near = (times, win) => {
  for (const r of stored) {
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(r.t - times[i]) <= win) { edge.add(r.t); break; }
    }
  }
};
near(full.gapTimes, 1800000);
near(full.resetTimes, 1800000);
for (let i = 0; i < 10 && i < stored.length; i++) edge.add(stored[i].t); // início (warm-up)
for (let i = Math.max(0, stored.length - 10); i < stored.length; i++) edge.add(stored[i].t); // T_pool_end
// Transições warm-up -> válido (fim do warm-up).
for (let i = 1; i < stored.length; i++) {
  if (stored[i - 1].cat === 'warm-up' && stored[i - 1].cat !== stored[i].cat) edge.add(stored[i].t);
}
const edgeArr = [...edge].sort((a, b) => a - b);
const picked = [...edgeArr];
if (picked.length < 200) {
  const step = Math.max(1, Math.floor(stored.length / (200 - picked.length)));
  for (let i = 0; i < stored.length && picked.length < 200; i += step) {
    if (!edge.has(stored[i].t)) picked.push(stored[i].t);
  }
  for (let i = 0; i < stored.length && picked.length < 200; i++) {
    if (!picked.includes(stored[i].t)) picked.push(stored[i].t);
  }
}
const sample = picked.slice(0, 200).sort((a, b) => a - b);

function close(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  return Math.abs(a - b) <= FTOL;
}

let checked = 0, leaked = 0, canaryFlagged = 0, canaryIdentical = 0, canarySusp = 0;
const leakDetail = [];
const cover = { gap: 0, reset: 0, warmupTrans: 0, poolEnd: 0, common: 0 };
for (const t of sample) {
  const s = byT.get(t);
  const isGap = full.gapTimes.some((g) => Math.abs(t - g) <= 1800000);
  const isReset = full.resetTimes.some((r) => Math.abs(t - r) <= 1800000);
  const isEnd = t >= T_pool_end - 10 * 900000;
  if (isGap) cover.gap++; else if (isReset) cover.reset++; else if (isEnd) cover.poolEnd++; else cover.common++;
  const rows = mdb.prepare(
    'SELECT id, timestamp AS t, price AS p, oi AS o, book_imbalance AS b, cvd AS c, cvd_large AS w, funding_rate AS f ' +
    'FROM snapshots WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp, id'
  ).all(CUT - 6 * 3600000, t + SPEC.anchorStep);
  const comp = computeAll(rows, { cut: CUT, featCap: CANARY ? t + 60000 : t, labelCap: t + SPEC.anchorStep, anchorMaxT: t + SPEC.anchorStep });
  const rec = comp.anchors.find((a) => a.t === t);
  if (!rec) { leaked++; leakDetail.push({ t, why: 'ancora ausente na recomputação' }); continue; }
  checked++;
  if (CANARY) {
    // Injeção deliberada: r_back com P_(t+1m) em vez de P_t.
    // Âncoras inválidas (sem features armazenadas) não são comparáveis: pular.
    if (s.rb === null || s.rb === undefined) continue;
    const fut = rows.filter((r) => r.t <= t + 60000);
    const pf1 = fut.length ? fut[fut.length - 1].p : null;
    const past = rows.filter((r) => r.t <= t - SPEC.anchorStep);
    const p15 = past.length ? past[past.length - 1].p : null;
    if (pf1 && p15) {
      const cheat = Math.log(pf1 / p15);
      if (Math.abs(cheat - s.rb) > FTOL) canaryFlagged++;
      else {
        canaryIdentical++;
        // Injeção inefetiva só é aceitável se o preço futuro for bit-idêntico
        // ao legítimo (frozen-line real); senão é falha de detecção.
        if (pf1 !== s.Pt) canarySusp++;
      }
    }
    continue;
  }
  const bad = [];
  if ((rec.cat || null) !== s.cat) bad.push('cat:' + s.cat + '->' + rec.cat);
  if (!rec.cat && rec.feat) {
    if (!close(rec.feat.Pt, s.Pt)) bad.push('Pt');
    if (!close(rec.feat.r_back_15m, s.rb)) bad.push('r_back_15m');
    if (!close(rec.feat.imb, s.ib)) bad.push('imb');
    if (!close(rec.feat.cz, s.cz)) bad.push('cvd_z');
    if (!close(rec.feat.wz, s.wz)) bad.push('whale_z');
    if (!close(rec.feat.oz, s.oz)) bad.push('doi_z');
    if (!close(rec.feat.sig, s.sig)) bad.push('sigma_H');
    if (s.cls === null || s.cls === undefined) {
      // Holdout selado: rótulo ausente por desenho; só features são verificadas.
      if (rec.cat) bad.push('holdout-com-features-divergentes');
    } else {
      const L = labelOf(rec);
      if (L.cls !== s.cls) bad.push('cls:' + s.cls + '->' + L.cls);
      if (!close(L.r, s.rf)) bad.push('r_fwd');
    }
  } else if (!s.cat) bad.push('válida-no-dataset-mas-inválida-na-recomputação');
  if (s.cat === 'warm-up') cover.warmupTrans++;
  if (bad.length) { leaked++; if (leakDetail.length < 10) leakDetail.push({ t: new Date(t).toISOString(), bad }); }
}
mdb.close();

if (CANARY) {
  const comparaveis = canaryFlagged + canaryIdentical;
  const pass = comparaveis > 0 && canarySusp === 0;
  console.log(JSON.stringify({
    modo: 'canary', amostra: sample.length, comparaveis, flagged: canaryFlagged,
    injecoes_inefetivas_preco_congelado: canaryIdentical, suspeitas: canarySusp,
    resultado: pass ? 'PASS (100% das injeções efetivas detectadas; idênticas = preço bit-igual)' : 'FAIL (violação NÃO detectada)',
  }));
  if (!pass) process.exit(1);
} else {
  console.log(JSON.stringify({
    modo: 'truncamento', amostra: sample.length, cobertura: cover,
    fronteiras_fold: 'N/A (geometria ainda não congelada)',
    verificadas: checked, divergencias: leaked,
    resultado: leaked === 0 ? 'PASS (sem vazamento)' : 'FAIL (VAZAMENTO)',
    detalhe: leakDetail,
  }));
  if (leaked !== 0) process.exit(1);
}
