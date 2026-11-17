import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeBrakeRadar,
  closedBrakeKlines,
  computeBrakePct,
  emaLast,
  formatPreservedMinutes,
  parseBrakeKlines,
} from "../lib/brake-radar.ts";

const H1 = 60 * 60_000;
const M15 = 15 * 60_000;
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

function bar(openTime, interval, open, high, low, close, volume = 10) {
  return { openTime, closeTime: openTime + interval - 1, open, high, low, close, volume };
}

function hourly(closes, highs, lows) {
  const start = NOW - 24 * H1;
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const high = Math.max(highs?.[index] ?? Math.max(open, close) + 0.5, open, close);
    const low = Math.min(lows?.[index] ?? Math.min(open, close) - 0.5, open, close);
    return bar(start + index * H1, H1, open, high, low, close);
  });
}

// Série de 15m com uma mínima explícita em `minimumIndex` e fechamentos
// desenhados para controlar retração/EMA.
function fifteenMinute({ minimumIndex = 13, lastClose = 95.04, newLowIndex = -1, newLow = null } = {}) {
  const start = NOW - 12 * 60 * 60_000;
  const points = [];
  for (let index = 0; index < 48; index++) {
    let close;
    if (index <= 12) close = 100;
    else if (index === minimumIndex) close = 93.2;
    else if (index < 24) close = 94;
    else if (index < 40) close = 94.6;
    else close = 95;
    points.push(close);
  }
  points[47] = lastClose;
  return points.map((close, index) => {
    const previous = index === 0 ? close : points[index - 1];
    let low = Math.min(previous, close) - 0.2;
    if (index === minimumIndex) low = 93;
    if (index === newLowIndex && newLow !== null) low = newLow;
    return bar(
      start + index * M15,
      M15,
      previous,
      Math.max(previous, close) + 0.2,
      low,
      close,
    );
  });
}

function baseScenario({ minimumIndex = 13, lastClose = 95.04, newLowIndex = -1, newLow = null } = {}) {
  const closes = [
    ...Array(12).fill(100),
    100, 98, 96, 94, 94, 100, 99, 97.5, 96, 95.8, 95.4, 95.04,
  ];
  const highs = [
    ...Array(12).fill(100.5),
    101, 99.8, 98, 96.2, 94.5, 100.4, 99.5, 98, 96.5, 96, 95.7, 95.5,
  ];
  const lows = [
    ...Array(12).fill(99.5),
    99, 97, 95, 93, 93.5, 94.6, 98.8, 97, 95.8, 95.4, 95.1, 94.9,
  ];
  return {
    h1: hourly(closes, highs, lows),
    m15: fifteenMinute({ minimumIndex, lastClose, newLowIndex, newLow }),
  };
}

// Série de 15m com fechamentos e mínimas explícitas por índice.
function m15Series(points, lowAt = {}) {
  const start = NOW - 12 * 60 * 60_000;
  return points.map((close, index) => {
    const previous = index === 0 ? close : points[index - 1];
    const low = lowAt[index] ?? Math.min(previous, close) - 0.2;
    return bar(
      start + index * M15,
      M15,
      previous,
      Math.max(previous, close, low) + 0.2,
      low,
      close,
    );
  });
}

// Cenário real do card: bloco anterior de +1,1%, recuo recente moderado,
// recuperação relevante da amplitude e fundo preservado. Não é retomada de queda.
function pullbackScenario({ lastH1Close = 100.6956, lastClose15m = 100.7 } = {}) {
  const closes = [
    ...Array(12).fill(102),
    101, 100, 99, 98, 97, 100, 100.4, 100.8, 101.1, 101, 100.8, lastH1Close,
  ];
  const points = Array(48).fill(97);
  points[45] = 97.2;
  points[46] = 97.5;
  points[47] = lastClose15m;
  return { h1: hourly(closes), m15: m15Series(points) };
}

function readingOf(scenario, fetchedAt = NOW - 1_000, now = NOW) {
  return analyzeBrakeRadar({ ...scenario, fetchedAt, now });
}

test("freio: fórmula, limites e não aplicabilidade", () => {
  assert.equal(computeBrakePct(-2, -0.5), 75);
  assert.equal(computeBrakePct(-2, 0), 100);
  assert.equal(computeBrakePct(-2, 1), 100);
  assert.equal(computeBrakePct(-2, -2), 0);
  assert.equal(computeBrakePct(-2, -3), 0);
  assert.equal(computeBrakePct(1, -0.5), null);
  assert.equal(computeBrakePct(0, -0.5), null);
  const clamped = computeBrakePct(-100, -0.1);
  assert.ok(clamped > 99 && clamped <= 100);
});

test("EMA(9): semeada pela SMA e null com dados insuficientes", () => {
  assert.equal(emaLast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 9), 6);
  assert.equal(emaLast([1, 2, 3], 9), null);
});

test("parse/closed: aceita strings e descarta o candle em formação", () => {
  const raw = [
    [NOW - 2 * M15, "100", "101", "99", "100.5", "12", NOW - M15 - 1],
    [NOW - M15, "100.5", "101.5", "100", "101", "8", NOW + M15 - 1],
  ];
  const parsed = parseBrakeKlines(raw);
  assert.equal(parsed.length, 2);
  const closed = closedBrakeKlines(parsed, NOW);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].close, 100.5);
  assert.equal(parseBrakeKlines([[1, "100", "90", "95", "100", "1", 2]]).length, 0, "high < low é inválido");
});

test("fundo preservado: formatação em minutos e horas", () => {
  assert.equal(formatPreservedMinutes(30), "30 min");
  assert.equal(formatPreservedMinutes(60), "1h");
  assert.equal(formatPreservedMinutes(75), "1h 15m");
  assert.equal(formatPreservedMinutes(null), "—");
});

test("REAÇÃO CONFIRMADA: cinco critérios liberam DCA 1", () => {
  const reading = readingOf(baseScenario());
  assert.equal(reading.state, "REACTION");
  assert.equal(reading.label, "REAÇÃO CONFIRMADA");
  assert.equal(reading.tone, "green");
  assert.equal(reading.badge, "DCA 1 LIBERADO");
  assert.equal(reading.hasDrop, true);
  assert.ok(reading.dropPct < -1.5);
  assert.ok(Math.abs(reading.previousReturnPct - -4) < 1e-9);
  assert.ok(Math.abs(reading.recentReturnPct - -1) < 1e-9);
  assert.ok(Math.abs(reading.brakePct - 75) < 1e-9);
  assert.ok(reading.candlesWithoutNewLow >= 4);
  assert.ok(reading.preservedMinutes >= 60);
  assert.ok(reading.retracementPct >= 20);
  assert.ok(reading.lastClose15m > reading.ema9);
  assert.equal(reading.barMetric, "recovery");
  assert.ok(Math.abs(reading.targetDcaPrice - 94.6) < 1e-9);
  assert.match(reading.action, /DCA 1 LIBERADO/);
  assert.match(reading.reason, /Reação inicial identificada/);
});

test("QUEDA DESACELERANDO: freio ≥25% sem repique relevante", () => {
  const reading = readingOf(baseScenario({ lastClose: 94 }));
  assert.equal(reading.state, "SLOWING");
  assert.equal(reading.label, "QUEDA DESACELERANDO");
  assert.equal(reading.tone, "amber");
  assert.equal(reading.badge, "AGUARDAR");
  assert.equal(reading.hasDrop, true);
  assert.ok(reading.brakePct >= 25);
  assert.ok(reading.retracementPct < 15);
  assert.equal(reading.barMetric, "brake");
  assert.match(reading.action, /AGUARDAR/);
  assert.match(reading.reason, /Freio de/);
});

test("QUEDA ACELERANDO: vermelho só com velocidade aumentando", () => {
  const scenario = baseScenario({ lastClose: 94 });
  scenario.h1 = hourly(
    [...Array(12).fill(100), 100, 98, 96, 94, 94, 100, 99, 98, 99, 98, 96, 95.04],
    [...Array(12).fill(100.5), 101, 99.8, 98, 96.2, 94.5, 100.4, 99.5, 98.5, 99.5, 98.5, 96.5, 95.5],
    [...Array(12).fill(99.5), 99, 97, 95, 93, 93.5, 94.6, 98.8, 97.8, 98.8, 97.8, 95.8, 94.9],
  );
  const reading = readingOf(scenario);
  assert.equal(reading.state, "ACCELERATING");
  assert.equal(reading.label, "QUEDA ACELERANDO");
  assert.equal(reading.tone, "red");
  assert.equal(reading.badge, "NÃO INICIAR");
  assert.equal(reading.accelerating, true);
  assert.equal(reading.brakeApplicable, true);
  assert.equal(reading.brakePct, 0);
  assert.equal(reading.barMetric, "brake");
  assert.match(reading.action, /NÃO INICIAR DCA/);
  assert.match(reading.reason, /velocidade de queda aumentando/);
});

test("QUEDA SEM ESTABILIZAÇÃO: nova mínima recente sem aceleração", () => {
  const reading = readingOf(baseScenario({ lastClose: 92.8, newLowIndex: 46, newLow: 92.5 }));
  assert.equal(reading.state, "UNSTABLE");
  assert.equal(reading.label, "QUEDA SEM ESTABILIZAÇÃO");
  assert.equal(reading.tone, "red");
  assert.equal(reading.badge, "NÃO INICIAR");
  assert.equal(reading.accelerating, false);
  assert.equal(reading.preservedMinutes, 15);
  assert.equal(reading.barMetric, "brake");
  assert.match(reading.action, /NÃO INICIAR DCA/);
  assert.match(reading.reason, /nova mínima recente/);
});

test("REPIQUE EM OBSERVAÇÃO: 30 min de fundo preservado, sem DCA", () => {
  const closes = [...Array(18).fill(100), 99, 98, 96.5, 96.8, 96.9, 97];
  const lows = Array(24);
  lows[23] = 95.5;
  const points = Array(48).fill(96.5);
  points[45] = 95.7;
  points[46] = 96.6;
  points[47] = 97;
  const reading = readingOf({
    h1: hourly(closes, undefined, lows),
    m15: m15Series(points, { 45: 95.5 }),
  });
  assert.equal(reading.state, "REBOUND");
  assert.equal(reading.label, "REPIQUE EM OBSERVAÇÃO");
  assert.equal(reading.tone, "cyan");
  assert.equal(reading.badge, "AGUARDAR");
  assert.equal(reading.hasDrop, true);
  assert.equal(reading.preservedMinutes, 30);
  assert.ok(reading.retracementPct >= 15);
  assert.equal(reading.barMetric, "recovery");
  assert.ok(Math.abs(reading.targetDcaPrice - 96.5) < 1e-9);
  assert.match(reading.action, /AGUARDAR/);
  assert.match(reading.reason, /30 min/);
  assert.match(reading.reason, /Confirmação exige/);
});

test("REPIQUE EM OBSERVAÇÃO: retorno positivo sem queda relevante não libera DCA", () => {
  const closes = [...Array(18).fill(100), 100, 99.8, 100, 100.2, 100.4, 100.5];
  const reading = readingOf({
    h1: hourly(closes),
    m15: fifteenMinute({ lastClose: 100.5 }),
  });
  assert.equal(reading.state, "REBOUND");
  assert.equal(reading.label, "REPIQUE EM OBSERVAÇÃO");
  assert.equal(reading.tone, "cyan");
  assert.equal(reading.badge, "AGUARDAR");
  assert.equal(reading.hasDrop, false);
  assert.equal(reading.barMetric, "recovery");
  assert.match(reading.action, /AGUARDAR/);
  assert.match(reading.reason, /sem queda relevante/);
  assert.match(reading.reason, /sem gatilho de DCA/);
});

test("REPIQUE sem freio aplicável: recuperação não libera DCA", () => {
  const closes = [...Array(15).fill(100), 94, 95, 96, 96, 96, 96, 96.2, 96.4, 96.6];
  const reading = readingOf({
    h1: hourly(closes),
    m15: fifteenMinute({ lastClose: 96.6 }),
  });
  assert.equal(reading.state, "REBOUND");
  assert.equal(reading.tone, "cyan");
  assert.equal(reading.hasDrop, true);
  assert.equal(reading.brakeApplicable, false);
  assert.equal(reading.brakePct, null);
  assert.equal(reading.barMetric, "recovery");
  assert.match(reading.action, /AGUARDAR/);
  assert.doesNotMatch(reading.action, /DCA 1 LIBERADO/);
});

test("REPIQUE SEM FREIO: recuo moderado após recuperação não é retomada de queda", () => {
  // Espelha a leitura real: anterior +1,1%, recente −0,4%, retração ~70% e fundo
  // preservado. O recuo é acomodação dentro da recuperação, não nova queda.
  const reading = readingOf(pullbackScenario());
  assert.equal(reading.state, "REBOUND");
  assert.equal(reading.label, "REPIQUE EM OBSERVAÇÃO");
  assert.equal(reading.tone, "cyan");
  assert.equal(reading.badge, "AGUARDAR");
  assert.equal(reading.hasDrop, true);
  assert.equal(reading.brakeApplicable, false);
  assert.equal(reading.brakePct, null);
  assert.equal(reading.accelerating, false);
  assert.ok(reading.recentReturnPct < 0 && reading.recentReturnPct > -0.5);
  assert.ok(reading.retracementPct >= 15);
  assert.ok(reading.preservedMinutes >= 60);
  assert.equal(reading.barMetric, "recovery");
  assert.match(reading.action, /AGUARDAR/);
  assert.doesNotMatch(reading.action, /DCA 1 LIBERADO/);
  assert.match(reading.reason, /recuo recente de −0,4%/);
  assert.match(reading.reason, /não caracteriza retomada da queda/);
});

test("recuo forte sem freio: continua QUEDA SEM ESTABILIZAÇÃO", () => {
  const reading = readingOf(pullbackScenario({ lastH1Close: 100.2, lastClose15m: 100.2 }));
  assert.equal(reading.state, "UNSTABLE");
  assert.equal(reading.label, "QUEDA SEM ESTABILIZAÇÃO");
  assert.equal(reading.tone, "red");
  assert.equal(reading.badge, "NÃO INICIAR");
  assert.equal(reading.brakeApplicable, false);
  assert.ok(reading.recentReturnPct <= -0.5);
  assert.match(reading.reason, /sem freio mensurável/);
  assert.match(reading.reason, /movimento recente de −0,9%/);
});

test("recuo moderado sem recuperação relevante: continua vermelho", () => {
  const reading = readingOf(pullbackScenario({ lastClose15m: 97 }));
  assert.equal(reading.state, "UNSTABLE");
  assert.equal(reading.tone, "red");
  assert.ok(reading.recentReturnPct < 0 && reading.recentReturnPct > -0.5);
  assert.ok(reading.retracementPct < 15);
  assert.doesNotMatch(reading.action, /DCA 1 LIBERADO/);
});

test("MERCADO LATERAL / SEM QUEDA: cinza, sem DCA", () => {
  const closes = Array(24).fill(100);
  const reading = readingOf({
    h1: hourly(closes, Array(24).fill(100.5), Array(24).fill(99.5)),
    m15: fifteenMinute({ lastClose: 100 }),
  });
  assert.equal(reading.state, "NO_DROP");
  assert.equal(reading.label, "MERCADO LATERAL / SEM QUEDA");
  assert.equal(reading.tone, "gray");
  assert.equal(reading.badge, "AGUARDAR");
  assert.equal(reading.hasDrop, false);
  assert.equal(reading.barMetric, "none");
  assert.match(reading.action, /AGUARDAR/);
  assert.match(reading.reason, /1,5%/);
  assert.match(reading.reason, /DCA de queda inativo/);
});

test("topo depois da mínima não cria uma queda artificial", () => {
  const closes = Array(24).fill(100);
  const highs = Array(24).fill(101);
  const lows = Array(24).fill(100);
  closes[12] = 100;
  highs[12] = 101;
  lows[12] = 80;
  closes[13] = 119.5;
  highs[13] = 120;
  lows[13] = 100;
  for (let index = 14; index < 24; index++) {
    closes[index] = 119.5;
    highs[index] = 120;
    lows[index] = 119;
  }
  const reading = readingOf({
    h1: hourly(closes, highs, lows),
    m15: fifteenMinute({ lastClose: 118 }),
  });
  assert.equal(reading.state, "NO_DROP");
  assert.equal(reading.label, "MERCADO LATERAL / SEM QUEDA");
  assert.ok(reading.dropPct > -1.5, "queda encontrada é apenas a oscilação normal pós-topo");
  assert.equal(reading.minimum12h, 100, "mínima anterior ao topo (80) não foi usada");
});

test("nova mínima inferior reinicia a contagem de 15m", () => {
  const reading = readingOf(baseScenario({ lastClose: 92.8, newLowIndex: 46, newLow: 92.5 }));
  assert.equal(reading.candlesWithoutNewLow, 1);
  assert.equal(reading.preservedMinutes, 15);
});

test("DADOS INDISPONÍVEIS: dados velhos, insuficientes, desalinhados ou em formação", () => {
  const stale = readingOf(baseScenario(), NOW - 2 * 60_000 - 1);
  assert.equal(stale.state, "UNAVAILABLE");
  assert.match(stale.action, /Aguardando atualização/);

  const short = baseScenario();
  short.h1 = short.h1.slice(-23);
  assert.equal(readingOf(short).state, "UNAVAILABLE");

  const gap = baseScenario();
  gap.m15 = gap.m15.filter((_, index) => index !== 20);
  assert.equal(readingOf(gap).state, "UNAVAILABLE");

  const misaligned = baseScenario();
  misaligned.m15 = misaligned.m15.map((candle) => ({
    ...candle,
    openTime: candle.openTime - H1,
    closeTime: candle.closeTime - H1,
  }));
  const misalignedReading = readingOf(misaligned);
  assert.equal(misalignedReading.state, "UNAVAILABLE");
  assert.match(misalignedReading.reason, /alinhamento temporal/);

  // Cenário real: a hora corrente ainda está aberta, então o último candle de
  // 15m é mais recente que o último de 1h. Isso é normal, não é desalinhamento.
  const skewed = baseScenario();
  skewed.h1 = skewed.h1.map((candle) => ({
    ...candle,
    openTime: candle.openTime - H1,
    closeTime: candle.closeTime - H1,
  }));
  const skewedReading = readingOf(skewed);
  assert.notEqual(skewedReading.state, "UNAVAILABLE", "defasagem normal de 1h não invalida");
  assert.equal(skewedReading.state, "REACTION");

  const forming = readingOf(baseScenario(), NOW - 60_000, NOW - 60_000);
  assert.equal(forming.state, "UNAVAILABLE");

  assert.equal(analyzeBrakeRadar({ h1: [], m15: [], fetchedAt: null, now: NOW }).state, "UNAVAILABLE");
});

test("integração: card renderizado abaixo do NEXUS na home", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ BtcRadarReversal \} from "\.\/BtcRadarReversal"/);
  const nexus = page.indexOf("<ConfluencePanel");
  const radar = page.indexOf("<BtcRadarReversal");
  const position = page.indexOf("<PositionPanel");
  assert.ok(nexus >= 0 && radar > nexus && position > radar, "ordem NEXUS → Radar de Reversão → PositionPanel");

  const wrapper = await readFile(new URL("../app/BtcRadarReversal.tsx", import.meta.url), "utf8");
  assert.match(wrapper, /<BtcBrakeRadar/);
  assert.match(wrapper, /CAÇA-FUNDOS/);
  assert.match(wrapper, /CAÇA-TOPOS/);

  const component = await readFile(new URL("../app/BtcBrakeRadar.tsx", import.meta.url), "utf8");
  assert.match(component, /BITCOIN — RADAR DE FREIO DA QUEDA/);
  assert.match(component, /brTitle/);
  assert.match(component, /BTC\/USDT/);
  assert.match(component, /MOVIMENTO RECENTE \(3H\)/);
  assert.match(component, /RECUPERAÇÃO DA QUEDA/);
  assert.match(component, /FUNDO PRESERVADO/);
  assert.match(component, /Nível 20%/);
  assert.match(component, /fmtCurrentPrice/);
  assert.match(component, /brCurrentPrice/);
  assert.match(component, /minimumFractionDigits: 2/);
  assert.match(component, /maximumFractionDigits: 2/);
  assert.match(component, /priceTrendTone/);
  assert.match(component, /validLivePrice/);
  assert.match(component, /displayedPrice/);
  assert.match(component, /fmtDailyChange/);
  assert.match(component, /brDailyChange/);
  assert.match(component, /brQuoteAsset/);
  assert.match(component, /RECUPERAÇÃO DA AMPLITUDE \(%\)/);
  assert.match(component, /FREIO DA QUEDA \(%\)/);
  assert.match(component, /FREIO NÃO APLICÁVEL/);
  assert.doesNotMatch(component, /SEM MÉTRICA/);
  assert.doesNotMatch(component, /INATIVO/);
  assert.match(component, /brBarAreaEmpty/);
  assert.match(component, /brPreserveTrack/);

  const css = await readFile(new URL("../app/brake-radar.css", import.meta.url), "utf8");
  assert.match(css, /tone-cyan/);
  assert.match(css, /#38bdf8/);
  assert.match(css, /#94a3b8/);
  assert.match(css, /--br-wash: #251116/);
  assert.match(css, /--br-wash: #28200f/);
  assert.match(css, /--br-wash: #0c2330/);
  assert.match(css, /--br-wash: #10291f/);
  assert.match(page, /dailyChangePct=\{ticker === "BTC" \? change24h : null\}/);
});
