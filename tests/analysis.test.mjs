import assert from "node:assert/strict";
import test from "node:test";

import { analyze, scoreDistanceLabel, scoreLabel, wilderAdx, wilderRsi } from "../lib/analysis.ts";
import { buildLocalAiPreview } from "../lib/ai.ts";
import {
  alertBand,
  bitcoinMovement,
  alertKind,
  alertTransition,
  capitulationConfirmed,
  capitulationDetected,
  sellingPressureStabilized,
  shouldDeliverAlert,
  subscriberCommand,
} from "../lib/alerts.ts";
import { mapSettledWithConcurrency } from "../lib/concurrency.ts";
import { latestNuplReading } from "../lib/nupl.ts";

function marketFromCloses(closes, options = {}) {
  const { volume = 100, spread = 1 } = options;
  return {
    asset: "TESTE",
    pair: "TESTE/USDT",
    source: "fixture",
    updatedAt: 1,
    period: "1H",
    candles: closes.map((close, index) => ({
      time: index,
      open: close,
      high: close + spread,
      low: close - spread,
      close,
      volume: index === closes.length - 1 ? volume : 100,
    })),
  };
}

test("classifica exatamente as faixas públicas da nota", () => {
  assert.equal(scoreLabel(55), "COMPRA FORTE");
  assert.equal(scoreLabel(20), "COMPRA");
  assert.equal(scoreLabel(19), "NEUTRO • VIÉS DE ALTA");
  assert.equal(scoreLabel(10), "NEUTRO • VIÉS DE ALTA");
  assert.equal(scoreLabel(9), "NEUTRO");
  assert.equal(scoreLabel(-9), "NEUTRO");
  assert.equal(scoreLabel(-10), "NEUTRO • VIÉS DE BAIXA");
  assert.equal(scoreLabel(-19), "NEUTRO • VIÉS DE BAIXA");
  assert.equal(scoreLabel(-20), "VENDA");
  assert.equal(scoreLabel(-55), "VENDA FORTE");
  assert.equal(scoreDistanceLabel(-17), "3 pts para Venda.");
});

test("RSI de Wilder reconhece sequências direcionais", () => {
  const rising = wilderRsi(Array.from({ length: 30 }, (_, index) => index + 1));
  const falling = wilderRsi(Array.from({ length: 30 }, (_, index) => 30 - index));
  assert.equal(rising?.value, 100);
  assert.equal(falling?.value, 0);
});

test("motor rejeita histórico insuficiente", () => {
  assert.equal(analyze(marketFromCloses(Array(54).fill(100))), null);
});

test("motor mantém sinais nomeados e pontuação determinística", () => {
  const closes = Array.from({ length: 60 }, (_, index) => 100 + index);
  const first = analyze(marketFromCloses(closes, { volume: 150 }));
  const second = analyze(marketFromCloses(closes, { volume: 150 }));

  assert.deepEqual(first, second);
  assert.equal(first?.signals.filter((signal) => !signal.context).length, 5);
  assert.deepEqual(
    first?.signals.filter((signal) => !signal.context).map((signal) => signal.group),
    ["Tendência", "Padrão", "Momentum", "Volume", "Risco"],
  );
  assert.equal(first?.signals[0].score, 24);
  assert.equal(first?.signals[3].score, 4);
  assert.ok(Number.isFinite(first?.score));
  assert.ok(Number.isFinite(first?.confidence));
});

test("mercado sem amplitude não produz NaN", () => {
  const result = analyze(marketFromCloses(Array(60).fill(100), { spread: 0 }));
  assert.ok(result);
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.signals.every((signal) => !signal.detail.includes("NaN")));
});
test("limita consultas paralelas sem perder resultados", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapSettledWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  assert.equal(peak, 3);
  assert.deepEqual(
    results.map((result) => result.status === "fulfilled" ? result.value : null),
    [2, 4, 6, 8, 10, 12],
  );
});
test("ADX distingue tendência forte de mercado sem direção", () => {
  const rising = marketFromCloses(Array.from({ length: 60 }, (_, index) => 100 + index)).candles;
  const flat = marketFromCloses(Array(60).fill(100)).candles;
  assert.ok(wilderAdx(rising) >= 25);
  assert.equal(wilderAdx(flat), 0);
});

test("RSI esticado aponta venda e RSI sobrevendido aponta compra", () => {
  const rising = analyze(marketFromCloses(Array.from({ length: 60 }, (_, index) => 100 + index)));
  const falling = analyze(marketFromCloses(Array.from({ length: 60 }, (_, index) => 200 - index)));

  assert.equal(rising?.extreme.tone, "negative");
  assert.match(rising?.extreme.status ?? "", /^VENDA/);
  assert.ok((rising?.signals[2].score ?? 0) < 0);

  assert.equal(falling?.extreme.tone, "positive");
  assert.match(falling?.extreme.status ?? "", /^COMPRA/);
  assert.ok((falling?.signals[2].score ?? 0) > 0);
});

test("Termômetro e painel de extremo usam o mesmo RSI de Wilder", () => {
  const result = analyze(marketFromCloses(Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index / 3) * 5 + index * 0.2)));
  assert.ok(result);
  assert.equal(result.signals[2].summary, `RSI em ${result.extreme.rsi.toFixed(1)}`);
  assert.ok(Number.isFinite(result.extreme.adx));
  assert.ok(Number.isFinite(result.extreme.atrDistance));
});
test("expõe os novos conceitos como contexto sem alterar a soma", () => {
  const result = analyze(marketFromCloses(Array.from({ length: 60 }, (_, index) => 100 + index)));
  assert.ok(result);
  const contexts = result.signals.filter((signal) => signal.context);
  assert.equal(contexts.length, 3);
  assert.deepEqual(contexts.map((signal) => signal.title), [
    "Força da tendência (ADX)",
    "Divergência RSI–preço",
    "Distância da média (ATR)",
  ]);
  assert.equal(result.score, result.signals.filter((signal) => !signal.context).reduce((sum, signal) => sum + signal.score, 0));
});
test("candle ainda aberto não altera a nota nem o volume", () => {
  const now = Date.UTC(2026, 6, 28, 18, 30);
  const base = marketFromCloses(Array.from({ length: 60 }, (_, index) => 100 + index * 0.2));
  base.candles = base.candles.map((candle, index) => ({
    ...candle,
    time: now - (base.candles.length - index) * 60 * 60_000,
  }));
  const openCandle = {
    time: now - 30 * 60_000,
    open: 112,
    high: 260,
    low: 80,
    close: 250,
    volume: 1,
  };
  const confirmed = analyze(base, now);
  const withOpenCandle = analyze({ ...base, candles: [...base.candles, openCandle] }, now);
  assert.deepEqual(withOpenCandle, confirmed);
  assert.match(withOpenCandle.signals[3].summary, /candle encerrado/);
});
test("alerta dispara somente nas transições relevantes de compra", () => {
  assert.equal(alertBand(19), "FORA");
  assert.equal(alertBand(20), "COMPRA");
  assert.equal(alertBand(55), "COMPRA_FORTE");
  assert.equal(alertTransition(undefined, "COMPRA"), null);
  assert.equal(alertTransition("FORA", "COMPRA"), "ENTRADA");
  assert.equal(alertTransition("COMPRA", "COMPRA"), null);
  assert.equal(alertTransition("COMPRA", "COMPRA_FORTE"), "FORTALECEU");
  assert.equal(alertTransition("COMPRA_FORTE", "COMPRA"), "ENFRAQUECEU");
  assert.equal(alertTransition("COMPRA", "FORA"), "ENCERROU");
});
test("interpreta os comandos simples dos amigos", () => {
  assert.equal(subscriberCommand("/start"), "START");
  assert.equal(subscriberCommand("/start convite"), "START");
  assert.equal(subscriberCommand("ativar"), "START");
  assert.equal(subscriberCommand("/parar"), "STOP");
  assert.equal(subscriberCommand("/status"), "STATUS");
  assert.equal(subscriberCommand("/ajuda"), "HELP");
  assert.equal(subscriberCommand("/fortes"), "FORTES");
  assert.equal(subscriberCommand("/todos"), "TODOS");
  assert.equal(subscriberCommand("capitulação"), "CAPITULACAO");
  assert.equal(subscriberCommand("/movimento4"), "MOVEMENT4_ON");
  assert.equal(subscriberCommand("/movimento4 parar"), "MOVEMENT4_OFF");
  assert.equal(subscriberCommand("movimento4 desativar"), "MOVEMENT4_OFF");
  assert.equal(subscriberCommand("olá"), null);
  assert.equal(subscriberCommand(undefined), null);
});
test("filtra alertas conforme a preferência de cada pessoa", () => {
  assert.equal(alertKind("ENTRADA", "COMPRA"), "COMPRA");
  assert.equal(alertKind("FORTALECEU", "COMPRA_FORTE"), "COMPRA_FORTE");
  assert.equal(alertKind("ENFRAQUECEU", "COMPRA", "COMPRA_FORTE"), "SAIDA_FORTE");
  assert.equal(shouldDeliverAlert("FORTES", "COMPRA"), false);
  assert.equal(shouldDeliverAlert("FORTES", "COMPRA_FORTE"), true);
  assert.equal(shouldDeliverAlert("FORTES", "SAIDA_COMPRA"), false);
  assert.equal(shouldDeliverAlert("FORTES", "SAIDA_FORTE"), true);
  assert.equal(shouldDeliverAlert("TODOS", "COMPRA"), true);
  assert.equal(shouldDeliverAlert("CAPITULACAO", "COMPRA_FORTE"), false);
  assert.equal(shouldDeliverAlert("CAPITULACAO", "CAPITULACAO"), true);
});

test("capitulação exige sobrevenda, distância e volume juntos", () => {
  assert.equal(capitulationDetected({ rsi: 29, atrDistance: -2.1, volumeRatio: 1.6 }), true);
  assert.equal(capitulationDetected({ rsi: 31, atrDistance: -2.1, volumeRatio: 1.6 }), false);
  assert.equal(capitulationDetected({ rsi: 29, atrDistance: -1.9, volumeRatio: 1.6 }), false);
  assert.equal(capitulationDetected({ rsi: 29, atrDistance: -2.1, volumeRatio: 1.4 }), false);
});
test("confirma a capitulação somente com nova queda no 5 min e volume", () => {
  assert.equal(capitulationConfirmed({ sourceClose: 100, confirmationClose: 99, volumeRatio: 1.5 }), true);
  assert.equal(capitulationConfirmed({ sourceClose: 100, confirmationClose: 100, volumeRatio: 2 }), false);
  assert.equal(capitulationConfirmed({ sourceClose: 100, confirmationClose: 99, volumeRatio: 1.49 }), false);
});
test("estabilização exige candle positivo sem nova mínima", () => {
  assert.equal(sellingPressureStabilized({ open: 98, close: 99, low: 97, referenceLow: 97, volumeRatio: 1 }), true);
  assert.equal(sellingPressureStabilized({ open: 99, close: 98, low: 97, referenceLow: 97, volumeRatio: 2 }), false);
  assert.equal(sellingPressureStabilized({ open: 98, close: 99, low: 96.9, referenceLow: 97, volumeRatio: 2 }), false);
});
test("alerta de movimento do BTC exige variação acumulada de 4%", () => {
  assert.equal(bitcoinMovement(100_000, 103_999), null);
  assert.equal(bitcoinMovement(100_000, 104_000)?.direction, "ALTA");
  assert.equal(bitcoinMovement(100_000, 96_000)?.direction, "QUEDA");
  assert.ok(Math.abs(bitcoinMovement(104_000, 99_840).changePercent + 4) < 0.000001);
  assert.equal(bitcoinMovement(0, 100_000), null);
});
test("NUPL reutiliza a fase mais recente do Estude Bitcoin", () => {
  const reading = latestNuplReading({
    source: "Checkonchain",
    sourcePage: "https://example.com/nupl",
    updatedAt: "2026-07-29T00:00:00.000Z",
    dates: ["2026-07-28", "2026-07-29"],
    euphoria: [null, null],
    belief: [0.51, 0.52],
    optimism: [null, null],
    hopeFear: [null, null],
    capitulation: [null, null],
  });
  assert.equal(reading.value, 0.52);
  assert.equal(reading.phase, "Cren\u00e7a/Nega\u00e7\u00e3o");
  assert.equal(reading.zone, "belief");
  assert.equal(reading.dataDate, "2026-07-29");
});

test("NUPL rejeita hist�rico sem faixas completas", () => {
  assert.throws(
    () => latestNuplReading({ dates: ["2026-07-29"] }),
    /Faixas do NUPL incompletas/,
  );
});
test("pré-análise local entrega leitura imediata e estruturada", () => {
  const preview = buildLocalAiPreview({
    asset: "BTC",
    period: "1D",
    currentPrice: 65_000,
    score: 26,
    confidence: 67,
    change: 1.2,
    support: 61_824,
    resistance: 68_956,
    entry: 0,
    stop: 0,
    target: 0,
    volumeRatio: 0.8,
    multiRsi: null,
    signals: [],
  });
  assert.equal(preview.scenario, "ALTA");
  assert.match(preview.headline, /BTC/);
  assert.ok(preview.strategy.length >= 2);
  assert.ok(preview.risks.length >= 1);
});