// scripts/offline-analysis/whale-study.mjs
//
// ESTUDO HISTÓRICO DE WHALE EVENTS — análise offline, manual, somente leitura.
//
// Para cada whale event com magnitude >= --threshold, calcula RETROSPECTIVAMENTE o
// retorno observado do preço (snapshots) após 5, 15 e 30 minutos. Apresenta a
// distribuição histórica observada. Não prevê, não sinaliza, não recomenda.
//
// O limiar é OBRIGATÓRIO via CLI (`--threshold <valor>`) e nunca fica fixado no código.
// Preço-base: `events.price` quando >0; senão o snapshot mais próximo em t<=evento.
// Preço futuro: primeiro snapshot com t >= evento+janela (atraso real mediano reportado;
// eventos sem snapshot futuro são excluídos e contabilizados à parte).
//
// Uso manual: `node scripts/offline-analysis/whale-study.mjs --threshold <valor> [--db <path>] [--out <dir>] [--side all|buy|sell]`

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
function usage() {
  return 'Uso: node scripts/offline-analysis/whale-study.mjs --threshold <valor> [--db <path>] [--out <dir>] [--side all|buy|sell]';
}

if (process.argv.includes('--help')) {
  console.log(usage());
  process.exit(0);
}

const rawThreshold = arg('--threshold', null);
if (rawThreshold === null || rawThreshold === '') {
  console.error('ERRO: --threshold <valor> é obrigatório (limiar mínimo de magnitude do whale event).');
  console.error(usage());
  process.exit(2);
}
const THRESHOLD = Number(rawThreshold);
if (!Number.isFinite(THRESHOLD) || THRESHOLD <= 0) {
  console.error(`ERRO: --threshold inválido ("${rawThreshold}"). Informe um número positivo.`);
  process.exit(2);
}
const sideOpt = String(arg('--side', 'all')).toLowerCase();
if (!['all', 'buy', 'sell'].includes(sideOpt)) {
  console.error('ERRO: --side deve ser all, buy ou sell.');
  process.exit(2);
}

const dbPath = path.resolve(arg('--db', path.join(root, 'services', 'market-ingestion', 'data', 'market.db')));
const outDir = path.resolve(arg('--out', path.join(root, 'reports', 'offline-analysis')));

const WINDOWS_MIN = [5, 15, 30];
const DISCLAIMER = '**ESTUDO HISTÓRICO RETROSPECTIVO — NÃO CONSTITUI PREVISÃO, SINAL OU RECOMENDAÇÃO. Os resultados descrevem exclusivamente o que foi observado no período histórico analisado.**';

function iso(ms) { return new Date(ms).toISOString(); }
function fmtInt(n) { return Number(n).toLocaleString('pt-BR'); }
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function std(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
}
function pct(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}
function lowerBound(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < target) lo = m + 1; else hi = m; }
  return lo;
}
function upperBound(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= target) lo = m + 1; else hi = m; }
  return lo - 1;
}
function fmtPctRet(x) { return Number.isFinite(x) ? (x * 100).toFixed(4).replace('.', ',') + '%' : '—'; }
function stats(rets) {
  const pos = rets.filter((r) => r > 0).length;
  const neg = rets.filter((r) => r < 0).length;
  let mn = NaN, mx = NaN;
  for (const r of rets) {
    if (Number.isNaN(mn) || r < mn) mn = r;
    if (Number.isNaN(mx) || r > mx) mx = r;
  }
  return {
    n: rets.length, mean: mean(rets), median: median(rets), std: std(rets),
    min: mn, max: mx,
    p10: pct(rets, 0.1), p25: pct(rets, 0.25), p75: pct(rets, 0.75), p90: pct(rets, 0.9),
    pos, neg, zero: rets.length - pos - neg,
  };
}

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const snaps = db.prepare('SELECT timestamp, price FROM snapshots ORDER BY timestamp').all();
  const snapTs = snaps.map((s) => s.timestamp);
  const snapPx = snaps.map((s) => s.price);

  const typeFilter = sideOpt === 'buy' ? "AND event_type='whale_buy'" : sideOpt === 'sell' ? "AND event_type='whale_sell'" : '';
  const events = db.prepare(
    `SELECT timestamp, event_type, magnitude, price FROM events WHERE magnitude >= ? ${typeFilter} ORDER BY timestamp`,
  ).all(THRESHOLD);

  // Retornos por janela (geral + por lado).
  const buckets = new Map(); // key `${w}|${side}` -> {rets:[], delays:[]}
  for (const w of WINDOWS_MIN) for (const s of ['all', 'buy', 'sell']) buckets.set(`${w}|${s}`, { rets: [], delays: [] });
  let noBase = 0;
  const noFuture = new Map(WINDOWS_MIN.map((w) => [w, 0]));
  let minEv = null, maxEv = null;

  for (const e of events) {
    const side = e.event_type === 'whale_buy' ? 'buy' : 'sell';
    if (minEv === null || e.timestamp < minEv) minEv = e.timestamp;
    if (maxEv === null || e.timestamp > maxEv) maxEv = e.timestamp;
    let base = e.price > 0 ? e.price : null;
    if (base === null) {
      const i = upperBound(snapTs, e.timestamp);
      if (i < 0 || !(snapPx[i] > 0)) { noBase++; continue; }
      base = snapPx[i];
    }
    for (const w of WINDOWS_MIN) {
      const j = lowerBound(snapTs, e.timestamp + w * 60_000);
      if (j >= snapTs.length || !(snapPx[j] > 0)) { noFuture.set(w, noFuture.get(w) + 1); continue; }
      const r = (snapPx[j] - base) / base;
      buckets.get(`${w}|all`).rets.push(r);
      buckets.get(`${w}|${side}`).rets.push(r);
      const delay = (snapTs[j] - e.timestamp) / 60_000;
      buckets.get(`${w}|all`).delays.push(delay);
      buckets.get(`${w}|${side}`).delays.push(delay);
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const tag = `threshold-${String(rawThreshold).replace(/[^0-9a-zA-Z.+-]/g, '_')}${sideOpt === 'all' ? '' : '-' + sideOpt}`;
  const mdName = `whale-study-${tag}.md`;
  const csvName = `whale-study-${tag}-summary.csv`;

  const csv = ['threshold,window_min,side,n,mean_ret,median_ret,std_ret,p10_ret,p25_ret,p75_ret,p90_ret,min_ret,max_ret,pct_positive,pct_negative,median_delay_min'];
  const L = [];
  L.push('# Estudo histórico de whale events — distribuição retrospectiva observada');
  L.push('');
  L.push(DISCLAIMER);
  L.push('');
  L.push('> Pergunta respondida: **O que foi observado historicamente após esses eventos durante o período analisado?**');
  L.push('> Nada aqui é previsão, expectativa, probabilidade de acerto, sinal, recomendação ou regra de operação.');
  L.push('');
  L.push(`- Gerado em: ${iso(Date.now())}`);
  L.push(`- Banco: \`${dbPath}\` (aberto com \`readOnly: true\`)`);
  L.push(`- Limiar de magnitude (via \`--threshold\`, não fixado no código): **${rawThreshold}**`);
  L.push(`- Filtro de lado (\`--side\`): **${sideOpt}**`);
  L.push(`- Eventos com magnitude >= limiar: ${fmtInt(events.length)}${minEv !== null ? ` (${iso(minEv)} → ${iso(maxEv)})` : ''}`);
  L.push(`- Eventos sem preço-base (excluídos): ${fmtInt(noBase)}`);
  for (const w of WINDOWS_MIN) L.push(`- Janela +${w} min — sem snapshot futuro (excluídos): ${fmtInt(noFuture.get(w))}`);
  L.push('- Método: preço-base = `events.price` (>0) ou snapshot em t<=evento; preço futuro = primeiro snapshot em t>=evento+janela. Retorno = (futuro−base)/base.');
  L.push('');

  for (const w of WINDOWS_MIN) {
    L.push(`## Janela +${w} minutos`);
    L.push('');
    L.push('| Grupo | Casos | Média | Mediana | Desvio | p10 | p25 | p75 | p90 | Mín | Máx | % positivos | % negativos | Atraso mediano (min) |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of (sideOpt === 'all' ? ['all', 'buy', 'sell'] : [sideOpt])) {
      const b = buckets.get(`${w}|${s}`);
      const st = stats(b.rets);
      const label = s === 'all' ? 'todos' : s === 'buy' ? 'whale_buy' : 'whale_sell';
      if (!st.n) {
        L.push(`| ${label} | 0 | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | — |`);
      } else {
        L.push(`| ${label} | ${fmtInt(st.n)} | ${fmtPctRet(st.mean)} | ${fmtPctRet(st.median)} | ${fmtPctRet(st.std)} | ` +
          `${fmtPctRet(st.p10)} | ${fmtPctRet(st.p25)} | ${fmtPctRet(st.p75)} | ${fmtPctRet(st.p90)} | ` +
          `${fmtPctRet(st.min)} | ${fmtPctRet(st.max)} | ${(st.pos / st.n * 100).toFixed(1).replace('.', ',')}% | ` +
          `${(st.neg / st.n * 100).toFixed(1).replace('.', ',')}% | ${median(b.delays).toFixed(1).replace('.', ',')} |`);
      }
      csv.push([rawThreshold, w, label, stats(b.rets).n,
        ...['mean', 'median', 'std', 'p10', 'p25', 'p75', 'p90', 'min', 'max'].map((k) => {
          const v = stats(b.rets)[k]; return Number.isFinite(v) ? v.toFixed(8) : '';
        }),
        b.rets.length ? (stats(b.rets).pos / b.rets.length).toFixed(4) : '',
        b.rets.length ? (stats(b.rets).neg / b.rets.length).toFixed(4) : '',
        b.delays.length ? median(b.delays).toFixed(2) : ''].join(','));
    }
    L.push('');
  }
  L.push('---');
  L.push(DISCLAIMER);
  L.push('');
  L.push('_Nenhum resultado deste estudo foi ou deve ser conectado ao produto ao vivo._');

  fs.writeFileSync(path.join(outDir, mdName), L.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, csvName), csv.join('\n') + '\n');
  console.log(`[whale-study] threshold=${rawThreshold} side=${sideOpt} events=${events.length} -> ${path.join(outDir, mdName)}`);
} finally {
  db.close();
}
