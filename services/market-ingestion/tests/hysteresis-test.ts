/**
 * 3.5 — Teste de histerese sob ruído
 * 
 * Simula preços oscilando ao redor do threshold de troca de regime
 * e verifica que:
 * 1. O contador de confirmação reseta quando a direção muda antes de atingir confirmationThreshold
 * 2. Nenhum falso regime_change é logado
 * 3. Mesmo teste para flowRegime
 */

import { RegimeDetector } from '../src/engine/regime.js';
import { FlowRegimeDetector } from '../src/engine/flow-regime.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

// ── Teste 1: RegimeDetector — histerese sob oscilação ──
console.log('\n=== Teste 1: RegimeDetector histerese ===');

const regime = new RegimeDetector({ windowSeconds: 60, minSamples: 3, baseThreshold: 0.05, volatilityFactor: 2.0, confirmationThreshold: 3 });
const basePrice = 77000;
let regimeChanges = 0;
let lastRegime = 'RANGE';

// Simular 30 preços estáveis (confidence vai subir)
console.log('Fase 1: 30 preços estáveis em torno de 77000...');
for (let i = 0; i < 30; i++) {
  const price = basePrice + (Math.random() - 0.5) * 10; //振幅 ±5
  const result = regime.evaluate(price, Date.now() + i * 1000);
  if (result.regime !== lastRegime) {
    regimeChanges++;
    console.log(`  regime_change: ${lastRegime} → ${result.regime} (confidence: ${result.confidence}%)`);
    lastRegime = result.regime;
  }
}
assert(regimeChanges === 0, `Fase 1: 0 regime changes em mercado estável (recebeu ${regimeChanges})`);

// Oscilar perto do threshold — preços alternando entre 77000 e 77050
console.log('\nFase 2: Oscilando perto do threshold (77000 ↔ 77050)...');
regimeChanges = 0;
lastRegime = regime.evaluate(basePrice, Date.now() + 30000).regime;

for (let i = 0; i < 30; i++) {
  // Alternar entre dois preços: um acima, outro abaixo do threshold
  const price = i % 2 === 0 ? basePrice + 40 : basePrice;
  const result = regime.evaluate(price, Date.now() + (30 + i) * 1000);
  if (result.regime !== lastRegime) {
    regimeChanges++;
    console.log(`  regime_change: ${lastRegime} → ${result.regime} (confidence: ${result.confidence}%, candidate: ${result.candidateRegime})`);
    lastRegime = result.regime;
  }
}
assert(regimeChanges === 0, `Fase 2: 0 false regime changes na oscilação (recebeu ${regimeChanges})`);

// Tendência clara — deve confirmar BULL_TREND
console.log('\nFase 3: Tendência clara de alta (subindo 2 por tick)...');
regimeChanges = 0;
lastRegime = regime.evaluate(basePrice, Date.now() + 60000).regime;

for (let i = 0; i < 20; i++) {
  const price = basePrice + 100 + i * 2;
  const result = regime.evaluate(price, Date.now() + (60 + i) * 1000);
  if (result.regime !== lastRegime) {
    regimeChanges++;
    console.log(`  regime_change: ${lastRegime} → ${result.regime} (confidence: ${result.confidence}%)`);
    lastRegime = result.regime;
  }
}
assert(regimeChanges === 1 && lastRegime === 'BULL_TREND', `Fase 3: 1 regime change para BULL_TREND (recebeu ${regimeChanges}, last: ${lastRegime})`);

// ── Teste 2: FlowRegimeDetector — histerese sob oscilação de fluxo ──
console.log('\n=== Teste 2: FlowRegimeDetector histerese ===');

const flow = new FlowRegimeDetector({ dominanceThreshold: 60, confirmationThreshold: 5, minConfidenceForDivergence: 35 });
let flowChanges = 0;
let lastFlow = 'NEUTRAL_FLOW';

// Fase 1: fluxo neutro
console.log('Fase 1: 20 ticks neutros (imbalance ~0, cvdWhale ~0)...');
for (let i = 0; i < 20; i++) {
  const result = flow.evaluate(0, 0, 'RANGE', 50, Date.now() + i * 1000);
  if (result.flowRegime !== lastFlow) {
    flowChanges++;
    console.log(`  flow_change: ${lastFlow} → ${result.flowRegime}`);
    lastFlow = result.flowRegime;
  }
}
assert(flowChanges === 0, `Fase 1: 0 flow changes em neutro (recebeu ${flowChanges})`);

// Fase 2: oscilar entre comprador e vendedor forte
console.log('\nFase 2: Oscilando entre comprador forte e vendedor forte...');
flowChanges = 0;
lastFlow = flow.evaluate(0, 0, 'RANGE', 50, Date.now() + 20000).flowRegime;

for (let i = 0; i < 30; i++) {
  // Alternar entre dominância compradora e vendedora
  const imb = i % 2 === 0 ? 0.8 : -0.8;
  const cvd = i % 2 === 0 ? 400000 : -400000;
  const result = flow.evaluate(imb, cvd, 'RANGE', 50, Date.now() + (20 + i) * 1000);
  if (result.flowRegime !== lastFlow) {
    flowChanges++;
    console.log(`  flow_change: ${lastFlow} → ${result.flowRegime} (strength: ${result.flowStrength.toFixed(1)})`);
    lastFlow = result.flowRegime;
  }
}
assert(flowChanges === 0, `Fase 2: 0 false flow changes na oscilação (recebeu ${flowChanges})`);

// Fase 3: fluxo comprador sustentado — deve confirmar BULL_FLOW
console.log('\nFase 3: Fluxo comprador sustentado (10 ticks)...');
flowChanges = 0;
lastFlow = flow.evaluate(0, 0, 'RANGE', 50, Date.now() + 50000).flowRegime;

for (let i = 0; i < 15; i++) {
  const result = flow.evaluate(0.8, 400000, 'RANGE', 50, Date.now() + (50 + i) * 1000);
  if (result.flowRegime !== lastFlow) {
    flowChanges++;
    console.log(`  flow_change: ${lastFlow} → ${result.flowRegime} (strength: ${result.flowStrength.toFixed(1)})`);
    lastFlow = result.flowRegime;
  }
}
assert(flowChanges === 1 && lastFlow === 'BULL_FLOW', `Fase 3: 1 flow change para BULL_FLOW (recebeu ${flowChanges}, last: ${lastFlow})`);

// ── Teste 3: Divergence — gate de confiança ──
console.log('\n=== Teste 3: Divergence gate de confiança ===');

const flow2 = new FlowRegimeDetector({ dominanceThreshold: 60, confirmationThreshold: 3, minConfidenceForDivergence: 35 });

// confidence baixa (0) + RANGE + BULL_FLOW → NÃO deve ativar divergência
console.log('Fase 1: confidence=0, RANGE, BULL_FLOW por 10 ticks...');
for (let i = 0; i < 10; i++) {
  flow2.evaluate(0.8, 400000, 'RANGE', 0, Date.now() + i * 1000);
}
const divLowConf = flow2.evaluate(0.8, 400000, 'RANGE', 0, Date.now() + 10000);
assert(divLowConf.divergence === 'NONE', `Divergence NÃO ativa com confidence=0 (recebeu: ${divLowConf.divergence})`);

// confidence alta (50) + RANGE + BULL_FLOW → deve ativar divergência após confirmationThreshold
console.log('\nFase 2: confidence=50, RANGE, BULL_FLOW por 5 ticks...');
const flow3 = new FlowRegimeDetector({ dominanceThreshold: 60, confirmationThreshold: 3, minConfidenceForDivergence: 35 });
let divActivated = false;
for (let i = 0; i < 8; i++) {
  const result = flow3.evaluate(0.8, 400000, 'RANGE', 50, Date.now() + i * 1000);
  if (result.divergence !== 'NONE') {
    divActivated = true;
    console.log(`  Divergence ativou no tick ${i}: ${result.divergence}`);
  }
}
assert(divActivated, 'Divergence ativa com confidence=50 após confirmações');

// ── Resumo ──
console.log(`\n${'='.repeat(40)}`);
console.log(`Resultados: ${passed} passaram, ${failed} falharam`);
console.log(`${'='.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
