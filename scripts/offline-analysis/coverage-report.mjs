// scripts/offline-analysis/coverage-report.mjs
//
// RELATÓRIO DE COBERTURA E QUALIDADE DO market.db — análise offline, manual, somente leitura.
//
// O QUE FAZ: abre o SQLite em modo readOnly, consolida período coberto, horas efetivas,
// snapshots, segmentos, gaps >3min, cobertura das fontes (WS/preço, OI, Funding), whale
// events e distribuição temporal, e escreve Markdown + CSVs em reports/offline-analysis/.
//
// O QUE NÃO FAZ: nenhuma escrita no banco, nenhuma alteração de schema/parâmetros,
// nenhum cálculo preditivo, nenhuma conexão com dashboard/Indicador Único.
// Uso manual: `node scripts/offline-analysis/coverage-report.mjs [--db <path>] [--out <dir>]`

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.argv.includes('--help')) {
  console.log('Uso: node scripts/offline-analysis/coverage-report.mjs [--db <path>] [--out <dir>]');
  process.exit(0);
}

const dbPath = path.resolve(arg('--db', path.join(root, 'services', 'market-ingestion', 'data', 'market.db')));
const outDir = path.resolve(arg('--out', path.join(root, 'reports', 'offline-analysis')));

const GAP_MS = 3 * 60_000;
const DAY_MS = 24 * 3_600_000;
const EXPECTED_PER_DAY = 1440; // cadência nominal de 1 snapshot/min

function iso(ms) { return new Date(ms).toISOString(); }
function fmtInt(n) { return Number(n).toLocaleString('pt-BR'); }
function fmtPct(x) { return (x * 100).toFixed(1).replace('.', ',') + '%'; }

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const snap = db.prepare('SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM snapshots').get();
  const ev = db.prepare('SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM events').get();
  const evByType = db.prepare('SELECT event_type, COUNT(*) c FROM events GROUP BY event_type ORDER BY c DESC').all();
  const reg = db.prepare('SELECT COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx FROM regime_events').get();
  const regByType = db.prepare('SELECT event_type, COUNT(*) c FROM regime_events GROUP BY event_type ORDER BY c DESC').all();

  // Cobertura das fontes: colunas de snapshot alimentadas por WS (price/cvd/book),
  // OI (oi/oi_change) e Funding (funding_rate). Leitura de não-nulos — sem inferência.
  const sources = {};
  for (const col of ['price', 'oi', 'oi_change', 'funding_rate', 'cvd', 'cvd_large', 'book_imbalance']) {
    sources[col] = db.prepare(`SELECT COUNT(*) total, COUNT("${col}") nonnull FROM snapshots`).get();
  }

  const snapTs = db.prepare('SELECT timestamp FROM snapshots ORDER BY timestamp').all().map((r) => r.timestamp);

  // Gaps >3min e segmentos contínuos.
  const gaps = [];
  for (let i = 1; i < snapTs.length; i++) {
    const d = snapTs[i] - snapTs[i - 1];
    if (d > GAP_MS) gaps.push({ start: snapTs[i - 1], end: snapTs[i], ms: d });
  }
  gaps.sort((a, b) => b.ms - a.ms);
  const segments = snapTs.length ? gaps.length + 1 : 0;

  const spanH = snapTs.length ? (snapTs[snapTs.length - 1] - snapTs[0]) / 3_600_000 : 0;
  const effectiveH = snapTs.length / 60;

  const daily = db.prepare(
    "SELECT date(timestamp/1000,'unixepoch') d, COUNT(*) c, MIN(timestamp) mn, MAX(timestamp) mx " +
    'FROM snapshots GROUP BY d ORDER BY d',
  ).all();
  const evDaily = new Map(
    db.prepare("SELECT date(timestamp/1000,'unixepoch') d, COUNT(*) c FROM events GROUP BY d").all()
      .map((r) => [r.d, r.c]),
  );
  const regDaily = new Map(
    db.prepare("SELECT date(timestamp/1000,'unixepoch') d, COUNT(*) c FROM regime_events WHERE event_type='regime_change' GROUP BY d").all()
      .map((r) => [r.d, r.c]),
  );
  const evHour = db.prepare(
    "SELECT CAST(strftime('%H', timestamp/1000,'unixepoch') AS INTEGER) h, COUNT(*) c FROM events GROUP BY h ORDER BY h",
  ).all();

  // Magnitude dos whale events (descritivo simples via offsets ordenados).
  const mag = db.prepare('SELECT COUNT(*) n, MIN(magnitude) mn, MAX(magnitude) mx, AVG(magnitude) avg FROM events').get();
  const pct = {};
  if (mag.n > 0) {
    for (const q of [0.5, 0.9, 0.95, 0.99]) {
      pct['p' + Math.round(q * 100)] = db.prepare('SELECT magnitude v FROM events ORDER BY magnitude LIMIT 1 OFFSET ?')
        .get(Math.min(mag.n - 1, Math.floor(mag.n * q))).v;
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  // CSV diário.
  const dailyCsv = ['day,snapshots,coverage_pct_1440,whale_events,regime_changes,span_start_utc,span_end_utc'];
  for (const d of daily) {
    dailyCsv.push([d.d, d.c, (d.c / EXPECTED_PER_DAY * 100).toFixed(1),
      evDaily.get(d.d) ?? 0, regDaily.get(d.d) ?? 0, iso(d.mn), iso(d.mx)].join(','));
  }
  fs.writeFileSync(path.join(outDir, 'coverage-daily.csv'), dailyCsv.join('\n') + '\n');

  // CSV de gaps.
  const gapsCsv = ['gap_start_utc,gap_end_utc,duration_min'];
  for (const g of gaps) gapsCsv.push([iso(g.start), iso(g.end), (g.ms / 60_000).toFixed(1)].join(','));
  fs.writeFileSync(path.join(outDir, 'coverage-gaps.csv'), gapsCsv.join('\n') + '\n');

  const lowDays = daily.filter((d) => d.c < EXPECTED_PER_DAY * 0.5);
  const totalGapMin = gaps.reduce((a, g) => a + g.ms, 0) / 60_000;

  const L = [];
  L.push('# Cobertura e qualidade do market.db — relatório estático offline');
  L.push('');
  L.push('_Análise retrospectiva e descritiva. Leitura em modo somente leitura; nenhum dado foi escrito ou alterado._');
  L.push('');
  L.push('_Este relatório NÃO classifica o dataset como preditivamente confiável._');
  L.push('');
  L.push(`- Gerado em: ${iso(Date.now())}`);
  L.push(`- Banco: \`${dbPath}\` (aberto com \`readOnly: true\`)`);
  L.push('');
  L.push('## Resumo');
  L.push('');
  L.push(`- Período total coberto (snapshots): ${snap.mn ? iso(snap.mn) : '—'} → ${snap.mx ? iso(snap.mx) : '—'}`);
  L.push(`- Extensão do período: ${spanH.toFixed(1)} h (${(spanH / 24).toFixed(1)} dias)`);
  L.push(`- Total de snapshots: ${fmtInt(snap.c)}`);
  L.push(`- Horas efetivas (≈ snapshots/60): ${effectiveH.toFixed(1)} h`);
  L.push(`- Segmentos contínuos: ${segments} (= gaps + 1)`);
  L.push(`- Gaps >3 min: ${fmtInt(gaps.length)} (duração somada: ${fmtInt(Math.round(totalGapMin))} min)`);
  L.push(`- Whale events: ${fmtInt(ev.c)}${ev.mn ? ` (${iso(ev.mn)} → ${iso(ev.mx)})` : ''}`);
  L.push(`- Regime events: ${fmtInt(reg.c)}${reg.mn ? ` (${iso(reg.mn)} → ${iso(reg.mx)})` : ''}`);
  L.push('');
  L.push('## Cobertura das fontes (snapshots)');
  L.push('');
  L.push('Colunas alimentadas por cada fonte. Contagem de valores não-nulos sobre o total de snapshots — sem inferência de qualidade preditiva.');
  L.push('');
  L.push('| Fonte | Coluna | Não-nulos | Total | Cobertura |');
  L.push('|---|---|---|---|---|');
  const srcMap = [['WS (preço/livro)', 'price'], ['WS (CVD)', 'cvd'], ['WS (CVD grandes)', 'cvd_large'],
    ['WS (book imbalance)', 'book_imbalance'], ['OI', 'oi'], ['OI (variação)', 'oi_change'], ['Funding', 'funding_rate']];
  for (const [fonte, col] of srcMap) {
    const s = sources[col];
    L.push(`| ${fonte} | \`${col}\` | ${fmtInt(s.nonnull)} | ${fmtInt(s.total)} | ${fmtPct(s.total ? s.nonnull / s.total : 0)} |`);
  }
  L.push('');
  L.push('## Gaps >3 minutos');
  L.push('');
  L.push(`Quantidade: **${fmtInt(gaps.length)}**. Duração somada: **${fmtInt(Math.round(totalGapMin))} min**. Lista completa em \`coverage-gaps.csv\`. Maiores gaps:`);
  L.push('');
  L.push('| Início (UTC) | Fim (UTC) | Duração (min) |');
  L.push('|---|---|---|');
  for (const g of gaps.slice(0, 15)) {
    L.push(`| ${iso(g.start)} | ${iso(g.end)} | ${(g.ms / 60_000).toFixed(1)} |`);
  }
  L.push('');
  L.push('## Cobertura por dia');
  L.push('');
  L.push(`Referência nominal: ${EXPECTED_PER_DAY} snapshots/dia (1/min). Tabela completa em \`coverage-daily.csv\`.`); 
  L.push('');
  L.push('| Dia (UTC) | Snapshots | Cobertura | Whale events | Mudanças de regime |');
  L.push('|---|---|---|---|---|');
  for (const d of daily) {
    L.push(`| ${d.d} | ${fmtInt(d.c)} | ${fmtPct(d.c / EXPECTED_PER_DAY)} | ${fmtInt(evDaily.get(d.d) ?? 0)} | ${fmtInt(regDaily.get(d.d) ?? 0)} |`);
  }
  L.push('');
  L.push('## Principais períodos de perda ou baixa cobertura');
  L.push('');
  if (lowDays.length === 0) {
    L.push('Nenhum dia com cobertura abaixo de 50% do nominal (720 snapshots/dia). Verificar os maiores gaps acima para perdas concentradas em janelas curtas.');
  } else {
    L.push('Dias com menos de 50% do nominal:');
    L.push('');
    L.push('| Dia (UTC) | Snapshots | Cobertura |');
    L.push('|---|---|---|');
    for (const d of lowDays) L.push(`| ${d.d} | ${fmtInt(d.c)} | ${fmtPct(d.c / EXPECTED_PER_DAY)} |`);
  }
  L.push('');
  L.push('## Whale events — distribuição temporal');
  L.push('');
  L.push('| Tipo | Quantidade |');
  L.push('|---|---|');
  for (const r of evByType) L.push(`| \`${r.event_type}\` | ${fmtInt(r.c)} |`);
  L.push('');
  L.push(`Magnitude (USDT nocional aprox.): mín ${mag.mn?.toFixed(0)}, média ${mag.avg?.toFixed(0)}, ` +
    `p50 ${pct.p50?.toFixed(0)}, p90 ${pct.p90?.toFixed(0)}, p95 ${pct.p95?.toFixed(0)}, p99 ${pct.p99?.toFixed(0)}, máx ${mag.mx?.toFixed(0)}.`);
  L.push('');
  L.push('Distribuição por faixa horária (UTC):');
  L.push('');
  L.push('| Hora (UTC) | Eventos |');
  L.push('|---|---|');
  for (const r of evHour) L.push(`| ${String(r.h).padStart(2, '0')} | ${fmtInt(r.c)} |`);
  L.push('');
  L.push('Por dia, ver coluna `whale_events` da tabela diária e `coverage-daily.csv`.');
  L.push('');
  L.push('## Regime events por tipo');
  L.push('');
  L.push('| Tipo | Quantidade |');
  L.push('|---|---|');
  for (const r of regByType) L.push(`| \`${r.event_type}\` | ${fmtInt(r.c)} |`);
  L.push('');
  L.push('---');
  L.push('_Relatório descritivo. Não constitui avaliação de confiabilidade preditiva, sinal ou recomendação._');

  fs.writeFileSync(path.join(outDir, 'coverage-report.md'), L.join('\n') + '\n');
  console.log(`[coverage-report] snapshots=${snap.c} gaps3min=${gaps.length} segments=${segments} whale=${ev.c} -> ${outDir}`);
} finally {
  db.close();
}
