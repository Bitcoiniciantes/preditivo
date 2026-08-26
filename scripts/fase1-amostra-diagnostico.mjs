// scripts/fase1-amostra-diagnostico.mjs
// AUDITORIA DO FLUXO DE AMOSTRA do desenho congelado da Fase 1.
//
// Este script NÃO é o experimento: ele apenas REPLICA a contagem do fluxo de observações
// (mesmos parâmetros e mesma lógica de scripts/fase1-experimento-minimo.mjs, que permanece
// congelado e intocado) para responder com precisão:
//
//   N bruto → (stride) → candidatos → (janela íntegra) → (outcome) → N elegível
//            → (purging + embargo) → treino + OOS + excluídos
//
// Assim, ninguém interpreta "290" como sendo necessariamente "202 + 82": a diferença são
// as observações elegíveis excluídas pelo split (purging/embargo).
//
// Uso: node scripts/fase1-amostra-diagnostico.mjs
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const db = new DatabaseSync(path.join(root, 'services', 'market-ingestion', 'data', 'market.db'), { readOnly: true });

// ── Parâmetros idênticos ao experimento congelado (fonte única: fase1-experimento-minimo.mjs) ──
const FEATURE_WINDOW_MIN = 15;
const HORIZONS = [5, 15, 30];
const H_MAX = 30;                  // maior horizonte (embargo)
const OUTCOME_TOLERANCE_MS = 150_000;
const WINDOW_MIN_SNAPS = 10;
const GAP_BREAK_MS = 180_000;
const TRAIN_FRACTION = 0.7;

const snaps = db.prepare(
  'SELECT timestamp t, price p, cvd, cvd_large, oi, oi_change, book_imbalance, score, regime FROM snapshots ORDER BY timestamp'
).all();

function audit(h) {
  const s = {
    bruto: snaps.length,
    strideSkip: 0,
    candidatos: 0,
    janelaCurta: 0,
    janelaGap: 0,
    outcomeSegmento: 0,
    outcomeSemSnapshot: 0,
    outcomeTolerancia: 0,
    elegiveis: 0,
  };
  const obs = [];
  let lastAnchor = -Infinity;

  for (let i = 0; i < snaps.length; i++) {
    const t = snaps[i].t;
    if (t - lastAnchor < h * 60_000) { s.strideSkip++; continue; }
    s.candidatos++;

    // Janela de features [t-15m, t]
    const win = [];
    let ok = true;
    for (let j = i; j >= 0; j--) {
      if (snaps[j].t < t - FEATURE_WINDOW_MIN * 60_000) break;
      if (win.length > 0 && snaps[j + 1].t - snaps[j].t > GAP_BREAK_MS) { ok = false; break; }
      win.unshift(snaps[j]);
    }
    if (!ok) { s.janelaGap++; continue; }
    if (win.length < WINDOW_MIN_SNAPS) { s.janelaCurta++; continue; }

    // Outcome em t+h (mesmo segmento, tolerância ±2.5 min)
    const target = t + h * 60_000;
    let outcome = null;
    let brokeOnGap = false;
    for (let k = i; k < snaps.length; k++) {
      if (k > i && snaps[k].t - snaps[k - 1].t > GAP_BREAK_MS) { brokeOnGap = true; break; }
      if (snaps[k].t >= target - OUTCOME_TOLERANCE_MS) {
        outcome = snaps[k];
        if (k > i && Math.abs(snaps[k].t - target) > Math.abs(snaps[k - 1].t - target)) outcome = snaps[k - 1];
        break;
      }
    }
    if (!outcome) {
      if (brokeOnGap) s.outcomeSegmento++; else s.outcomeSemSnapshot++;
      continue;
    }
    if (Math.abs(outcome.t - target) > OUTCOME_TOLERANCE_MS) { s.outcomeTolerancia++; continue; }

    lastAnchor = t;
    s.elegiveis++;
    obs.push({ t });
  }

  // Split (mesma lógica do experimento congelado)
  const times = obs.map(o => o.t).sort((a, b) => a - b);
  const B = times[Math.floor((times.length - 1) * TRAIN_FRACTION)];
  const treino = obs.filter(o => o.t + h * 60_000 <= B);
  const oos = obs.filter(o => o.t >= B + H_MAX * 60_000);
  const excluidos = obs.filter(o => !(o.t + h * 60_000 <= B) && !(o.t >= B + H_MAX * 60_000));
  // Por construção, todo obs excluído satisfaz AMBOS os critérios: t+h > B (outcome cruza a
  // fronteira) E t < B + H_MAX (cai no embargo) — a faixa do meio é a conjunção dos dois.
  const exclTodosCruzam = excluidos.every(o => o.t + h * 60_000 > B);
  const exclTodosEmbargo = excluidos.every(o => o.t < B + H_MAX * 60_000);
  return {
    h, ...s,
    treino: treino.length, oos: oos.length,
    excluidos: excluidos.length,
    exclTodosCruzam, exclTodosEmbargo,
    B: new Date(B).toISOString(),
  };
}

// ── Saída ──
const lines = [];
const log = (x = '') => { console.log(x); lines.push(x); };

log('# FASE 1 — DIAGNÓSTICO DO FLUXO DE AMOSTRA (gerado por scripts/fase1-amostra-diagnostico.mjs)');
log('');
log(`Gerado em: ${new Date().toISOString()}`);
log('');
log('Fluxo: **N bruto** (snapshots) → excluídos por **stride** → **candidatos** → excluídos por **janela** (gap/curta) → excluídos por **outcome** (segmento/sem snapshot/tolerância) → **N elegível** → excluídos pelo **split** (purging/embargo) → **treino + OOS**.');
log('');
log('| Horizonte | N bruto | stride | candidatos | janela gap | janela curta | outcome segmento | outcome sem snap | outcome tol. | **N elegível** | treino | **OOS** | excluídos split |');
log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const h of HORIZONS) {
  const a = audit(h);
  log(`| ${h} min | ${a.bruto} | ${a.strideSkip} | ${a.candidatos} | ${a.janelaGap} | ${a.janelaCurta} | ${a.outcomeSegmento} | ${a.outcomeSemSnapshot} | ${a.outcomeTolerancia} | **${a.elegiveis}** | ${a.treino} | **${a.oos}** | ${a.excluidos} |`);
}
log('');
log('Verificações aritméticas (devem ser verdadeiras):');
for (const h of HORIZONS) {
  const a = audit(h);
  const v1 = a.bruto === a.strideSkip + a.candidatos;
  const v2 = a.candidatos === a.janelaGap + a.janelaCurta + a.outcomeSegmento + a.outcomeSemSnapshot + a.outcomeTolerancia + a.elegiveis;
  const v3 = a.elegiveis === a.treino + a.oos + a.excluidos;
  log(`- ${h} min: bruto = stride+candidatos (${v1 ? 'OK' : 'FALHOU'}) · candidatos = rejeições+elegíveis (${v2 ? 'OK' : 'FALHOU'}) · elegíveis = treino+OOS+excluídos (${v3 ? 'OK' : 'FALHOU'})`);
}
log('');
log('Detalhe dos excluídos do split (faixa do meio — por construção satisfazem os dois critérios):');
log('');
log('| Horizonte | fronteira B (UTC) | excluídos split | todos cruzam a fronteira (t+h > B)? | todos no embargo (B ≤ t < B+H_MAX)? |');
log('|---|---:|---:|---|---|');
for (const h of HORIZONS) {
  const a = audit(h);
  log(`| ${h} min | ${a.B} | ${a.excluidos} | ${a.exclTodosCruzam ? 'sim' : 'não'} | ${a.exclTodosEmbargo ? 'sim' : 'não'} |`);
}
log('');
log('Definições:');
log('- **N bruto**: total de snapshots no SQLite (base única para todos os horizontes).');
log('- **stride**: âncoras descartadas por estarem a menos de h min da âncora aceita anterior (janelas de outcome sem sobreposição).');
log('- **janela gap**: janela [t-15m, t] cruza um gap > 3 min (daemon offline) — janela rejeitada.');
log('- **janela curta**: janela com < 10 snapshots.');
log('- **outcome segmento**: sem snapshot de outcome porque o segmento quebrou (gap) antes de t+h.');
log('- **outcome sem snap**: sem snapshot dentro de ±2.5 min de t+h.');
log('- **outcome tol.**: snapshot encontrado, mas fora da tolerância de ±2.5 min.');
log('- **N elegível**: observações que entram no experimento (== "Observações" do relatório da Fase 1).');
log('- **treino**: elegíveis com t+h ≤ B (purging).');
log('- **OOS**: elegíveis com t ≥ B + 30 min (embargo = maior horizonte).');
log('- **excluídos split**: elegíveis que não são nem treino nem OOS (outcome cruza a fronteira e/ou caem no embargo).');

const outPath = path.join(root, 'FASE1_AMOSTRA_DIAGNOSTICO.md');
fs.writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`\nRelatório salvo em: ${outPath}`);
db.close();
