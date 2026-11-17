// tests/long-short.test.mjs
// Long/Short Account Ratio — throttle 60s, fetchedAt só em sucesso,
// preservação total em falha, percentuais crus da API.
// Roda contra o build: `npm run build` (tsc) antes.
//   node tests/long-short.test.mjs
// Determinístico — sem rede (fetcher injetado), sem Math.random.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist');
const mod = await import(pathToFileURL(path.join(dist, 'derivatives', 'long-short.js')).href);
const { pollLongShortAccountRatios, getLongShortState, reset, LONG_SHORT_PERIODS } = mod;

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ok - ${msg}`); }
  else { failed++; console.log(`  FALHOU - ${msg}`); }
}

const okFetch = async (period) => ({ ratio: 1.27, longAccount: 0.5595, shortAccount: 0.4405, timestamp: 1_700_000_000_000 });

// 1. Seis períodos cacheados após poll válido
reset();
let calls = 0;
await pollLongShortAccountRatios(1_000_000, async (p) => { calls++; return okFetch(p); });
const s1 = getLongShortState();
assert(calls === 6, `poll válido consulta os 6 períodos (chamadas=${calls})`);
assert(LONG_SHORT_PERIODS.join(',') === '5m,15m,30m,1h,4h,1d', 'períodos = 5m/15m/30m/1h/4h/1d (sem 2h/6h/12h)');
for (const p of LONG_SHORT_PERIODS) {
  const s = s1[p];
  assert(s !== null && s.ratio === 1.27 && s.period === p, `${p} cacheado com ratio e period`);
  assert(s !== null && s.longPct === 0.5595 && s.shortPct === 0.4405, `${p} percentuais crus da API (não recalculados do ratio)`);
  assert(s !== null && s.updatedAt === 1_700_000_000_000, `${p} updatedAt = timestamp do bucket`);
  assert(s !== null && s.fetchedAt === 1_000_000, `${p} fetchedAt = momento da coleta válida`);
}

// 2. Throttle: sem nova consulta antes de 60s; permite após 60s
calls = 0;
await pollLongShortAccountRatios(1_000_000 + 59_999, async (p) => { calls++; return okFetch(p); });
assert(calls === 0, 'nenhuma consulta antes de 60s');
await pollLongShortAccountRatios(1_000_000 + 60_000, async (p) => { calls++; return okFetch(p); });
assert(calls === 6, 'nova consulta após 60s');

// 3. Falha: preserva valor, updatedAt e fetchedAt (nunca zero/null)
reset();
await pollLongShortAccountRatios(2_000_000, okFetch);
const before = JSON.stringify(getLongShortState());
await pollLongShortAccountRatios(2_000_000 + 60_000, async () => null);
const after = getLongShortState();
assert(JSON.stringify(after) === before, 'falha preserva valor + updatedAt + fetchedAt');
assert(Object.values(after).every((s) => s !== null && s.ratio !== 0), 'falha não converte em zero/null');
const f5 = after['5m'];
assert(f5.fetchedAt === 2_000_000, 'fetchedAt NÃO avança em falha');

// 4. Primeiro carregamento sem dado: null (frontend mostra aguardando dados)
reset();
await pollLongShortAccountRatios(3_000_000, async () => null);
assert(Object.values(getLongShortState()).every((s) => s === null), 'sem dado válido inicial = null em todos os períodos');

console.log(`\nlong-short: ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
