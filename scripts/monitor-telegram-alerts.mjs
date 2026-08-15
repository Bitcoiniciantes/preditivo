import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  alertBand,
  bitcoinMovement,
  alertKind,
  alertTransition,
  capitulationConfirmed,
  capitulationDetected,
  rsiOpportunity,
  sellingPressureStabilized,
  shouldDeliverAlert,
  subscriberCommand,
} from "../lib/alerts.ts";
import { analyze, completedCandles, scoreLabel, wilderRsi } from "../lib/analysis.ts";
import { bitcoinBuyLevel, bitcoinBuyLevels, bitcoinBuyLevelTransition } from "../lib/bitcoin-buy.ts";
import { firebaseHistoryConfigured, saveFirebaseHistory } from "../lib/firebase-history.ts";

const SITE_URL = "https://bitcoiniciantes.github.io/preditivo/";
const STATE_PATH = new URL("../.alert-state/state.json", import.meta.url);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SETUP_TEST = process.env.TELEGRAM_SETUP_TEST === "true";

const monitoredPeriods = ["15M", "1H", "4H", "1D", "1S"];
const baseAssets = [
  { asset: "BTC", period: "15M", source: "binance" },
  { asset: "ETH", period: "15M", source: "binance" },
  { asset: "LINK", period: "15M", source: "binance" },
  { asset: "AVAX", period: "15M", source: "binance" },
  { asset: "PAXG", period: "15M", source: "binance" },
  { asset: "MSTR", period: "1H", source: "static", file: "mstr" },
  { asset: "SPCX", period: "1H", source: "static", file: "spcx" },
  { asset: "QBTS", period: "1H", source: "static", file: "qbts" },
  { asset: "BRENT", period: "1H", source: "static", file: "brent" },
  { asset: "PRATA", period: "1H", source: "static", file: "prata" },
  { asset: "COBRE", period: "1H", source: "static", file: "cobre" },
  { asset: "URÂNIO", marketAsset: "URANIO", period: "1H", source: "static", file: "uranio" },
];
const assets = baseAssets.flatMap((config) =>
  monitoredPeriods.map((period) => ({ ...config, period, primary: period === config.period })),
);

function finiteCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [time, open, high, low, close, volume] = row.slice(0, 6).map(Number);
  if (![time, open, high, low, close, volume].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume };
}

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(12_000),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body;
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw lastError;
}

function periodInterval(period) {
  return { "15M": "15m", "1H": "1h", "4H": "4h", "1D": "1d", "1S": "1w" }[period] ?? "15m";
}

async function marketData(config, interval = periodInterval(config.period)) {
  if (config.source === "binance") {
    const body = await fetchJson(
      `https://data-api.binance.vision/api/v3/klines?symbol=${config.asset}USDT&interval=${interval}&limit=120`,
    );
    const candles = Array.isArray(body) ? body.map(finiteCandle).filter(Boolean) : [];
    if (candles.length < 55) throw new Error("histórico insuficiente");
    return {
      asset: config.asset,
      pair: `${config.asset}/USDT`,
      source: "Binance Public Market Data",
      updatedAt: Date.now(),
      period: interval === "5m" ? "5M" : config.period,
      candles,
    };
  }

  const snapshot = await fetchJson(
    `${SITE_URL}data/${config.file}.json?v=${Math.floor(Date.now() / 60_000)}`,
    { headers: { "User-Agent": "TermometroTelegramAlerts/1.0" } },
  );
  const candles = snapshot?.periods?.[config.period] ?? [];
  if (candles.length < 55) throw new Error("histórico insuficiente");
  const asset = config.marketAsset ?? config.asset;
  return {
    asset,
    pair: `${asset}/USD`,
    source: snapshot.source,
    updatedAt: snapshot.updatedAt,
    period: config.period,
    candles,
  };
}

const DEFAULT_PREFERENCE = "FORTES";

function normalizeSubscribers(subscribers = {}) {
  return Object.fromEntries(
    Object.entries(subscribers).map(([chatId, subscriber]) => {
      const reference = Number(subscriber?.btcMovementReference);
      return [
        chatId,
        {
          active: Boolean(subscriber?.active),
          joinedAt: subscriber?.joinedAt ?? Date.now(),
          preference: subscriber?.preference ?? DEFAULT_PREFERENCE,
          movement4: Boolean(subscriber?.movement4),
          btcMovementReference: Number.isFinite(reference) && reference > 0 ? reference : null,
        },
      ];
    }),
  );
}

function emptyState() {
  return { version: 5, updateOffset: 0, subscribers: {}, readings: {}, capitulationWatch: {} };
}

async function readState() {
  try {
    const content = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(content);
    if ([5, 4, 3, 2].includes(parsed?.version)) {
      return {
        state: {
          version: 5,
          updateOffset: Number(parsed.updateOffset) || 0,
          subscribers: normalizeSubscribers(parsed.subscribers),
          readings: parsed.readings ?? {},
          capitulationWatch: parsed.capitulationWatch ?? {},
        },
        migrated: parsed.version !== 5,
      };
    }
    if (parsed?.version === 1) {
      const subscribers = {};
      if (parsed.chatId) {
        subscribers[String(parsed.chatId)] = {
          active: true,
          joinedAt: Date.now(),
          preference: DEFAULT_PREFERENCE,
          movement4: false,
          btcMovementReference: null,
        };
      }
      return {
        state: {
          version: 5,
          updateOffset: 0,
          subscribers,
          readings: parsed.readings ?? {},
          capitulationWatch: {}
        },
        migrated: true,
      };
    }
  } catch {
    // Primeira execução: o estado será criado depois do primeiro /start.
  }
  return { state: emptyState(), migrated: false };
}
async function saveState(state) {
  await mkdir(new URL("../.alert-state/", import.meta.url), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

function telegramUrl(method) {
  return `https://api.telegram.org/bot${TOKEN}/${method}`;
}

async function botUsername() {
  const response = await fetchJson(telegramUrl("getMe"));
  if (!response?.result?.username) throw new Error("Username do bot não localizado");
  return response.result.username;
}

async function getUpdates(offset) {
  const response = await fetchJson(
    `${telegramUrl("getUpdates")}?offset=${offset}&limit=100&timeout=0`,
  );
  return Array.isArray(response?.result) ? response.result : [];
}

async function sendMessage(chatId, text) {
  const result = await fetchJson(telegramUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!result?.ok) throw new Error("Telegram recusou a mensagem");
}

function preferenceLabel(preference) {
  if (preference === "TODOS") return "todas as condições + oportunidades de RSI + possível capitulação";
  if (preference === "CAPITULACAO") return "somente possível capitulação";
  return "Compra Forte + oportunidades de RSI + possível capitulação";
}

function welcomeMessage(preference = DEFAULT_PREFERENCE, movement4 = false) {
  return [
    "TERM\u00d4METRO PREDITIVO",
    "",
    `Seu modo: ${preferenceLabel(preference)}.`,
    `Movimento de 4% do BTC: ${movement4 ? "ativado" : "desativado"}.`,
    "Criptomoedas: candles encerrados de 15 minutos.",
    "MSTR, SPCX, QBTS, BRENT, prata, cobre e urânio: candles encerrados de 1 hora.",
    "Oportunidades de RSI: candles encerrados de 15M, 1H, 4H, 1D e 1S.",
    "",
    "Para mudar:",
    "/fortes — Compra Forte + oportunidades RSI + capitulação (recomendado)",
    "/todos — Compra, Compra Forte, saídas + oportunidades RSI + capitulação",
    "/capitulacao — somente quedas extremas",
    "/movimento4 — avisar a cada ±4% do BTC",
    "/movimento4 parar — desativar esse aviso",
    "/status — consultar o monitoramento",
    "/parar — deixar de receber alertas",
  ].join("\n");
}

function statusMessage(subscriber) {
  return subscriber?.active
    ? [
        "✅ Alertas ativos.",
        `Modo técnico: ${preferenceLabel(subscriber.preference ?? DEFAULT_PREFERENCE)}.`,
        `Movimento de 4% do BTC: ${subscriber.movement4 ? "ativado" : "desativado"}.`,
      ].join("\n")
    : "⏸ Seus alertas estão pausados. Para voltar a receber, envie /start.";
}

function helpMessage() {
  return [
    "COMANDOS DO TERMÔMETRO",
    "",
    "/start — ativar os alertas",
    "/fortes — Compra Forte + oportunidades RSI + capitulação",
    "/todos — todas as condições, saídas e oportunidades RSI",
    "/capitulacao — somente possível capitulação",
    "/movimento4 — avisar a cada alta ou queda de 4% do BTC",
    "/movimento4 parar — desativar o aviso de 4%",
    "/status — verificar seu modo",
    "/parar — deixar de receber",
    "",
    "Possível capitulação é uma queda extrema com volume; não confirma fundo nem recomenda compra.",
  ].join("\n");
}

function preferenceMessage(preference) {
  return [
    "✅ PREFERÊNCIA ATUALIZADA",
    "",
    `Agora você receberá: ${preferenceLabel(preference)}.`,
    "Envie /status quando quiser conferir.",
  ].join("\n");
}

function movementPreferenceMessage(active) {
  return active
    ? [
        "✅ ALERTA DE 4% DO BTC ATIVADO",
        "",
        "A referência será definida no próximo candle de 15 minutos encerrado.",
        "Depois de cada alta ou queda de 4%, o preço alertado vira a nova referência.",
        "Para desativar, envie /movimento4 parar.",
      ].join("\n")
    : "⏸ Alerta de 4% do BTC desativado. Para reativar, envie /movimento4.";
}

function updatedSubscriber(existing, overrides = {}) {
  return {
    active: Boolean(existing?.active),
    joinedAt: existing?.joinedAt ?? Date.now(),
    preference: existing?.preference ?? DEFAULT_PREFERENCE,
    movement4: Boolean(existing?.movement4),
    btcMovementReference: existing?.btcMovementReference ?? null,
    ...overrides,
  };
}

async function processSubscriberUpdates(state) {
  const updates = await getUpdates((state.updateOffset || 0) + 1);
  if (!updates.length) return { changed: false, commands: 0 };

  state.updateOffset = Math.max(...updates.map((update) => Number(update.update_id) || 0));
  const latestByChat = new Map();

  for (const update of updates) {
    const message = update.message;
    if (message?.chat?.type !== "private") continue;
    const command = subscriberCommand(message.text);
    if (!command) continue;
    latestByChat.set(String(message.chat.id), command);
  }

  for (const [chatId, command] of latestByChat) {
    const existing = state.subscribers[chatId];
    if (command === "START") {
      state.subscribers[chatId] = updatedSubscriber(existing, { active: true });
      await sendMessage(
        chatId,
        welcomeMessage(state.subscribers[chatId].preference, state.subscribers[chatId].movement4),
      );
    } else if (command === "STOP") {
      await sendMessage(chatId, "⏸ Alertas pausados. Quando quiser voltar, envie /start.");
      state.subscribers[chatId] = updatedSubscriber(existing, { active: false });
    } else if (command === "STATUS") {
      await sendMessage(chatId, statusMessage(existing));
    } else if (command === "HELP") {
      await sendMessage(chatId, helpMessage());
    } else if (command === "MOVEMENT4_ON") {
      state.subscribers[chatId] = updatedSubscriber(existing, {
        active: true,
        movement4: true,
        btcMovementReference: null,
      });
      await sendMessage(chatId, movementPreferenceMessage(true));
    } else if (command === "MOVEMENT4_OFF") {
      state.subscribers[chatId] = updatedSubscriber(existing, {
        movement4: false,
        btcMovementReference: null,
      });
      await sendMessage(chatId, movementPreferenceMessage(false));
    } else {
      state.subscribers[chatId] = updatedSubscriber(existing, {
        active: true,
        preference: command,
      });
      await sendMessage(chatId, preferenceMessage(command));
    }
  }

  return { changed: true, commands: latestByChat.size };
}
function activeSubscribers(state, kind = null) {
  return Object.entries(state.subscribers)
    .filter(([, subscriber]) =>
      subscriber?.active &&
      (!kind || shouldDeliverAlert(subscriber.preference ?? DEFAULT_PREFERENCE, kind)))
    .map(([chatId]) => chatId);
}

async function broadcast(state, text, kind = null) {
  let delivered = 0;
  let disabled = 0;
  let failed = 0;

  for (const chatId of activeSubscribers(state, kind)) {
    try {
      await sendMessage(chatId, text);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/HTTP (400|403)/.test(message)) {
        state.subscribers[chatId].active = false;
        disabled += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { delivered, disabled, failed };
}
function localTime(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function signalSummary(reading, group) {
  return reading.signals.find((signal) => signal.group === group)?.summary;
}

function formatQuote(config, value) {
  if (config.source === "binance") return formatUsdt(value);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function alertMessage(config, reading, transition, candleTime, currentPrice) {
  const icon = transition === "ENCERROU" ? "⚪" : transition === "FORTALECEU" ? "🚀" : "🟢";
  const title =
    transition === "ENCERROU"
      ? "CONDIÇÃO DE COMPRA ENCERRADA"
      : transition === "FORTALECEU"
        ? "CONDIÇÃO DE COMPRA FORTALECEU"
        : transition === "ENFRAQUECEU"
          ? "CONDIÇÃO CONTINUA, MAS PERDEU FORÇA"
          : "NOVA CONDIÇÃO TÉCNICA DE COMPRA";
  const details = [
    signalSummary(reading, "Momentum"),
    `ADX ${reading.extreme.adx.toFixed(1)}`,
    signalSummary(reading, "Volume"),
  ].filter(Boolean);

  return [
    `${icon} ${title}`,
    "",
    `Ativo: ${config.asset}`,
    `Cotação atual: ${formatQuote(config, currentPrice)}`,
    `Período: ${config.period}`,
    `Nota: ${reading.score >= 0 ? "+" : ""}${reading.score} • ${scoreLabel(reading.score)}`,
    `Concordância dos sinais: ${reading.confidence}%`,
    ...details,
    `Candle encerrado: ${localTime(candleTime)}`,
    "",
    SITE_URL,
    "",
    "Alerta técnico educacional. Não representa garantia de resultado ou recomendação personalizada.",
  ].join("\n");
}
function rsiOpportunityMessage(config, reading, opportunity, candleTime, currentPrice) {
  const isBuy = opportunity.startsWith("COMPRA");
  const title = opportunity === "COMPRA_RETESTE_15M"
    ? "🟢 OPORTUNIDADE DE COMPRA — AGUARDAR RETESTE"
    : isBuy
      ? "🟢 OPORTUNIDADE DE COMPRA"
      : "🔴 OPORTUNIDADE DE VENDA";
  const instruction = opportunity === "COMPRA_RETESTE_15M"
    ? "RSI abaixo de 18 no candle encerrado de 15 minutos. Aguarde o reteste e a estabilização do preço antes de considerar uma entrada."
    : opportunity === "COMPRA_4H"
      ? "RSI em 20 ou menos no gráfico de 4 horas. Sobrevenda extrema; aguarde estabilização ou confirmação da reação."
      : opportunity === "COMPRA_BRENT_1H"
        ? "BRENT (BZ=F) com RSI abaixo de 21 no gráfico de 1 hora. Aguarde estabilização ou confirmação da reação."
        : opportunity === "VENDA_BRENT_1H"
          ? "BRENT (BZ=F) com RSI acima de 80 no gráfico de 1 hora. Aguarde enfraquecimento ou perda de suporte para confirmar a venda."
          : opportunity === "COMPRA_LINK_1H" || opportunity === "COMPRA_LINK_4H"
            ? `LINK com RSI abaixo de 25 no gráfico de ${config.period}. Aguarde estabilização ou confirmação da reação.`
            : "RSI acima do limite definido para este período. Aguarde enfraquecimento, divergência de baixa ou perda de suporte para confirmar a venda.";

  return [
    title,
    "",
    `Ativo: ${config.asset}`,
    `Cotação atual: ${formatQuote(config, currentPrice)}`,
    `Período: ${config.period}`,
    `RSI: ${reading.extreme.rsi.toFixed(1)}`,
    `Nota do Termômetro: ${reading.score >= 0 ? "+" : ""}${reading.score} • ${scoreLabel(reading.score)}`,
    `Candle encerrado: ${localTime(candleTime)}`,
    "",
    instruction,
    "",
    SITE_URL,
    "",
    "Alerta técnico educacional. Não representa garantia de resultado ou recomendação personalizada.",
  ].join("\n");
}

function volumeRatio(candles) {
  const previous = candles.slice(-21, -1);
  const average = previous.reduce((sum, candle) => sum + candle.volume, 0) / Math.max(previous.length, 1);
  return candles.at(-1).volume / Math.max(average, 1);
}

function formatUsdt(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value).replace("US$", "USDT");
}

function bitcoinBuyLevelMessage(level, candle) {
  const rule = bitcoinBuyLevels[level];
  return [
    "ALERTA BTC: " + rule.action,
    "",
    "Pavio / minima atingiu: " + formatUsdt(candle.low),
    "Patamar de compra: " + formatUsdt(rule.ceiling),
    "Cotacao atual: " + formatUsdt(candle.close),
    "Candle em formacao: alerta emitido sem aguardar fechamento.",
    "Monitoramento: preco de mercado consultado a cada 5 minutos.",
    "Candle abriu: " + localTime(candle.time),
    "",
    SITE_URL,
  ].join("\n");
}
function rsiExtremeBand(rsi) {
  if (rsi < 20) return "SOBREVENDA";
  if (rsi > 80) return "SOBRECOMPRA";
  return null;
}
function rsiExtremeMessage(config, rsi, candle) {
  const buySignal = rsiExtremeBand(rsi) === "SOBREVENDA";
  return [
    buySignal ? "COMPRA: RSI SOBREVENDIDO" : "VENDA: RSI ESTICADO",
    "",
    "Ativo: " + config.asset,
    "Cotacao atual: " + formatUsdt(candle.close),
    "Periodo: " + config.period,
    "RSI: " + rsi.toFixed(1),
    "Leitura: " + (buySignal ? "Possivel reversao de alta" : "Possivel reversao de baixa"),
    "Candle ainda aberto; leitura emitida sem aguardar fechamento.",
    "",
    SITE_URL,
  ].join("\n");
}

function bitcoinMovementMessage(movement, reference, current, candleTime) {
  const rising = movement.direction === "ALTA";
  return [
    `${rising ? "📈" : "📉"} BTC ${rising ? "SUBIU" : "CAIU"} ${Math.abs(movement.changePercent).toFixed(2)}%`,
    "",
    `Referência anterior: ${formatUsdt(reference)}`,
    `Preço no candle encerrado: ${formatUsdt(current)}`,
    "Período: 15 minutos",
    `Candle encerrado: ${localTime(candleTime)}`,
    "",
    "Este preço passa a ser a nova referência para o próximo movimento de 4%.",
    "",
    SITE_URL,
    "",
    "Aviso de variação de preço. Não representa sinal de compra ou venda.",
  ].join("\n");
}
function capitulationMessage(config, reading, ratio, candleTime, currentPrice) {
  return [
    "⚠️ POSSÍVEL CAPITULAÇÃO",
    "",
    `Ativo: ${config.asset}`,
    `Cotação atual: ${formatQuote(config, currentPrice)}`,
    `Período: ${config.period}`,
    `RSI: ${reading.extreme.rsi.toFixed(1)}`,
    `Distância: ${reading.extreme.atrDistance.toFixed(1)} ATR da MM20`,
    `Volume: ${ratio.toFixed(2)}× a média`,
    `Candle encerrado: ${localTime(candleTime)}`,
    "",
    "Queda extrema com volume detectada. Pode anteceder uma oportunidade, mas também pode continuar caindo: aguarde estabilização ou confirmação.",
    "",
    SITE_URL,
    "",
    "Alerta técnico educacional. Não confirma fundo nem representa recomendação personalizada.",
  ].join("\n");
}
function capitulationConfirmedMessage(config, watch, candle, ratio) {
  return [
    "⚠️ CAPITULAÇÃO EM CONFIRMAÇÃO",
    "",
    `Ativo: ${config.asset}`,
    `Cotação atual: ${formatQuote(config, candle.close)}`,
    "Sequência: queda extrema no 15 min + nova queda no 5 min",
    `Volume do 5 min: ${ratio.toFixed(2)}× a média`,
    `Candle de 5 min encerrado: ${localTime(candle.time)}`,
    "",
    "A pressão vendedora continuou após a queda inicial. Isto não confirma fundo nem é sinal de compra; aguarde estabilização.",
    "",
    SITE_URL,
    "",
    "Alerta técnico educacional. Não representa recomendação personalizada.",
  ].join("\n");
}

function stabilizationMessage(config, candle, ratio) {
  return [
    "🟡 PRESSÃO VENDEDORA PERDEU FORÇA",
    "",
    `Ativo: ${config.asset}`,
    `Cotação atual: ${formatQuote(config, candle.close)}`,
    "Após a capitulação em confirmação, surgiu um candle positivo de 5 min sem nova mínima.",
    `Volume do 5 min: ${ratio.toFixed(2)}× a média`,
    `Candle encerrado: ${localTime(candle.time)}`,
    "",
    "É um sinal de estabilização, não uma confirmação de compra. Observe a estrutura e os próximos candles.",
    "",
    SITE_URL,
    "",
    "Alerta técnico educacional. Não representa recomendação personalizada.",
  ].join("\n");
}
async function checkCapitulationWatch(config, key, state, pendingMessages, historyEvents) {
  const watch = state.capitulationWatch?.[key];
  if (!watch || config.source !== "binance") return false;

  const fiveMinuteMarket = await marketData(config, "5m");
  const closed = completedCandles(fiveMinuteMarket.candles, "5M");
  if (!closed.length) return false;

  if (watch.stage === "PENDING") {
    const confirmationStart = watch.sourceCandleTime + 15 * 60_000;
    const confirmation = closed.find((candle) => candle.time >= confirmationStart);
    if (!confirmation) return false;

    const ratio = volumeRatio(closed.slice(0, closed.findIndex((candle) => candle.time === confirmation.time) + 1));
    if (capitulationConfirmed({
      sourceClose: watch.sourceClose,
      confirmationClose: confirmation.close,
      volumeRatio: ratio,
    })) {
      pendingMessages.push({
        kind: "CAPITULACAO",
        text: capitulationConfirmedMessage(config, watch, confirmation, ratio),
      });
      historyEvents.push({
        asset: config.asset,
        period: "5M",
        candleTime: confirmation.time,
        type: "CAPITULACAO_CONFIRMADA",
        score: watch.score,
        detail: `queda no 5M • volume ${ratio.toFixed(2)}x`,
      });
      state.capitulationWatch[key] = {
        ...watch,
        stage: "CONFIRMED",
        confirmationCandleTime: confirmation.time,
        referenceLow: confirmation.low,
        expiresAt: confirmation.time + 60 * 60_000,
      };
    } else {
      delete state.capitulationWatch[key];
    }
    return true;
  }

  if (watch.stage === "CONFIRMED") {
    const candle = closed.at(-1);
    if (!candle || candle.time <= watch.confirmationCandleTime || candle.time === watch.lastCheckedCandleTime) return false;
    if (candle.time > watch.expiresAt) {
      delete state.capitulationWatch[key];
      return true;
    }

    const ratio = volumeRatio(closed);
    watch.lastCheckedCandleTime = candle.time;
    if (sellingPressureStabilized({
      open: candle.open,
      close: candle.close,
      low: candle.low,
      referenceLow: watch.referenceLow,
      volumeRatio: ratio,
    })) {
      pendingMessages.push({
        kind: "CAPITULACAO",
        text: stabilizationMessage(config, candle, ratio),
      });
      historyEvents.push({
        asset: config.asset,
        period: "5M",
        candleTime: candle.time,
        type: "ESTABILIZACAO_APOS_CAPITULACAO",
        score: watch.score,
        detail: `candle positivo sem nova mínima • volume ${ratio.toFixed(2)}x`,
      });
      delete state.capitulationWatch[key];
    }
    return true;
  }

  delete state.capitulationWatch[key];
  return true;
}
async function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN não configurado");

  const username = await botUsername();
  const { state, migrated } = await readState();
  let stateChanged = migrated;
  const subscriberUpdates = await processSubscriberUpdates(state);
  stateChanged ||= subscriberUpdates.changed;

  let successful = 0;
  const errors = [];
  const pendingMessages = [];
  const directMessages = [];
  const movementEventTypes = new Set();
  const historyReadings = [];
  const historyEvents = [];

  for (const config of assets) {
    try {
      const market = await marketData(config);
      const closed = completedCandles(market.candles, config.period);
      const lastClosed = closed.at(-1);
      const hasOpenCandle = market.candles.length > closed.length;
      const currentCandle = market.candles.at(-1);
      const intrabarRsi = wilderRsi(market.candles.map((candle) => candle.close))?.value;
      const reading = analyze(market);
      if (!reading || !lastClosed || !currentCandle || intrabarRsi === undefined) throw new Error("leitura indisponível");

      successful += 1;
      const key = `${config.marketAsset ?? config.asset}-${config.period}`;
      const currentBand = alertBand(reading.score);
      const previous = state.readings[key];
      const currentBitcoinBuyLevel = config.asset === "BTC" && config.primary ? bitcoinBuyLevel(currentCandle.low) : null;
      const bitcoinBuyTransition = config.asset === "BTC" && config.primary ? bitcoinBuyLevelTransition(previous?.bitcoinBuyLevel, currentBitcoinBuyLevel) : null;
      const currentRsiExtreme = hasOpenCandle ? rsiExtremeBand(intrabarRsi) : null;
      const previousRsiExtreme = previous?.rsiExtreme ?? null;
      if (currentRsiExtreme && currentRsiExtreme !== previousRsiExtreme) {
        pendingMessages.push({ kind: "CAPITULACAO", text: rsiExtremeMessage(config, intrabarRsi, currentCandle) });
        historyEvents.push({ asset: config.asset, period: config.period, candleTime: currentCandle.time, type: "RSI_INTRABAR_" + currentRsiExtreme, score: reading.score, detail: "RSI " + intrabarRsi.toFixed(1) + " • candle em formação" });
      }
      if (bitcoinBuyTransition) {
        pendingMessages.push({ kind: "BTC_COMPRA", text: bitcoinBuyLevelMessage(bitcoinBuyTransition, currentCandle) });
        historyEvents.push({ asset: "BTC", period: config.period, candleTime: currentCandle.time, type: "BTC_" + bitcoinBuyTransition, score: reading.score, detail: "pavio " + currentCandle.low.toFixed(2) + " USDT | atual " + currentCandle.close.toFixed(2) + " USDT" });
      }
      const watchChanged = config.primary
        ? await checkCapitulationWatch(
            config,
            key,
            state,
            pendingMessages,
            historyEvents,
          )
        : false;
      stateChanged ||= watchChanged;

      if (previous?.candleTime === lastClosed.time) {
        state.readings[key] = { ...previous, rsiExtreme: currentRsiExtreme, bitcoinBuyLevel: currentBitcoinBuyLevel, checkedAt: Date.now() };
        stateChanged ||= previous?.bitcoinBuyLevel !== currentBitcoinBuyLevel || previousRsiExtreme !== currentRsiExtreme;
        continue;
      }

      if (config.asset === "BTC" && config.primary) {
        for (const [chatId, subscriber] of Object.entries(state.subscribers)) {
          if (!subscriber?.active || !subscriber?.movement4) continue;
          const reference = Number(subscriber.btcMovementReference);
          if (!Number.isFinite(reference) || reference <= 0) {
            subscriber.btcMovementReference = lastClosed.close;
            stateChanged = true;
            continue;
          }
          const movement = bitcoinMovement(reference, lastClosed.close);
          if (!movement) continue;
          directMessages.push({
            chatId,
            text: bitcoinMovementMessage(movement, reference, lastClosed.close, lastClosed.time),
          });
          subscriber.btcMovementReference = lastClosed.close;
          stateChanged = true;
          const eventType = movement.direction === "ALTA" ? "BTC_ALTA_4" : "BTC_QUEDA_4";
          if (!movementEventTypes.has(eventType)) {
            historyEvents.push({
              asset: "BTC",
              period: "15M",
              candleTime: lastClosed.time,
              type: eventType,
              score: reading.score,
              detail: `${movement.changePercent.toFixed(2)}% desde ${reference.toFixed(2)} USDT`,
            });
            movementEventTypes.add(eventType);
          }
        }
      }

      const ratio = volumeRatio(closed);
      const capitulation = config.primary && capitulationDetected({
        rsi: reading.extreme.rsi,
        atrDistance: reading.extreme.atrDistance,
        volumeRatio: ratio,
      });
      const opportunity = rsiOpportunity(config.asset, config.period, reading.extreme.rsi);
      const transition = config.primary ? alertTransition(previous?.band, currentBand) : null;
      const kind = alertKind(transition, currentBand, previous?.band);

      if (opportunity && opportunity !== previous?.rsiOpportunity) {
        pendingMessages.push({
          kind: "OPORTUNIDADE",
          text: rsiOpportunityMessage(config, reading, opportunity, lastClosed.time, lastClosed.close),
        });
        historyEvents.push({
          asset: config.asset,
          period: config.period,
          candleTime: lastClosed.time,
          type: `RSI_${opportunity}`,
          score: reading.score,
          detail: `RSI ${reading.extreme.rsi.toFixed(1)}`,
        });
      }

      if (transition && kind) {
        pendingMessages.push({
          kind,
          text: alertMessage(config, reading, transition, lastClosed.time, lastClosed.close),
        });
        historyEvents.push({
          asset: config.asset,
          period: config.period,
          candleTime: lastClosed.time,
          type: `ALERTA_${kind}`,
          score: reading.score,
          detail: transition,
        });
      }

      if (capitulation && previous && !previous.capitulation) {
        if (config.source === "binance") {
          state.capitulationWatch[key] = {
            stage: "PENDING",
            sourceCandleTime: lastClosed.time,
            sourceClose: lastClosed.close,
            score: reading.score,
          };
        } else {
          pendingMessages.push({
            kind: "CAPITULACAO",
            text: capitulationMessage(config, reading, ratio, lastClosed.time, lastClosed.close),
          });
          historyEvents.push({
            asset: config.asset,
            period: config.period,
            candleTime: lastClosed.time,
            type: "POSSIVEL_CAPITULACAO",
            score: reading.score,
            detail: `RSI ${reading.extreme.rsi.toFixed(1)} • ${reading.extreme.atrDistance.toFixed(1)} ATR • volume ${ratio.toFixed(2)}x`,
          });
        }
      }
      if (config.primary && reading.extreme.divergence && reading.extreme.divergence !== previous?.divergence) {
        historyEvents.push({
          asset: config.asset,
          period: config.period,
          candleTime: lastClosed.time,
          type: reading.extreme.divergence === "bullish" ? "DIVERGENCIA_ALTA" : "DIVERGENCIA_BAIXA",
          score: reading.score,
          detail: reading.extreme.summary,
        });
      }

      if (config.primary) historyReadings.push({
        asset: config.asset,
        period: config.period,
        candleTime: lastClosed.time,
        checkedAt: Date.now(),
        price: lastClosed.close,
        score: reading.score,
        band: currentBand,
        agreement: reading.confidence,
        rsi: Number(reading.extreme.rsi.toFixed(2)),
        adx: Number(reading.extreme.adx.toFixed(2)),
        atrDistance: Number(reading.extreme.atrDistance.toFixed(3)),
        volumeRatio: Number(ratio.toFixed(3)),
        divergence: reading.extreme.divergence,
        capitulation,
      });

      state.readings[key] = {
        band: currentBand,
        score: reading.score,
        candleTime: lastClosed.time,
        checkedAt: Date.now(),
        divergence: reading.extreme.divergence,
        capitulation,
        rsiOpportunity: opportunity,
        bitcoinBuyLevel: currentBitcoinBuyLevel,
        rsiExtreme: currentRsiExtreme,
      };
      stateChanged = true;
    } catch (error) {
      errors.push(`${config.asset}: ${error instanceof Error ? error.message : "falha desconhecida"}`);
    }
  }

  if (!successful) throw new Error(`Nenhum ativo analisado. ${errors.join(" • ")}`);

  let delivery = { delivered: 0, disabled: 0, failed: 0 };
  if (SETUP_TEST) {
    delivery = await broadcast(
      state,
      [
        "TERM\u00d4METRO PREDITIVO",
        "",
        `${successful} de ${assets.length} ativos verificados.`,
        "",
        "Modo padrão: Compra Forte + oportunidades de RSI + possível capitulação.",
        "Cada pessoa pode mudar com /todos, /fortes ou /capitulacao.",
        "Alerta opcional de ±4% do BTC: /movimento4.",
        "",
        "Compartilhe este link:",
        `https://t.me/${username}`,
        "",
        "Cada amigo precisa tocar em Iniciar. Para sair, basta enviar /parar.",
      ].join("\n"),
    );
  } else {
    for (const message of pendingMessages) {
      const result = await broadcast(state, message.text, message.kind);
      delivery.delivered += result.delivered;
      delivery.disabled += result.disabled;
      delivery.failed += result.failed;
    }
    for (const message of directMessages) {
      try {
        await sendMessage(message.chatId, message.text);
        delivery.delivered += 1;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "";
        if (/HTTP (400|403)/.test(detail)) {
          state.subscribers[message.chatId].active = false;
          delivery.disabled += 1;
        } else {
          delivery.failed += 1;
        }
      }
    }
  }

  let historyResult = { configured: firebaseHistoryConfigured(), readings: 0, events: 0 };
  try {
    historyResult = await saveFirebaseHistory(historyReadings, historyEvents);
  } catch (error) {
    console.warn(`Histórico Firebase indisponível: ${error instanceof Error ? error.message : "falha desconhecida"}`);
  }

  if (delivery.disabled) stateChanged = true;
  if (stateChanged) await saveState(state);
  await setOutput("state_changed", stateChanged ? "true" : "false");
  await setOutput("assets_ok", String(successful));
  await setOutput("subscribers", String(activeSubscribers(state).length));
  await setOutput("history", historyResult.configured ? "configured" : "not_configured");
  console.log(
    `Monitoramento concluído: ${successful}/${assets.length} ativos • ${activeSubscribers(state).length} assinantes ativos • ${pendingMessages.length + directMessages.length} eventos • ${subscriberUpdates.commands} comandos • histórico ${historyResult.readings}/${historyResult.events}`,
  );
  if (!historyResult.configured) console.warn("Histórico Firebase aguardando credencial privada.");
  if (delivery.failed) console.warn(`${delivery.failed} entregas temporariamente indisponíveis`);
  for (const error of errors) console.warn(error);
}

await main();