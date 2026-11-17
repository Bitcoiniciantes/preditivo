// scripts/offline-analysis/regime-report.mjs
//
// ESTATÍSTICA DESCRITIVA DOS REGIMES — análise offline, manual, somente leitura.
//
// Usa SOMENTE os `regime_events` já existentes. Não cria labels, não calibra nada,
// não gera regra operacional, sinal ou indicação futura. Saída puramente descritiva.
//
// Episódio de regime = intervalo entre um `regime_change` e o `regime_change` seguinte
// (o episódio ainda aberto no fim dos dados é excluído das durações e reportado à parte).
//
// Uso manual: `node scripts/offline-analysis/regime-report.mjs [--db <path>] [--out <dir>]`

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
  console.log('Uso: node scripts/offline-analysis/regime-report.mjs [--db <path>] [--out <dir>]');
  process.exit(0);
}

const dbPath = path.resolve(arg('--db', path.join(root, 'services', 'market-ingestion', 'data', 'market.db')));
const outDir = path.resolve(arg('--out', path.join(root, 'reports', 'offline-analysis')));

const MIN_FULL = 30; // episódios mínimos p/ percentis e distribuição de durações
const MIN_BASIC = 3; // episódios mínimos p/ média/mediana (abaixo: insuficiente)
const HOUR_BUCKETS = ['00–05', '06–11', '12–17', '18–23 (UTC)'];

function iso(ms) { return new Date(ms).toISOString(); }
function fmtInt(n) { return Number(n).toLocaleString('pt-BR'); }
function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function pct(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}
function f1(x) { return Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—'; }
function minOf(a) { let m = Infinity; for (const x of a) if (x < m) m = x; return a.length ? m : NaN; }
function maxOf(a) { let m = -Infinity; for (const x of a) if (x > m) m = x; return a.length ? m : NaN; }

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const total = db.prepare('SELECT COUNT(*) c FROM regime_events').get().c;
  const byType = db.prepare('SELECT event_type, COUNT(*) c FROM regime_events GROUP BY event_type ORDER BY c DESC').all();
  const byState = db.prepare('SELECT to_state, COUNT(*) c FROM regime_events GROUP BY to_state ORDER BY c DESC').all();
  const changes = db.prepare(
    "SELECT timestamp, from_state, to_state FROM regime_events WHERE event_type='regime_change' ORDER BY timestamp",
  ).all();

  // Episódios fechados: duração até a próxima mudança. Último fica aberto.
  const durationsByRegime = new Map(); // regime -> [min]
  const hourByRegime = new Map(); // regime -> [b0,b1,b2,b3] contagem de entradas
  const transitions = new Map(); // "from=>to" -> count
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const key = `${c.from_state ?? 'NULL'}=>${c.to_state}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    const h = new Date(c.timestamp).getUTCHours();
    const b = h < 6 ? 0 : h < 12 ? 1 : h < 18 ? 2 : 3;
    if (!hourByRegime.get(c.to_state)) hourByRegime.set(c.to_state, [0, 0, 0, 0]);
    hourByRegime.get(c.to_state)[b]++;
    if (i + 1 < changes.length) {
      const durMin = (changes[i + 1].timestamp - c.timestamp) / 60_000;
      if (!durationsByRegime.get(c.to_state)) durationsByRegime.set(c.to_state, []);
      durationsByRegime.get(c.to_state).push(durMin);
    }
  }
  const openEpisode = changes.length ? changes[changes.length - 1] : null;

  const states = [...new Set(changes.map((c) => c.to_state))].sort();
  const fromStates = [...new Set(changes.map((c) => c.from_state ?? 'NULL'))].sort();

  // Distribuição das durações em faixas (min).
  const BANDS = [['<1', 0, 1], ['1–5', 1, 5], ['5–15', 5, 15], ['15–60', 15, 60], ['>60', 60, Infinity]];

  fs.mkdirSync(outDir, { recursive: true });

  // CSV de episódios por regime.
  const epCsv = ['regime,episodes_closed,mean_min,median_min,min_min,max_min,p10_min,p90_min'];
  for (const s of states) {
    const d = durationsByRegime.get(s) ?? [];
    epCsv.push([s, d.length, d.length ? mean(d).toFixed(2) : '', d.length ? median(d).toFixed(2) : '',
      d.length ? minOf(d).toFixed(2) : '', d.length ? maxOf(d).toFixed(2) : '',
      d.length >= MIN_FULL ? pct(d, 0.1).toFixed(2) : '', d.length >= MIN_FULL ? pct(d, 0.9).toFixed(2) : ''].join(','));
  }
  fs.writeFileSync(path.join(outDir, 'regime-episodes.csv'), epCsv.join('\n') + '\n');

  // CSV da matriz de transições.
  const trCsv = ['from_state,to_state,count'];
  for (const f of fromStates) for (const t of states) {
    const n = transitions.get(`${f}=>${t}`) ?? 0;
    if (n) trCsv.push([f, t, n].join(','));
  }
  fs.writeFileSync(path.join(outDir, 'regime-transitions.csv'), trCsv.join('\n') + '\n');

  const L = [];
  L.push('# Estatística descritiva dos regimes — análise offline retrospectiva');
  L.push('');
  L.push('_Somente `regime_events` já existentes. Leitura em modo somente leitura; nada foi escrito ou alterado._');
  L.push('');
  L.push('_Saída puramente descritiva. Não constitui regra operacional, sinal ou indicação futura._');
  L.push('');
  L.push(`- Gerado em: ${iso(Date.now())}`);
  L.push(`- Banco: \`${dbPath}\` (aberto com \`readOnly: true\`)`);
  L.push(`- Total de regime_events: ${fmtInt(total)}; mudanças de regime (\`regime_change\`): ${fmtInt(changes.length)}`);
  if (openEpisode) L.push(`- Episódio ainda aberto ao fim dos dados: \`${openEpisode.to_state}\` desde ${iso(openEpisode.timestamp)} (excluído das durações)`);
  L.push(`- Regra de suficiência: percentis/distribuição de durações exigem ≥${MIN_FULL} episódios fechados; média/mediana exigem ≥${MIN_BASIC}. Caso contrário: **"Amostra insuficiente para esta análise."**`);
  L.push('');
  L.push('## Eventos por tipo');
  L.push('');
  L.push('| Tipo | Quantidade |');
  L.push('|---|---|');
  for (const r of byType) L.push(`| \`${r.event_type}\` | ${fmtInt(r.c)} |`);
  L.push('');
  L.push('## Ocorrências por estado destino (`to_state`, todos os tipos)');
  L.push('');
  L.push('| Estado | Ocorrências |');
  L.push('|---|---|');
  for (const r of byState) L.push(`| \`${r.to_state}\` | ${fmtInt(r.c)} |`);
  L.push('');
  L.push('## Episódios por regime (`regime_change`)');
  L.push('');
  L.push('| Regime | Episódios fechados | Duração média (min) | Mediana (min) | Mín (min) | Máx (min) | p10 (min) | p90 (min) |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const s of states) {
    const d = durationsByRegime.get(s) ?? [];
    if (d.length < MIN_BASIC) {
      L.push(`| \`${s}\` | ${d.length} | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. |`);
    } else {
      const full = d.length >= MIN_FULL;
      L.push(`| \`${s}\` | ${d.length} | ${f1(mean(d))} | ${f1(median(d))} | ${f1(minOf(d))} | ${f1(maxOf(d))} | ` +
        `${full ? f1(pct(d, 0.1)) : 'Amostra insuficiente para esta análise.'} | ${full ? f1(pct(d, 0.9)) : 'Amostra insuficiente para esta análise.'} |`);
    }
  }
  L.push('');
  L.push('Detalhes em `regime-episodes.csv`.');
  L.push('');
  L.push('## Distribuição das durações por faixa');
  L.push('');
  L.push('| Regime | <1 min | 1–5 min | 5–15 min | 15–60 min | >60 min |');
  L.push('|---|---|---|---|---|---|');
  for (const s of states) {
    const d = durationsByRegime.get(s) ?? [];
    if (d.length < MIN_FULL) {
      L.push(`| \`${s}\` | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. | Amostra insuficiente para esta análise. |`);
    } else {
      const counts = BANDS.map(([, lo, hi]) => d.filter((x) => x >= lo && x < hi).length);
      L.push(`| \`${s}\` | ${counts.join(' | ')} |`);
    }
  }
  L.push('');
  L.push('## Matriz de transições (`from_state` → `to_state`, contagens)');
  L.push('');
  L.push(`| De \\ Para | ${states.map((s) => `\`${s}\``).join(' | ')} |`);
  L.push(`|---|${states.map(() => '---').join('|')}|`);
  for (const f of fromStates) {
    L.push(`| \`${f}\` | ${states.map((t) => transitions.get(`${f}=>${t}`) ?? 0).join(' | ')} |`);
  }
  L.push('');
  L.push('Tabela completa (somente pares observados) em `regime-transitions.csv`.');
  L.push('');
  L.push('## Distribuição dos regimes por faixa horária (UTC, entradas em cada regime)');
  L.push('');
  L.push(`| Regime | ${HOUR_BUCKETS.join(' | ')} | Total |`);
  L.push('|---|---|---|---|---|---|');
  for (const s of states) {
    const h = hourByRegime.get(s) ?? [0, 0, 0, 0];
    L.push(`| \`${s}\` | ${h.join(' | ')} | ${h.reduce((a, b) => a + b, 0)} |`);
  }
  L.push('');
  L.push('---');
  L.push('_Relatório descritivo. Não transformar em regra operacional, sinal ou indicação futura._');

  fs.writeFileSync(path.join(outDir, 'regime-report.md'), L.join('\n') + '\n');
  console.log(`[regime-report] changes=${changes.length} states=${states.length} -> ${outDir}`);
} finally {
  db.close();
}
