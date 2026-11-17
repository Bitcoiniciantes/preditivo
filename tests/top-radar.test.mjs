import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeTopRadar,
  TOP_MAX_CONFIRM_AGE_HOURS,
  TOP_MAX_WATCH_DRAWDOWN_PCT,
  TOP_MIN_DRAWDOWN_PCT,
  TOP_MIN_NO_NEW_HIGH_MINUTES,
  TOP_MIN_RISE_12H_PCT,
} from "../lib/top-radar.ts";
import { analyzeBrakeRadar } from "../lib/brake-radar.ts";

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

function m15Series(points, { lowAt = {}, highAt = {} } = {}) {
  const start = NOW - 48 * M15;
  return points.map((close, index) => {
    const open = index === 0 ? points[0] : points[index - 1];
    const high = highAt[index] ?? Math.max(open, close) + 0.2;
    const low = lowAt[index] ?? Math.min(open, close) - 0.2;
    return bar(start + index * M15, M15, open, high, low, close);
  });
}

// Caminho de 48 candles: desce até a mínima de origem no índice 4, sobe até a
// máxima no índice `peakIndex` e recua até `lastClose`. A máxima é única: o
// candle seguinte recebe high 0,05 abaixo do topo para não empatar.
function peakPath({
  peakIndex,
  originIndex = 4,
  startClose = 101,
  originClose = 100,
  peakClose = 104.5,
  lastClose = 103.2,
}) {
  const points = [];
  for (let index = 0; index < originIndex; index++) {
    points.push(startClose + ((originClose - startClose) * index) / originIndex);
  }
  points.push(originClose);
  for (let index = originIndex + 1; index <= peakIndex; index++) {
    points.push(
      originClose + ((peakClose - originClose) * (index - originIndex)) / (peakIndex - originIndex),
    );
  }
  const tail = 47 - peakIndex;
  for (let index = peakIndex + 1; index <= 47; index++) {
    points.push(peakClose + ((lastClose - peakClose) * (index - peakIndex)) / tail);
  }
  return points;
}

function peakSeries(options) {
  const points = peakPath(options);
  const highAt = { [options.peakIndex]: points[options.peakIndex] + 0.2 };
  if (options.peakIndex + 1 < 48) {
    highAt[options.peakIndex + 1] =
      Math.max(points[options.peakIndex], points[options.peakIndex + 1]) + 0.15;
  }
  return m15Series(points, { highAt });
}

// Bloco anterior positivo (+0,58%), bloco recente negativo (−0,77%), perda da
// EMA9 1H e máxima horária não renovada: filtro estrutural completo.
const FILTER_H1_CLOSES = [
  ...Array(12).fill(100),
  100.2, 100.5, 101.0, 102.0, 102.8, 103.4,
  103.8, 104.0, 104.0, 103.9, 103.6, 103.0,
];

function confirmedScenario() {
  return {
    h1: hourly(FILTER_H1_CLOSES),
    m15: peakSeries({
      peakIndex: 31,
      startClose: 103.5,
      originClose: 102.5,
      peakClose: 104.35,
      lastClose: 103.0,
    }),
  };
}

function expiredScenario() {
  return {
    h1: hourly(FILTER_H1_CLOSES),
    m15: peakSeries({
      peakIndex: 22,
      startClose: 103.5,
      originClose: 102.5,
      peakClose: 104.35,
      lastClose: 103.0,
    }),
  };
}

function strongScenario() {
  const closes = [
    ...Array(12).fill(100),
    101, 102, 103, 104, 105, 106,
    107, 109, 111, 113, 115, 117,
  ];
  const points = Array.from({ length: 48 }, (_, index) => 100 + (5 * index) / 47);
  return { h1: hourly(closes), m15: m15Series(points) };
}

// Bloco anterior negativo: mesmo com o bloco recente mais fraco, não existe
// desaceleração de alta a medir.
function negativePreviousScenario() {
  const closes = [
    ...Array(12).fill(100),
    100.5, 101.0, 101.5, 102.0, 102.5, 104.0,
    103.8, 103.6, 103.5, 103.4, 103.3, 103.0,
  ];
  return { h1: hourly(closes), m15: peakSeries({ peakIndex: 31, lastClose: 103.0 }) };
}

function flatScenario() {
  return {
    h1: hourly(Array(24).fill(100)),
    m15: m15Series(Array(48).fill(100)),
  };
}

function readingOf(scenario, fetchedAt = NOW - 1_000, now = NOW) {
  return analyzeTopRadar({ ...scenario, fetchedAt, now });
}

function criterion(reading, id) {
  return reading.criteria.find((item) => item.id === id);
}

test("ALTA FORTE: alta até a máxima sem sinais de exaustão", () => {
  const reading = readingOf(strongScenario());
  assert.equal(reading.state, "STRONG_UPTREND");
  assert.equal(reading.label, "ALTA FORTE");
  assert.equal(reading.tone, "green");
  assert.equal(reading.badge, "ALTA SUSTENTADA");
  assert.equal(reading.action, "MANTER OBSERVAÇÃO");
  assert.ok(reading.riseToPeakPct >= TOP_MIN_RISE_12H_PCT);
  assert.ok(reading.rise12hPct >= TOP_MIN_RISE_12H_PCT);
  assert.equal(criterion(reading, "riseToPeak").met, true);
  assert.equal(criterion(reading, "deceleration").met, false);
  assert.equal(criterion(reading, "topPreserved").met, false);
  assert.equal(criterion(reading, "drawdown").met, false);
  assert.equal(criterion(reading, "ema15").met, false);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.peakEligible, true);
  assert.ok(reading.minutesWithoutNewHigh < TOP_MIN_NO_NEW_HIGH_MINUTES);
  assert.ok(reading.drawdownPct < TOP_MIN_DRAWDOWN_PCT);
});

test("Alta de ~2,2% até a máxima com topo elegível: EXAUSTÃO CONFIRMADA", () => {
  const reading = readingOf(confirmedScenario());
  assert.equal(reading.criteria.filter((item) => item.met).length, 5);
  assert.equal(reading.h1Filter.met, true);
  assert.equal(reading.confirmed, true);
  assert.equal(reading.state, "EXHAUSTION_CONFIRMED");
  assert.equal(reading.label, "EXAUSTÃO CONFIRMADA");
  assert.equal(reading.tone, "red");
  assert.equal(reading.badge, "5/5 + 1H");
  assert.equal(reading.action, "AVALIAR REALIZAÇÃO PARCIAL");
  assert.ok(reading.riseToPeakPct > 2.1 && reading.riseToPeakPct < 2.4);
  assert.ok(reading.drawdownPct > 1.3 && reading.drawdownPct < 1.7);
  assert.ok(reading.peakAgeMinutes <= TOP_MAX_CONFIRM_AGE_HOURS * 60);
  assert.equal(reading.originLow, 102.3);
  assert.equal(reading.maximum, 104.55);
  assert.match(reading.reason, /não representa reversão definitiva/);
});

test("Fechamento 15m abaixo da origem encerra nova realização sem apagar critérios históricos", () => {
  const scenario = confirmedScenario();
  const baseline = readingOf(scenario);
  assert.equal(baseline.state, "EXHAUSTION_CONFIRMED");
  scenario.m15[47] = {
    ...scenario.m15[47],
    close: baseline.originLow - 0.1,
    low: baseline.originLow - 0.2,
  };
  const reading = readingOf(scenario);
  assert.equal(reading.originLost, true);
  assert.equal(reading.state, "ORIGIN_LOST");
  assert.equal(reading.confirmed, false);
  assert.equal(reading.label, "ALTA ANULADA — ORIGEM PERDIDA");
  assert.doesNotMatch(reading.action, /REALIZAÇÃO PARCIAL/);
  assert.match(reading.reason, /fechamento do último candle de 15m/);
  assert.equal(reading.criteria.filter((item) => item.met).length, 5);
});

test("Preço acima da origem preserva confirmação e recuo usa só fechamento fechado", () => {
  const reading = readingOf(confirmedScenario());
  assert.equal(reading.originLost, false);
  assert.equal(reading.confirmed, true);
  assert.ok(Math.abs(reading.drawdownPct - (reading.maximum - reading.lastClose15m) / reading.maximum * 100) < 1e-8);
});

test("Mesmo movimento com topo acima de 6h: não gera nova confirmação", () => {
  const reading = readingOf(expiredScenario());
  assert.ok(reading.peakAgeMinutes > TOP_MAX_CONFIRM_AGE_HOURS * 60);
  assert.equal(reading.peakEligible, false);
  assert.equal(reading.criteria.filter((item) => item.met).length, 5);
  assert.equal(reading.h1Filter.met, true);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.state, "DECELERATING");
  assert.notEqual(reading.state, "EXHAUSTION_CONFIRMED");
  assert.notEqual(reading.state, "STRONG_UPTREND");
  assert.match(reading.reason, /janela de confirmação de 6h/);
  assert.match(reading.reason, /não é tratado como alta forte/);
  // A máxima continua disponível como referência informativa.
  assert.equal(reading.maximum, 104.55);
});

test("Mínima posterior ao topo não é usada como origem da alta", () => {
  const reading = readingOf({
    h1: hourly(FILTER_H1_CLOSES),
    m15: peakSeries({
      peakIndex: 31,
      startClose: 103.5,
      originClose: 102.5,
      peakClose: 104.35,
      lastClose: 96,
    }),
  });
  assert.equal(reading.originLow, 102.3);
  assert.equal(reading.maximum, 104.55);
  assert.ok(reading.originAt < reading.maximumAt);
  assert.ok(reading.riseToPeakPct < 2.4);
  // A mínima pós-topo (~95,8) existe, mas não pode virar origem.
  assert.ok(reading.lastClose15m < 96.1);
  assert.notEqual(reading.originLow, 95.8);
});

test("Alta líquida < 2% não bloqueia alta até a máxima > 2%", () => {
  const closes = [
    ...Array(12).fill(102.5),
    102.6, 102.7, 102.9, 103.5, 103.6, 102.8,
    103.0, 103.2, 103.3, 103.2, 103.0, 102.9,
  ];
  const reading = readingOf({
    h1: hourly(closes),
    m15: peakSeries({
      peakIndex: 31,
      startClose: 102.5,
      originClose: 100,
      peakClose: 104.5,
      lastClose: 102.9,
    }),
  });
  assert.ok(reading.rise12hPct < TOP_MIN_RISE_12H_PCT);
  assert.ok(reading.riseToPeakPct > TOP_MIN_RISE_12H_PCT);
  assert.equal(criterion(reading, "riseToPeak").met, true);
  assert.equal(reading.confirmed, true);
  assert.equal(reading.state, "EXHAUSTION_CONFIRMED");
});

test("Alta até o topo inferior a 2%: critério de alta reprovado", () => {
  const closes = [
    ...Array(12).fill(101),
    101, 101.05, 101.1, 101.15, 101.2, 101.22,
    101.24, 101.25, 101.26, 101.25, 101.23, 101.2,
  ];
  const reading = readingOf({
    h1: hourly(closes),
    m15: peakSeries({ peakIndex: 31, peakClose: 101.3, lastClose: 101.2 }),
  });
  assert.ok(reading.riseToPeakPct < TOP_MIN_RISE_12H_PCT);
  assert.equal(criterion(reading, "riseToPeak").met, false);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.state, "NEUTRAL");
  assert.doesNotMatch(reading.reason, /[45]\/5/);
});

test("Recuo superior a 3%: fora da janela, mesmo com 5/5 + 1H", () => {
  const closes = [
    ...Array(12).fill(100),
    100.2, 100.5, 101.0, 101.8, 102.5, 103.0,
    103.4, 103.8, 104.0, 103.8, 102.8, 100.9,
  ];
  const reading = readingOf({
    h1: hourly(closes),
    m15: peakSeries({ peakIndex: 31, lastClose: 100.9 }),
  });
  assert.ok(reading.drawdownPct > TOP_MAX_WATCH_DRAWDOWN_PCT);
  assert.equal(reading.beyondWatchWindow, true);
  assert.equal(reading.criteria.filter((item) => item.met).length, 5);
  assert.equal(reading.h1Filter.met, true);
  assert.equal(reading.confirmed, false);
  assert.notEqual(reading.state, "TOP_WATCH");
  assert.equal(reading.state, "DECELERATING");
  assert.equal(
    reading.reason,
    "Recuo superior à janela inicial de observação. Correção já em andamento; sinal de topo não deve ser interpretado como novo gatilho.",
  );
});

test("Bloco anterior de 3h negativo reprova a desaceleração", () => {
  const reading = readingOf(negativePreviousScenario());
  assert.ok(reading.previousReturnPct < 0);
  assert.ok(reading.recentReturnPct < reading.previousReturnPct);
  assert.equal(criterion(reading, "deceleration").met, false);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.state, "TOP_WATCH");
  assert.equal(reading.confirmed, false);
  assert.match(criterion(reading, "deceleration").detail, /bloco anterior positivo/);
});

test("Nova máxima superior substitui o topo anterior", () => {
  const scenario = confirmedScenario();
  const points = peakPath({ peakIndex: 31 });
  points[47] = 105;
  scenario.m15 = m15Series(points);
  const reading = readingOf(scenario);
  assert.equal(reading.maximum, 105.2);
  assert.equal(reading.maximumAt, NOW - 12 * 60 * 60_000 + 47 * M15);
  assert.equal(reading.minutesWithoutNewHigh, 0);
  assert.ok(reading.drawdownPct < TOP_MIN_DRAWDOWN_PCT);
  assert.equal(criterion(reading, "topPreserved").met, false);
  assert.notEqual(reading.state, "TOP_WATCH");
  assert.notEqual(reading.state, "EXHAUSTION_CONFIRMED");
});

test("Dados insuficientes para a origem: sem alta relevante e sem confirmação", () => {
  const points = [];
  for (let index = 0; index < 48; index++) points.push(104.5 - (4.5 * index) / 47);
  const reading = readingOf({
    h1: hourly(Array(24).fill(100)),
    m15: m15Series(points),
  });
  assert.equal(reading.maximum, 104.7);
  assert.equal(reading.originLow, null);
  assert.equal(reading.riseToPeakPct, null);
  assert.equal(criterion(reading, "riseToPeak").met, false);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.state, "NEUTRAL");
  assert.match(criterion(reading, "riseToPeak").detail, /anteriores ao topo/);

  const shortH1 = confirmedScenario();
  shortH1.h1 = shortH1.h1.slice(-23);
  assert.equal(readingOf(shortH1).state, "UNAVAILABLE");

  const shortM15 = confirmedScenario();
  shortM15.m15 = shortM15.m15.slice(-47);
  assert.equal(readingOf(shortM15).state, "UNAVAILABLE");
});

test("Candles em formação são ignorados e candles duplicados são deduplicados", () => {
  const scenario = confirmedScenario();
  const baseline = readingOf(scenario);

  const forming = bar(NOW - 1, H1, 105, 130, 104, 129);
  const formingM15 = bar(NOW - 1, M15, 105, 130, 104, 129);
  const reading = readingOf({
    h1: [...scenario.h1, forming],
    m15: [...scenario.m15, formingM15],
  });
  assert.equal(reading.state, "EXHAUSTION_CONFIRMED");
  assert.equal(reading.maximum, baseline.maximum);
  assert.notEqual(reading.maximum, 130);

  const onlyFormingHour = readingOf({
    h1: [...scenario.h1.slice(0, 23), forming],
    m15: scenario.m15,
  });
  assert.equal(onlyFormingHour.state, "UNAVAILABLE");
  assert.match(onlyFormingHour.reason, /1h/);

  const duplicated = readingOf({
    h1: [...scenario.h1, scenario.h1[20]],
    m15: [...scenario.m15, scenario.m15[20]],
  });
  assert.equal(duplicated.state, baseline.state);
  assert.equal(duplicated.maximum, baseline.maximum);
  assert.equal(duplicated.maximumAt, baseline.maximumAt);
  assert.equal(duplicated.originLow, baseline.originLow);
});

test("Critérios de movimentos diferentes não são combinados", () => {
  // Topo global antigo em 104,7 (índice 10) e topo local posterior em 103,2
  // (índice 34). O motor deve permanecer ancorado no topo global.
  const points = [];
  for (let index = 0; index < 4; index++) points.push(101);
  points.push(100);
  for (let index = 5; index <= 10; index++) points.push(100 + (4.5 * (index - 4)) / 6);
  for (let index = 11; index <= 24; index++) points.push(104.5 - (5.5 * (index - 10)) / 14);
  for (let index = 25; index <= 34; index++) points.push(99 + (4 * (index - 24)) / 10);
  for (let index = 35; index <= 47; index++) points.push(103 - (index - 34) / 13);

  const closes = [
    ...Array(12).fill(100),
    100.2, 100.5, 101.0, 102.0, 102.8, 103.4,
    103.8, 104.0, 104.0, 103.8, 103.4, 102.0,
  ];
  const reading = readingOf({ h1: hourly(closes), m15: m15Series(points) });

  assert.equal(reading.maximum, 104.7);
  assert.equal(reading.maximumAt, NOW - 12 * 60 * 60_000 + 10 * M15);
  assert.ok(reading.peakAgeMinutes > TOP_MAX_CONFIRM_AGE_HOURS * 60);
  assert.equal(reading.originLow, 99.8);
  assert.ok(reading.originAt < reading.maximumAt);
  assert.ok(reading.drawdownPct >= TOP_MIN_DRAWDOWN_PCT);
  assert.ok(reading.drawdownPct <= TOP_MAX_WATCH_DRAWDOWN_PCT);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.state, "DECELERATING");
  assert.match(reading.reason, /janela de confirmação de 6h/);
});

test("Transições e diagnósticos seguem a precedência formal", () => {
  const sequence = [
    readingOf(strongScenario()),
    readingOf(expiredScenario()),
    readingOf(negativePreviousScenario()),
    readingOf(confirmedScenario()),
    readingOf(flatScenario()),
  ].map((reading) => reading.state);

  assert.deepEqual(sequence, [
    "STRONG_UPTREND",
    "DECELERATING",
    "TOP_WATCH",
    "EXHAUSTION_CONFIRMED",
    "NEUTRAL",
  ]);

  assert.match(readingOf(strongScenario()).reason, /ainda sustentada/);
  assert.match(readingOf(expiredScenario()).reason, /janela de confirmação de 6h/);
  assert.match(readingOf(negativePreviousScenario()).reason, /Exaustão parcial/);
  assert.match(readingOf(confirmedScenario()).reason, /não representa reversão definitiva/);
  assert.match(readingOf(flatScenario()).reason, /Sem alta relevante suficiente/);
  assert.doesNotMatch(readingOf(flatScenario()).reason, /[45]\/5/);
});

test("Sem alta relevante com sinais parciais: diagnóstico não sugere confirmação", () => {
  const closes = [
    ...Array(12).fill(101),
    101, 101.05, 101.1, 101.15, 101.2, 101.22,
    101.24, 101.25, 101.26, 101.25, 101.23, 101.2,
  ];
  const reading = readingOf({
    h1: hourly(closes),
    m15: peakSeries({ peakIndex: 31, peakClose: 101.3, lastClose: 101.2 }),
  });
  assert.equal(reading.state, "NEUTRAL");
  assert.match(reading.reason, /^Sinais técnicos parciais identificados, mas condição de alta relevante não atendida\./);
  assert.doesNotMatch(reading.reason, /[45]\/5/);
  assert.equal(reading.criteria.length, 5);
  assert.ok(reading.criteria.filter((item) => item.met).length >= 2);
});

test("Idade do topo usa o timestamp do candle e não o próximo fechamento", () => {
  const scenario = confirmedScenario();
  const later = NOW + 75 * 60_000;
  const fresh = analyzeTopRadar({
    ...scenario,
    fetchedAt: later - 30_000,
    now: later,
  });
  assert.notEqual(fresh.state, "UNAVAILABLE");
  assert.equal(fresh.state, "EXHAUSTION_CONFIRMED");
  assert.ok(fresh.peakAgeMinutes > 4 * 60);

  const stale = analyzeTopRadar({
    ...scenario,
    fetchedAt: later - 2 * 60_000 - 1,
    now: later,
  });
  assert.equal(stale.state, "UNAVAILABLE");
  assert.match(stale.reason, /2 minutos/);
});

test("Perda da EMA9 de 15m é medida no último fechamento completo", () => {
  const reading = readingOf(confirmedScenario());
  assert.equal(criterion(reading, "ema15").met, true);
  assert.ok(reading.lastClose15m < reading.ema9_15m);
  assert.match(criterion(reading, "ema15").value, /</);
});

test("Cinco critérios com filtro 1H reprovado: TOPO EM OBSERVAÇÃO", () => {
  const scenario = confirmedScenario();
  const highs = Array(24);
  highs[22] = 102.9; // máxima anterior rebaixada: filtro 1H reprovado
  scenario.h1 = hourly(FILTER_H1_CLOSES, highs);
  const reading = readingOf(scenario);
  assert.equal(reading.criteria.filter((item) => item.met).length, 5);
  assert.equal(reading.h1Filter.met, false);
  assert.equal(reading.confirmed, false);
  assert.equal(reading.state, "TOP_WATCH");
  assert.equal(reading.label, "TOPO EM OBSERVAÇÃO");
  assert.equal(reading.tone, "cyan");
  assert.equal(reading.action, "OBSERVAR POSSÍVEL REALIZAÇÃO");
  assert.match(reading.reason, /Exaustão parcial/);
});

test("Dados desatualizados, inválidos ou desalinhados: UNAVAILABLE", () => {
  const stale = readingOf(confirmedScenario(), NOW - 2 * 60_000 - 1);
  assert.equal(stale.state, "UNAVAILABLE");
  assert.match(stale.action, /AGUARDAR DADOS/);

  assert.equal(analyzeTopRadar({ h1: [], m15: [], fetchedAt: null, now: NOW }).state, "UNAVAILABLE");

  const invalid = confirmedScenario();
  invalid.m15[30] = { ...invalid.m15[30], high: 50, low: 120 };
  assert.equal(readingOf(invalid).state, "UNAVAILABLE");

  const misaligned = confirmedScenario();
  misaligned.m15 = misaligned.m15.map((candle) => ({
    ...candle,
    openTime: candle.openTime - H1,
    closeTime: candle.closeTime - H1,
  }));
  const misalignedReading = readingOf(misaligned);
  assert.equal(misalignedReading.state, "UNAVAILABLE");
  assert.match(misalignedReading.reason, /alinhamento temporal/);
});

test("Consistência entre estado, badge, diagnóstico e ação", () => {
  const expected = [
    {
      reading: readingOf(strongScenario()),
      label: "ALTA FORTE",
      tone: "green",
      badge: "ALTA SUSTENTADA",
      action: "MANTER OBSERVAÇÃO",
    },
    {
      reading: readingOf(expiredScenario()),
      label: "ALTA DESACELERANDO",
      tone: "amber",
      badge: "PERDENDO FORÇA",
      action: "MONITORAR ENFRAQUECIMENTO",
    },
    {
      reading: readingOf(confirmedScenario()),
      label: "EXAUSTÃO CONFIRMADA",
      tone: "red",
      badge: "5/5 + 1H",
      action: "AVALIAR REALIZAÇÃO PARCIAL",
    },
  ];
  for (const item of expected) {
    assert.equal(item.reading.label, item.label);
    assert.equal(item.reading.tone, item.tone);
    assert.equal(item.reading.badge, item.badge);
    assert.equal(item.reading.action, item.action);
    assert.equal(item.reading.criteria.length, 5);
    assert.equal(item.reading.h1Filter.conditions.length, 3);
    assert.ok(item.reading.reason.length > 20);
  }
});

test("Sem alta relevante: estado neutro de dados válidos, nunca ALTA FORTE", () => {
  const reading = readingOf(flatScenario());
  assert.equal(reading.state, "NEUTRAL");
  assert.equal(reading.label, "SEM ALTA RELEVANTE");
  assert.equal(reading.tone, "gray");
  assert.equal(reading.action, "SEM ALTA RELEVANTE — AGUARDAR");
  assert.equal(reading.confirmed, false);
  assert.match(reading.reason, /Sem alta relevante suficiente/);
});

test("Sem regressão no Caça-Fundos: motor de freio continua intacto", () => {
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
  const h1 = hourly(closes, highs, lows);
  const m15Points = [];
  for (let index = 0; index < 48; index++) {
    if (index <= 12) m15Points.push(100);
    else if (index === 13) m15Points.push(93.2);
    else if (index < 24) m15Points.push(94);
    else if (index < 40) m15Points.push(94.6);
    else m15Points.push(95);
  }
  m15Points[47] = 95.04;
  const m15 = m15Series(
    m15Points,
    { lowAt: { 13: 93 } },
  );
  const brake = analyzeBrakeRadar({ h1, m15, fetchedAt: NOW - 1_000, now: NOW });
  assert.equal(brake.state, "REACTION");
  assert.equal(brake.tone, "green");
  assert.match(brake.action, /DCA 1 LIBERADO/);
});

test("Integração: wrapper preserva Caça-Fundos e adiciona Caça-Topos", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /import \{ BtcRadarReversal \} from "\.\/BtcRadarReversal"/);
  assert.match(page, /import "\.\/radar-reversal\.css"/);
  const nexus = page.indexOf("<ConfluencePanel");
  const radar = page.indexOf("<BtcRadarReversal");
  const position = page.indexOf("<PositionPanel");
  assert.ok(nexus >= 0 && radar > nexus && position > radar, "ordem NEXUS → Radar de Reversão → PositionPanel");

  const wrapper = await readFile(new URL("../app/BtcRadarReversal.tsx", import.meta.url), "utf8");
  assert.match(wrapper, /BITCOIN — RADAR DE REVERSÃO/);
  assert.match(wrapper, /CAÇA-FUNDOS/);
  assert.match(wrapper, /CAÇA-TOPOS/);
  assert.match(wrapper, /<BtcBrakeRadar/);
  assert.match(wrapper, /<BtcTopRadar/);
  assert.match(wrapper, /useState<RadarTab>\("fundos"\)/);

  const top = await readFile(new URL("../app/BtcTopRadar.tsx", import.meta.url), "utf8");
  assert.match(top, /MOVIMENTO RECENTE \(3H\)/);
  assert.match(top, /RECUO DO TOPO/);
  assert.match(top, /IDADE DO TOPO/);
  assert.match(top, /Mínima de origem/);
  assert.match(top, /Máxima monitorada/);
  assert.match(top, /Alta até o topo/);
  assert.match(top, /peakAgeText\(reading\)/);
  assert.match(top, /Fechamento 15m \(base do recuo\)/);
  assert.match(top, /Spot ao vivo \(informativo\)/);
  assert.match(top, /referencePrice = reading\.lastClose15m/);
  assert.match(top, /EMA9 15m/);
  assert.match(top, /DIAGNÓSTICO TÉCNICO/);
  assert.match(top, /Confirmação estrutural 1H/);
  assert.match(top, /TOP_MAX_CONFIRM_AGE_HOURS/);

  const css = await readFile(new URL("../app/radar-reversal.css", import.meta.url), "utf8");
  assert.match(css, /\.rrTabs/);
  assert.match(css, /\.trDiag/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
