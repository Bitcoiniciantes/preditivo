/**
 * Histerese assimétrica 3→5 do RegimeDetector (fase operacional).
 *
 * Determinístico — sem Math.random.
 * - Entrada RANGE→TREND: 3 leituras consecutivas do candidato.
 * - Saída de TREND (→RANGE ou BULL↔BEAR direto): 5 leituras consecutivas.
 * - volatilityFactor padrão: 5.0.
 */
import { RegimeDetector } from '../src/engine/regime.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function makeDetector() {
  // Janela curta torna as transições determinísticas em poucos ticks.
  return new RegimeDetector({ windowSeconds: 10, minSamples: 3, baseThreshold: 0.05, volatilityFactor: 5.0 });
}

let now = 1_000_000;
function step(d: RegimeDetector, price: number) {
  const r = d.evaluate(price, now);
  now += 1000;
  return r;
}
function feed(d: RegimeDetector, price: number, n: number) {
  let r: ReturnType<RegimeDetector['evaluate']> | undefined;
  for (let i = 0; i < n; i++) r = step(d, price);
  return r!;
}

// 1. estado inicial RANGE
{
  const d = makeDetector();
  const r = step(d, 100);
  assert(r.regime === 'RANGE', `1. estado inicial RANGE (recebeu ${r.regime})`);
}

// 2. regime estável não alterna
{
  const d = makeDetector();
  let changes = 0;
  let last = step(d, 100).regime;
  for (let i = 0; i < 20; i++) {
    const r = step(d, 100 + ((i % 5) - 2) * 0.5);
    if (r.regime !== last) { changes++; last = r.regime; }
  }
  assert(changes === 0, `2. estável não alterna (trocas=${changes})`);
}

// 3. uma leitura isolada não troca (spike único revertido)
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  step(d, 130); // spike isolado
  const r = step(d, 100);
  assert(r.regime === 'RANGE', `3. leitura isolada não troca (recebeu ${r.regime})`);
}

// 4. entrada ocorre na 3ª confirmação (contando candidatos BULL consecutivos)
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  // Rampa: primeiro tick ainda sai RANGE por causa do pico de volatilidade;
  // depois o candidato fixa em BULL. Entrada deve ocorrer no 3º BULL consecutivo.
  const seq = [101, 102, 103, 104, 105, 106];
  let bullStreak = 0;
  let flippedAtStreak = -1;
  let prev = 'RANGE';
  for (const p of seq) {
    const r = step(d, p);
    if (r.candidateRegime === 'BULL_TREND') bullStreak++;
    else bullStreak = 0;
    if (prev === 'RANGE' && r.regime === 'BULL_TREND' && flippedAtStreak === -1) flippedAtStreak = bullStreak;
    prev = r.regime;
  }
  assert(flippedAtStreak === 3, `4. entrada na 3ª confirmação BULL (virou com streak=${flippedAtStreak})`);
}

// 5+6. saída exige 5: com 4 RANGE consecutivos ainda BULL; com 5 vira RANGE
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  for (const p of [101, 102, 103, 104, 105, 106]) step(d, p);
  const before = step(d, 106);
  assert(before.regime === 'BULL_TREND', `5a. pré-condição BULL estabelecida (recebeu ${before.regime})`);
  // Achatar no topo: a janela de 10s ainda contém a rampa; após ~8 flats o
  // candidato vira RANGE. Contar a partir do 1º RANGE consecutivo.
  let rangeStreak = 0;
  let regimeAt4: string | null = null;
  let regimeAt5: string | null = null;
  for (let i = 0; i < 16; i++) {
    const r = step(d, 106);
    if (r.candidateRegime === 'RANGE') {
      rangeStreak++;
      if (rangeStreak === 4) regimeAt4 = r.regime;
      if (rangeStreak === 5) { regimeAt5 = r.regime; break; }
    } else {
      rangeStreak = 0;
    }
  }
  assert(regimeAt4 === 'BULL_TREND', `5. saída NÃO ocorre com 4 confirmações (recebeu ${regimeAt4})`);
  assert(regimeAt5 === 'RANGE', `6. saída ocorre na 5ª confirmação (recebeu ${regimeAt5})`);
}

// 7. reversão rápida não causa flapping (2 BULL, 2 RANGE, estabiliza RANGE)
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  step(d, 101); step(d, 102); // até 2 candidatos BULL no máximo — abaixo de 3
  let changes = 0;
  let last = d.evaluate(100, now).regime; now += 1000;
  for (let i = 0; i < 12; i++) {
    const r = step(d, 100);
    if (r.regime !== last) { changes++; last = r.regime; }
  }
  assert(changes === 0, `7. reversão rápida sem flapping (trocas=${changes})`);
}

// 8. contador reseta quando a sequência é interrompida
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  step(d, 101); step(d, 102); // 1-2 BULL (não confirmam)
  step(d, 100); step(d, 100); // interrompe — reseta
  const r1 = step(d, 101);
  const r2 = step(d, 102);
  assert(r1.regime === 'RANGE' && r2.regime === 'RANGE',
    `8. sequência interrompida reseta (recebeu ${r1.regime}/${r2.regime})`);
}

// 9. BULL↔BEAR direto exige 5 (é saída)
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  for (const p of [101, 102, 103, 104, 105, 106]) step(d, p);
  assert(feed(d, 106, 1).regime === 'BULL_TREND', '9a. pré-condição BULL');
  // Queda forte e sustentada: conta BEAR consecutivos; só vira no 5º.
  let bearStreak = 0;
  let regimeAt4: string | null = null;
  let regimeAt5: string | null = null;
  const fall = [100, 94, 88, 82, 76, 70, 64, 58, 52, 46, 40, 34, 28, 22, 16, 10];
  for (const p of fall) {
    const r = step(d, p);
    if (r.candidateRegime === 'BEAR_TREND') {
      bearStreak++;
      if (bearStreak === 4) regimeAt4 = r.regime;
      if (bearStreak === 5) { regimeAt5 = r.regime; break; }
    }
  }
  assert(regimeAt4 !== 'BEAR_TREND', `9. BULL→BEAR NÃO vira com 4 (recebeu ${regimeAt4})`);
  assert(regimeAt5 === 'BEAR_TREND', `9. BULL→BEAR vira com 5 (recebeu ${regimeAt5})`);
}

// 10. volatilityFactor 5.0 efetivamente aplicado (default)
{
  const d = new RegimeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  // Salto único de 1%: vol do salto ≈0.28% → 0.28*5≈1.4% > 1% ⇒ threshold adaptativo
  // supera o piso — prova que o fator 5.0 está no cálculo (com 2.0 seria 0.55% e
  // o candidato já seria BULL aqui).
  const r = step(d, 101);
  assert(r.candidateRegime === 'RANGE',
    `10. volatilityFactor 5.0 aplicado (salto 1% ainda RANGE, vol=${r.volatility.toFixed(3)})`);
}

// 11. regressão fora da histerese: tendência longa e folgada ainda confirma
{
  const d = makeDetector();
  for (let i = 0; i < 12; i++) step(d, 100);
  let last = 'RANGE';
  let changes = 0;
  for (let i = 0; i < 12; i++) {
    const r = step(d, 100 + (i + 1) * 1.5);
    if (r.regime !== last) { changes++; last = r.regime; }
  }
  assert(changes === 1 && last === 'BULL_TREND',
    `11. regressão: tendência clara confirma 1x BULL (trocas=${changes}, last=${last})`);
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Resultados: ${passed} passaram, ${failed} falharam`);
console.log(`${'='.repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
