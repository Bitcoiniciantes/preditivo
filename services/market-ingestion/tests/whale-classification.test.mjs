// tests/whale-classification.test.mjs
// P0-01 da auditoria — threshold absoluto de whale + parser aggTrade (preserva id).
// Roda contra o build: `npm run build` (tsc) antes.
//   node tests/whale-classification.test.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist');
const { classifyTrade } = await import(pathToFileURL(path.join(dist, 'flow', 'classification.js')).href);
const { parseAggTrade } = await import(pathToFileURL(path.join(dist, 'exchanges', 'binance', 'parser.js')).href);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

// ── Teste 1: threshold absoluto (US$ 100.000) ──
console.log('\n=== Teste 1: classifyTrade — threshold absoluto ===');
const t = (price, quantity) => ({ exchange: 'binance', eventTime: 1, price, quantity, side: 'BUY', isBuyerMaker: false });

assert(classifyTrade(t(78000, 1.5)) === 'large', '1,5 BTC @ $78k ($117k) → large');
assert(classifyTrade(t(78500, 1.274)) === 'large', '~1,274 BTC @ $78,5k ($100k) → large');
assert(classifyTrade(t(78500, 1.273)) === 'small', '~1,273 BTC @ $78,5k (abaixo de $100k) → small');
assert(classifyTrade(t(78000, 0.33)) === 'small', '0,33 BTC @ $78k (~$26k, varejo) → small');
assert(classifyTrade(t(100000, 1)) === 'large', 'exatamente $100k → large');

// ── Teste 2: parser — preserva id (futures 't' e spot 'a') e semântica ──
console.log('\n=== Teste 2: parseAggTrade — id e side ===');
// Futures @trade: id em 't'
const fut = { e: 'trade', E: 1787000000000, s: 'BTCUSDT', t: 8020713126, p: '78500.5', q: '2.5', X: 'MARKET', T: 1787000000001, m: false, st: 1 };
const parsed = parseAggTrade(fut);
assert(parsed?.id === 8020713126, 'id do futures @trade preservado (t=8020713126)');
assert(parsed?.price === 78500.5 && parsed?.quantity === 2.5, 'preço e quantidade corretos');
assert(parsed?.eventTime === 1787000000001, 'eventTime = T (instante do trade)');
assert(parsed?.side === 'BUY' && parsed?.isBuyerMaker === false, 'm=false → comprador agressor (BUY)');
const seller = parseAggTrade({ ...fut, m: true });
assert(seller?.side === 'SELL' && seller?.isBuyerMaker === true, 'm=true → vendedor agressor (SELL)');
// Spot @aggTrade: id em 'a'
const spotMsg = { e: 'aggTrade', E: 1787000000000, s: 'BTCUSDT', a: 987654321, p: '78500.5', q: '2.5', f: 100, l: 104, T: 1787000000001, m: false };
const spotParsed = parseAggTrade(spotMsg);
assert(spotParsed?.id === 987654321, 'id do spot @aggTrade preservado (a=987654321)');
assert(parseAggTrade({ ...fut, p: '0' }) === null, 'preço inválido → null');
assert(parseAggTrade({ ...fut, q: 'NaN' }) === null, 'quantidade inválida → null');
const noId = parseAggTrade({ ...fut, t: undefined });
assert(noId?.id === undefined, 'sem id no payload → id undefined (não quebra)');

// ── Resumo ──
console.log(`\n${'='.repeat(44)}`);
console.log(`Resultados: ${passed} passaram, ${failed} falharam`);
console.log(`${'='.repeat(44)}`);
process.exit(failed > 0 ? 1 : 0);
