// tests/trade-aggregator.test.mjs
// P0-01 — agregador client-side de execuções (substituto do @aggTrade, que não existe
// no futures). Roda contra o build: `npm run build` (tsc) antes.
//   node tests/trade-aggregator.test.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { TradeAggregator } = await import(pathToFileURL(path.join(here, '..', 'dist', 'flow', 'aggregator.js')).href);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

const T = (id, eventTime, price, quantity, side = 'BUY') => ({
  exchange: 'binance', id, eventTime, price, quantity, side, isBuyerMaker: side === 'SELL',
});

// ── Teste 1: execuções da mesma direção na janela → 1 agregado ──
console.log('\n=== Teste 1: agregação na janela (~100ms) ===');
{
  const a = new TradeAggregator(100);
  // 3 execuções de compra no mesmo ms: $60k + $50k + $40k = $150k
  const out1 = a.push(T(1, 1000, 78000, 0.77));   // $60.060
  const out2 = a.push(T(2, 1000, 78000, 0.64));   // $49.920
  assert(out1.length === 0 && out2.length === 0, 'dentro da janela → nada emitido ainda');
  // 4ª execução 150ms depois (janela expirou) → flush do grupo anterior
  const out3 = a.push(T(3, 1150, 78000, 0.51));   // $39.780
  assert(out3.length === 1, 'janela expirada → 1 agregado emitido');
  const agg = out3[0];
  assert(agg.quantity === 0.77 + 0.64, `quantidade somada (${agg.quantity.toFixed(2)})`);
  assert(Math.abs(agg.price - 78000) < 1e-6, 'VWAP = preço (todos iguais aqui; tolerância FP)');
  assert(agg.executions === 2, 'executions = 2 fills');
  assert(agg.id === 2, 'id = última execução do grupo (dedupe)');
  assert(agg.firstId === 1, 'firstId = primeira execução do grupo');
  assert(agg.side === 'BUY', 'lado agressor preservado');
  // flush final do último grupo
  const last = a.flushPending();
  assert(last !== null && last.quantity === 0.51, 'flushPending emite o grupo pendente');
  assert(a.flushPending() === null, 'flushPending vazio após flush');
}

// ── Teste 2: mudança de lado agressor força flush ──
console.log('\n=== Teste 2: mudança de lado agressor ===');
{
  const a = new TradeAggregator(100);
  a.push(T(1, 1000, 78000, 1, 'BUY'));
  const out = a.push(T(2, 1010, 78000, 2, 'SELL')); // mesmo ms-ish, lado mudou
  assert(out.length === 1 && out[0].side === 'BUY' && out[0].quantity === 1, 'lado mudou → flush do grupo BUY');
  const last = a.flushPending();
  assert(last !== null && last.side === 'SELL' && last.quantity === 2, 'grupo SELL pendente correto');
}

// ── Teste 3: VWAP com preços diferentes (mesma janela) ──
console.log('\n=== Teste 3: VWAP ===');
{
  const a = new TradeAggregator(100);
  // 2 execuções na MESMA janela: 1 BTC @ 78000 + 1 BTC @ 79000 → VWAP = 78500
  a.push(T(1, 1000, 78000, 1));
  assert(a.push(T(2, 1050, 79000, 1)).length === 0, '2ª execução dentro da janela → ainda pendente');
  const out = a.push(T(3, 1150, 78000, 1)); // janela expirou → flush do grupo anterior
  assert(Math.abs(out[0].price - 78500) < 1e-6, `VWAP correto (${out[0].price})`);
  assert(out[0].quantity === 2, 'quantidade total');
}

// ── Teste 4: reset descarta grupo incompleto ──
console.log('\n=== Teste 4: reset ===');
{
  const a = new TradeAggregator(100);
  a.push(T(1, 1000, 78000, 1));
  a.reset();
  assert(a.flushPending() === null, 'reset descarta o grupo pendente (sessão anterior)');
}

// ── Resumo ──
console.log(`\n${'='.repeat(44)}`);
console.log(`Resultados: ${passed} passaram, ${failed} falharam`);
console.log(`${'='.repeat(44)}`);
process.exit(failed > 0 ? 1 : 0);
