// scripts/predictive-v1-build.mjs — PASSO 2 / FASE A (wrapper fino)
// Constrói data/predictive_v1.db a partir de market.db (EXCLUSIVAMENTE mode=ro).
// Cálculo em scripts/predictive-v1-core.mjs (mesmo núcleo do harness de truncamento).
// Regras: PRODUTO_PREDITIVO_V1_3_1_ESPECIFICACAO_EXECUTAVEL.md (V1.3.1).
// NÃO treina, NÃO avalia OOS, NÃO abre holdout (rótulos só pré-holdout), NÃO congela parâmetros.
// Uso: node scripts/predictive-v1-build.mjs
//   PREDV1_TPOOL_END=<ms> fixa T_pool_end (reprodutibilidade); default = MAX(timestamp).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SPEC, computeAll, labelOf } from './predictive-v1-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const MARKET = path.join(root, 'services', 'market-ingestion', 'data', 'market.db');
const OUTDIR = path.join(root, 'data');
const OUT = path.join(OUTDIR, 'predictive_v1.db');

const CUT = Date.parse('2026-08-26T12:58:00Z');
const HOLDOUT_FRAC = 0.15;
const REF_SLICE = 350;

const mdb = new DatabaseSync(MARKET, { readOnly: true });
const T_pool_end = process.env.PREDV1_TPOOL_END
  ? Number(process.env.PREDV1_TPOOL_END)
  : mdb.prepare('SELECT MAX(timestamp) AS mx FROM snapshots').get().mx;
const marketCounts = {
  snapshots: mdb.prepare('SELECT COUNT(*) AS c FROM snapshots').get().c,
  events: mdb.prepare('SELECT COUNT(*) AS c FROM events').get().c,
};

const R = mdb.prepare(
  'SELECT id, timestamp AS t, price AS p, oi AS o, book_imbalance AS b, cvd AS c, cvd_large AS w, funding_rate AS f ' +
  'FROM snapshots WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp, id'
).all(CUT - 6 * 3600000, T_pool_end);

const { anchors, gaps, resets } = computeAll(R, {
  cut: CUT, featCap: T_pool_end, labelCap: T_pool_end, anchorMaxT: T_pool_end,
});

const validIdx = [];
for (let i = 0; i < anchors.length; i++) if (!anchors[i].cat) validIdx.push(i);
const Nv = validIdx.length;
const Nh = Math.floor(HOLDOUT_FRAC * Nv);
const holdoutStart = Nh > 0 ? anchors[validIdx[Nv - Nh]].t : Infinity;

const refCount = { UP: 0, RANGE: 0, DOWN: 0 };
{
  let c = 0;
  for (const i of validIdx) {
    if (c >= REF_SLICE) break;
    refCount[labelOf(anchors[i]).cls]++;
    c++;
  }
}

fs.mkdirSync(OUTDIR, { recursive: true });
try { fs.unlinkSync(OUT); } catch { /* primeira construção */ }
const out = new DatabaseSync(OUT);
out.exec('CREATE TABLE anchors (anchor_t INTEGER PRIMARY KEY, valid INTEGER NOT NULL, discard_reason TEXT, in_holdout INTEGER NOT NULL, vol_proxy REAL, frozen_price INTEGER NOT NULL, frozen_oi INTEGER NOT NULL)');
out.exec('CREATE TABLE features (anchor_t INTEGER PRIMARY KEY, P_t REAL, P_t_15m REAL, r_back_15m REAL, book_imbalance REAL, cvd_d5 REAL, cvd_med REAL, cvd_mad REAL, cvd_scale REAL, cvd_z REAL, whale_d5 REAL, whale_med REAL, whale_mad REAL, whale_scale REAL, whale_z REAL, doi_d5 REAL, doi_med REAL, doi_mad REAL, doi_scale REAL, doi_z REAL, sigma_H REAL, funding_rate REAL)');
out.exec('CREATE TABLE labels (anchor_t INTEGER PRIMARY KEY, r_fwd_15m REAL, class TEXT)');
out.exec('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)');
const insA = out.prepare('INSERT INTO anchors VALUES (?,?,?,?,?,?,?)');
const insF = out.prepare('INSERT INTO features VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insL = out.prepare('INSERT INTO labels VALUES (?,?,?)');
out.prepare('BEGIN').run();
for (let i = 0; i < anchors.length; i++) {
  const a = anchors[i];
  const inH = !a.cat && a.t >= holdoutStart ? 1 : 0;
  insA.run(a.t, a.cat ? 0 : 1, a.cat, inH, a.px >= 0 ? a.px : null, a.priceFrozen ? 1 : 0, a.oiFrozen ? 1 : 0);
  if (!a.cat && a.feat) {
    const f = a.feat;
    insF.run(a.t, f.Pt, f.P15, f.r_back_15m, f.imb, f.cd, f.cm, f.cmad, f.cs, f.cz,
      f.wd, f.wm, f.wmad, f.ws, f.wz, f.od, f.om, f.omad, f.os, f.oz, f.sig, f.fund);
    if (!inH) {
      const L = labelOf(a);
      insL.run(a.t, L.r, L.cls);
    } else {
      insL.run(a.t, null, null); // holdout selado: sem rótulo
    }
  }
}
const piMin = Math.min(refCount.UP, refCount.RANGE, refCount.DOWN) / REF_SLICE;
const metaRows = {
  spec_version: SPEC.version,
  T_pool_start: String(CUT),
  T_pool_end: String(T_pool_end),
  n_anchors: String(anchors.length),
  n_valid: String(Nv),
  n_holdout: String(Nh),
  holdout_start: Nh > 0 ? String(holdoutStart) : 'none',
  pi_min_ref: String(piMin),
  ref_slice: String(REF_SLICE),
  builder: 'scripts/predictive-v1-build.mjs+predictive-v1-core.mjs',
};
for (const k of Object.keys(metaRows)) out.prepare('INSERT INTO meta VALUES (?,?)').run(k, metaRows[k]);
out.prepare('COMMIT').run();

function canonHash() {
  const h = crypto.createHash('sha256');
  const srows = mdb.prepare(
    'SELECT id,timestamp,symbol,price,oi,oi_change,funding_rate,cvd,cvd_large,book_imbalance,score,regime,created_at ' +
    'FROM snapshots WHERE timestamp <= ? ORDER BY id').all(T_pool_end);
  for (const r of srows) h.update(JSON.stringify([r.id, r.timestamp, r.symbol, r.price, r.oi, r.oi_change, r.funding_rate, r.cvd, r.cvd_large, r.book_imbalance, r.score, r.regime, r.created_at]) + '\n');
  const erows = mdb.prepare(
    'SELECT id,timestamp,symbol,event_type,magnitude,price,direction,details,trade_id,created_at ' +
    'FROM events WHERE timestamp <= ? ORDER BY id').all(T_pool_end);
  for (const r of erows) h.update(JSON.stringify([r.id, r.timestamp, r.symbol, r.event_type, r.magnitude, r.price, r.direction, r.details, r.trade_id, r.created_at]) + '\n');
  return { hex: h.digest('hex'), sN: srows.length, eN: erows.length };
}
const h1 = canonHash();
const h2 = canonHash();
if (h1.hex !== h2.hex) { console.error(JSON.stringify({ error: 'HASH_MISMATCH', h1, h2 })); process.exit(1); }
out.prepare('INSERT INTO meta VALUES (?,?)').run('range_hash_sha256', h1.hex);
out.prepare('INSERT INTO meta VALUES (?,?)').run('range_hash_rows', h1.sN + '+' + h1.eN);
out.close();
mdb.close();

const desc = {};
for (const a of anchors) if (a.cat) desc[a.cat] = (desc[a.cat] || 0) + 1;
const pv = anchors.filter((a) => a.px >= 0).map((a) => a.px).sort((x, y) => x - y);
const q3 = pv[Math.floor(pv.length * 0.75)];
let tg = 0, tgd = 0;
for (const a of anchors) if (a.px >= 0 && a.px >= q3) { tg++; if (a.cat) tgd++; }
console.log(JSON.stringify({
  T_pool_end, tPoolEndISO: new Date(T_pool_end).toISOString(),
  marketCounts, nBruto: anchors.length, nValido: Nv, pctValido: Nv / anchors.length,
  discards: desc, nHoldout: Nh, holdoutStartISO: Nh > 0 ? new Date(holdoutStart).toISOString() : null,
  refSlice: refCount, piMin,
  nTrainInitial: Math.ceil(20 * 12 / piMin),
  rangeHash: h1.hex, rangeRows: h1.sN + '+' + h1.eN, hashEqual: true,
  quartile: { q3, topRate: tgd / tg, globalRate: (anchors.length - Nv) / anchors.length },
  resets, gaps,
  outDb: OUT,
}));
