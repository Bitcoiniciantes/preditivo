// lib/top-radar.ts — CAÇA-TOPOS (BTCUSDT).
//
// Motor independente do Radar de Freio da Queda. Não inverte sinais do motor
// de fundo: mede valorização até a máxima, desaceleração, preservação do topo,
// recuo e perda da EMA(9) de 15m para identificar possível exaustão de alta.
//
// Regras:
// - somente candles FECHADOS de 1h e 15m;
// - 24 candles de 1h (dois blocos de 3h + EMA9 1h + valorização líquida 12h);
// - 48 candles de 15m (mínima de origem, máxima monitorada, idade do topo,
//   tempo sem nova máxima, recuo e EMA9 15m);
// - a alta relevante é medida da mínima ANTERIOR ao topo até a máxima, e não
//   pela valorização líquida entre o fechamento atual e o de 12h atrás;
// - nenhuma chamada externa neste módulo: a aquisição continua em
//   `fetchBrakeKlines()`, compartilhada com o Radar de Freio da Queda;
// - nenhum score 0–100 de probabilidade e nenhuma ordem de venda.
//
// Determinismo do topo:
// - a máxima é a maior `high` da janela de 12h;
// - máximas iguais NÃO renovam o topo (só uma máxima estritamente superior
//   substitui a referência anterior);
// - candles com o mesmo `openTime` são deduplicados após ordenação estável,
//   mantendo a primeira ocorrência;
// - a mínima de origem é a menor `low` ESTRITAMENTE anterior ao candle da
//   máxima; empates escolhem a ocorrência mais antiga;
// - a idade do topo usa o `closeTime` do candle fechado que registrou a máxima,
//   sempre em epoch milliseconds (UTC), sem conversão de timezone.
//
// Precedência formal dos estados:
//   1. UNAVAILABLE — dados ausentes, velhos, inválidos ou insuficientes;
//   2. NEUTRAL — dados válidos, mas sem alta relevante até a máxima;
//   3. EXHAUSTION_CONFIRMED — cinco critérios + filtro 1H + topo elegível;
//   4. TOP_WATCH — exaustão parcial, recuo na janela 0,5%–3% e topo elegível;
//   5. DECELERATING — perda de força, recuo além de 3% ou topo fora da janela;
//   6. STRONG_UPTREND — alta relevante ainda sustentada e topo elegível.

export const TOP_H1_INTERVAL_MS = 60 * 60_000;
export const TOP_M15_INTERVAL_MS = 15 * 60_000;
export const TOP_STALE_MS = 2 * 60_000;

// Limites experimentais centralizados para calibração futura.
export const TOP_MIN_RISE_12H_PCT = 2;
export const TOP_MIN_NO_NEW_HIGH_MINUTES = 60;
export const TOP_MIN_DRAWDOWN_PCT = 0.5;
export const TOP_MAX_WATCH_DRAWDOWN_PCT = 3;
// Um topo só pode gerar NOVA confirmação enquanto estiver dentro desta janela.
// Eventos já confirmados não são apagados retroativamente; a máxima continua
// visível como referência informativa depois disso.
export const TOP_MAX_CONFIRM_AGE_HOURS = 6;
// Mínimo de candles fechados anteriores ao topo para existir uma origem válida.
export const TOP_MIN_ORIGIN_CANDLES = 1;

export const TOP_H1_COUNT = 24;
export const TOP_M15_COUNT = 48;

const EPSILON = 1e-9;

export type TopKline = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TopTone = "gray" | "green" | "amber" | "red" | "cyan";

export type TopState =
  | "UNAVAILABLE"
  | "NEUTRAL"
  | "STRONG_UPTREND"
  | "DECELERATING"
  | "TOP_WATCH"
  | "EXHAUSTION_CONFIRMED";

export type TopCriterionId =
  | "riseToPeak"
  | "deceleration"
  | "topPreserved"
  | "drawdown"
  | "ema15";

export type TopCriterion = {
  id: TopCriterionId;
  label: string;
  met: boolean;
  value: string;
  detail: string;
};

export type TopH1ConditionId = "ema1h" | "high1h" | "close1h";

export type TopH1Condition = {
  id: TopH1ConditionId;
  label: string;
  met: boolean;
  value: string;
  detail: string;
};

export type TopH1Filter = {
  met: boolean;
  conditions: TopH1Condition[];
};

export type TopRadarReading = {
  state: TopState;
  label: string;
  tone: TopTone;
  badge: string;
  action: string;
  reason: string;
  /** Valorização líquida dos últimos 12h. Informativa, não é o critério. */
  rise12hPct: number | null;
  /** Alta da mínima anterior até a máxima monitorada. Critério principal. */
  riseToPeakPct: number | null;
  /** Menor mínima estritamente anterior ao topo, dentro da janela de 12h. */
  originLow: number | null;
  originAt: number | null;
  /** Retorno do bloco de 3h anterior (t−6h → t−3h). */
  previousReturnPct: number | null;
  /** Retorno do bloco de 3h mais recente (t−3h → t). */
  recentReturnPct: number | null;
  /** Maior máxima da janela monitorada de 12h. */
  maximum: number | null;
  maximumAt: number | null;
  /** Fechamento do candle que registrou a máxima. */
  maximumCloseTime: number | null;
  /** Idade do topo em minutos, medida até o `closeTime` da máxima. */
  peakAgeMinutes: number | null;
  /** Topo dentro da janela de confirmação de `TOP_MAX_CONFIRM_AGE_HOURS`. */
  peakEligible: boolean;
  /** Minutos, em candles fechados de 15m, sem renovar a máxima. */
  minutesWithoutNewHigh: number | null;
  /** Recuo percentual positivo em relação à máxima monitorada. */
  drawdownPct: number | null;
  ema9_15m: number | null;
  ema9_1h: number | null;
  lastClose15m: number | null;
  lastClose1h: number | null;
  lastHigh1h: number | null;
  previousClose1h: number | null;
  previousHigh1h: number | null;
  /** Os cinco critérios de topo, inclusive os não atendidos. */
  criteria: TopCriterion[];
  /** Filtro estrutural de enfraquecimento horário. */
  h1Filter: TopH1Filter;
  /** Cinco critérios + filtro 1H + topo elegível + recuo dentro da janela. */
  confirmed: boolean;
  /** Recuo acima de 3%: saiu da janela inicial de exaustão. */
  beyondWatchWindow: boolean;
  updatedAt: number | null;
};

type TopKlineInput = {
  h1: TopKline[];
  m15: TopKline[];
  /** Momento da última leitura bem-sucedida (client-side). */
  fetchedAt: number | null;
  now: number;
};

const ACTIONS: Record<TopState, string> = {
  UNAVAILABLE: "AGUARDAR DADOS",
  NEUTRAL: "SEM ALTA RELEVANTE — AGUARDAR",
  STRONG_UPTREND: "MANTER OBSERVAÇÃO",
  DECELERATING: "MONITORAR ENFRAQUECIMENTO",
  TOP_WATCH: "OBSERVAR POSSÍVEL REALIZAÇÃO",
  EXHAUSTION_CONFIRMED: "AVALIAR REALIZAÇÃO PARCIAL",
};

const LABELS: Record<TopState, string> = {
  UNAVAILABLE: "DADOS INDISPONÍVEIS",
  NEUTRAL: "SEM ALTA RELEVANTE",
  STRONG_UPTREND: "ALTA FORTE",
  DECELERATING: "ALTA DESACELERANDO",
  TOP_WATCH: "TOPO EM OBSERVAÇÃO",
  EXHAUSTION_CONFIRMED: "EXAUSTÃO CONFIRMADA",
};

const TONES: Record<TopState, TopTone> = {
  UNAVAILABLE: "gray",
  NEUTRAL: "gray",
  STRONG_UPTREND: "green",
  DECELERATING: "amber",
  TOP_WATCH: "cyan",
  EXHAUSTION_CONFIRMED: "red",
};

const BADGES: Record<TopState, string> = {
  UNAVAILABLE: "OFFLINE",
  NEUTRAL: "NEUTRO",
  STRONG_UPTREND: "ALTA SUSTENTADA",
  DECELERATING: "PERDENDO FORÇA",
  TOP_WATCH: "EM OBSERVAÇÃO",
  EXHAUSTION_CONFIRMED: "5/5 + 1H",
};

const BEYOND_WINDOW_REASON =
  "Recuo superior à janela inicial de observação. Correção já em andamento; "
  + "sinal de topo não deve ser interpretado como novo gatilho.";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pctText(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? "−" : signed && rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(1).replace(".", ",")}%`;
}

function priceText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function minutesText(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function isFiniteBar(bar: TopKline): boolean {
  return [bar.openTime, bar.closeTime, bar.open, bar.high, bar.low, bar.close, bar.volume]
    .every(Number.isFinite)
    && bar.open > 0
    && bar.high > 0
    && bar.low > 0
    && bar.close > 0
    && bar.high >= bar.low - EPSILON
    && bar.high >= Math.max(bar.open, bar.close) - EPSILON
    && bar.low <= Math.min(bar.open, bar.close) + EPSILON
    && bar.volume >= 0;
}

// Ordena, descarta candles em formação e deduplica timestamps idênticos.
// A ordenação estável mantém a primeira ocorrência de cada `openTime`, o que
// torna o resultado independente da ordem de entrega da exchange.
function closedBars(bars: TopKline[], now: number): TopKline[] {
  if (!Array.isArray(bars)) return [];
  const valid = bars.filter((bar) => bar && isFiniteBar(bar) && bar.closeTime <= now);
  valid.sort((left, right) => left.openTime - right.openTime);
  return valid.filter(
    (bar, index) => index === 0 || bar.openTime !== valid[index - 1].openTime,
  );
}

function isValidSeries(bars: TopKline[], expected: number, interval: number): boolean {
  if (bars.length < expected) return false;
  const series = bars.slice(-expected);
  for (let index = 0; index < series.length; index++) {
    const bar = series[index];
    if (!isFiniteBar(bar)) return false;
    if (index > 0 && bar.openTime - series[index - 1].openTime !== interval) return false;
  }
  return true;
}

/** EMA clássica, semeada pela SMA dos primeiros `period` valores. */
export function topEmaLast(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const k = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    ema = (values[index] - ema) * k + ema;
  }
  return ema;
}

function emptyCriteria(): TopCriterion[] {
  return [
    {
      id: "riseToPeak",
      label: "Alta relevante de 2% até a máxima",
      met: false,
      value: "—",
      detail: "Aguardando candles fechados anteriores suficientes ao topo.",
    },
    {
      id: "deceleration",
      label: "Desaceleração do bloco de 3h",
      met: false,
      value: "—",
      detail: "Compara os dois blocos de 3h mais recentes.",
    },
    {
      id: "topPreserved",
      label: "Topo preservado por pelo menos 1h",
      met: false,
      value: "—",
      detail: "Conta candles fechados de 15m sem renovar a máxima.",
    },
    {
      id: "drawdown",
      label: "Recuo de pelo menos 0,5% da máxima",
      met: false,
      value: "—",
      detail: "Recuo medido sobre a máxima monitorada.",
    },
    {
      id: "ema15",
      label: "Fechamento 15m abaixo da EMA9",
      met: false,
      value: "—",
      detail: "Usa o último candle fechado de 15m.",
    },
  ];
}

function emptyH1Filter(): TopH1Filter {
  return {
    met: false,
    conditions: [
      {
        id: "ema1h",
        label: "Fechamento 1H < EMA9 1H",
        met: false,
        value: "—",
        detail: "Confirma perda da média horária.",
      },
      {
        id: "high1h",
        label: "Máxima 1H ≤ máxima anterior",
        met: false,
        value: "—",
        detail: "Confirma ausência de nova máxima horária.",
      },
      {
        id: "close1h",
        label: "Fechamento 1H < fechamento anterior",
        met: false,
        value: "—",
        detail: "Confirma enfraquecimento do fechamento horário.",
      },
    ],
  };
}

function unavailable(reason: string, updatedAt: number | null): TopRadarReading {
  return {
    state: "UNAVAILABLE",
    label: LABELS.UNAVAILABLE,
    tone: TONES.UNAVAILABLE,
    badge: BADGES.UNAVAILABLE,
    action: ACTIONS.UNAVAILABLE,
    reason,
    rise12hPct: null,
    riseToPeakPct: null,
    originLow: null,
    originAt: null,
    previousReturnPct: null,
    recentReturnPct: null,
    maximum: null,
    maximumAt: null,
    maximumCloseTime: null,
    peakAgeMinutes: null,
    peakEligible: false,
    minutesWithoutNewHigh: null,
    drawdownPct: null,
    ema9_15m: null,
    ema9_1h: null,
    lastClose15m: null,
    lastClose1h: null,
    lastHigh1h: null,
    previousClose1h: null,
    previousHigh1h: null,
    criteria: emptyCriteria(),
    h1Filter: emptyH1Filter(),
    confirmed: false,
    beyondWatchWindow: false,
    updatedAt,
  };
}

type PeriodReturns = {
  previous: number | null;
  recent: number | null;
};

// Retornos entre t−6h↔t−3h e t−3h↔t usando fechamentos de 1h.
function measurePeriodReturns(h1: TopKline[]): PeriodReturns {
  if (h1.length < 7) return { previous: null, recent: null };
  const last = h1.length - 1;
  const t3 = h1[last - 3].close;
  const t6 = h1[last - 6].close;
  const t = h1[last].close;
  if (t3 <= 0 || t6 <= 0 || t <= 0) return { previous: null, recent: null };
  return {
    previous: (t3 / t6 - 1) * 100,
    recent: (t / t3 - 1) * 100,
  };
}

type PeakMovement = {
  maximum: number | null;
  maximumAt: number | null;
  maximumCloseTime: number | null;
  originLow: number | null;
  originAt: number | null;
  riseToPeakPct: number | null;
  minutesWithoutNewHigh: number | null;
};

const EMPTY_PEAK: PeakMovement = {
  maximum: null,
  maximumAt: null,
  maximumCloseTime: null,
  originLow: null,
  originAt: null,
  riseToPeakPct: null,
  minutesWithoutNewHigh: null,
};

// Seleciona UM único movimento: máxima da janela, mínima estritamente anterior
// a ela e a contagem de candles posteriores. Nunca usa mínima posterior ao topo
// e nunca combina a máxima de um movimento com o tempo sem nova máxima de outro.
function measurePeak(m15: TopKline[]): PeakMovement {
  if (m15.length === 0) return EMPTY_PEAK;

  // Primeira ocorrência da maior máxima; toques iguais não renovam a referência.
  let peakIndex = 0;
  for (let index = 1; index < m15.length; index++) {
    if (m15[index].high > m15[peakIndex].high + EPSILON) peakIndex = index;
  }
  const peak = m15[peakIndex];

  // Menor mínima cronologicamente anterior; empate escolhe a mais antiga.
  let originIndex = -1;
  for (let index = 0; index < peakIndex; index++) {
    if (originIndex < 0 || m15[index].low < m15[originIndex].low - EPSILON) {
      originIndex = index;
    }
  }
  const origin = originIndex >= 0 ? m15[originIndex] : null;

  const priorCandles = peakIndex;
  const riseToPeakPct = origin !== null
    && priorCandles >= TOP_MIN_ORIGIN_CANDLES
    && origin.low > 0
    ? (peak.high / origin.low - 1) * 100
    : null;

  return {
    maximum: peak.high,
    maximumAt: peak.openTime,
    maximumCloseTime: peak.closeTime,
    originLow: origin?.low ?? null,
    originAt: origin?.openTime ?? null,
    riseToPeakPct,
    // Todo candle posterior ao topo é contado, inclusive toques iguais.
    minutesWithoutNewHigh: (m15.length - 1 - peakIndex) * (TOP_M15_INTERVAL_MS / 60_000),
  };
}

type StateInput = {
  riseMet: boolean;
  decelMet: boolean;
  preservedMet: boolean;
  drawdownMet: boolean;
  ema15Met: boolean;
  h1FilterMet: boolean;
  drawdownPct: number | null;
  peakEligible: boolean;
};

type Classification = {
  state: TopState;
  confirmed: boolean;
  beyondWatchWindow: boolean;
  partialSignals: number;
};

function classify(input: StateInput): Classification {
  const allCriteria = input.riseMet
    && input.decelMet
    && input.preservedMet
    && input.drawdownMet
    && input.ema15Met
    && input.h1FilterMet;
  const beyondWatchWindow = input.drawdownPct !== null
    && input.drawdownPct > TOP_MAX_WATCH_DRAWDOWN_PCT + EPSILON;
  const withinWatchWindow = input.drawdownPct !== null
    && input.drawdownPct >= TOP_MIN_DRAWDOWN_PCT - EPSILON
    && input.drawdownPct <= TOP_MAX_WATCH_DRAWDOWN_PCT + EPSILON;
  const partialSignals = [input.decelMet, input.preservedMet, input.drawdownMet, input.ema15Met]
    .filter(Boolean).length;

  // Confirmação exige topo elegível e recuo dentro da janela inicial.
  const confirmed = allCriteria && input.peakEligible && !beyondWatchWindow;

  if (!input.riseMet) {
    return { state: "NEUTRAL", confirmed: false, beyondWatchWindow, partialSignals };
  }
  if (confirmed) {
    return { state: "EXHAUSTION_CONFIRMED", confirmed: true, beyondWatchWindow, partialSignals };
  }
  if (input.peakEligible && withinWatchWindow && partialSignals >= 2) {
    return { state: "TOP_WATCH", confirmed: false, beyondWatchWindow, partialSignals };
  }
  if (partialSignals > 0 || beyondWatchWindow || !input.peakEligible) {
    return { state: "DECELERATING", confirmed: false, beyondWatchWindow, partialSignals };
  }
  return { state: "STRONG_UPTREND", confirmed: false, beyondWatchWindow, partialSignals };
}

function missingList(criteria: TopCriterion[], h1Filter: TopH1Filter): string[] {
  const missing = criteria.filter((criterion) => !criterion.met).map((criterion) => criterion.label);
  if (!h1Filter.met) missing.push("filtro estrutural 1H completo");
  return missing;
}

export function analyzeTopRadar(input: TopKlineInput): TopRadarReading {
  const { fetchedAt, now } = input;

  if (fetchedAt === null || !Number.isFinite(fetchedAt)) {
    return unavailable("Sem leitura válida dos candles.", null);
  }
  if (!Number.isFinite(now)) {
    return unavailable("Relógio local inválido para validar os candles.", fetchedAt);
  }
  // A idade é do último FETCH bem-sucedido, não do último fechamento esperado:
  // candles fechados continuam válidos enquanto a próxima atualização ocorre.
  const age = now - fetchedAt;
  if (!Number.isFinite(age) || age < -TOP_STALE_MS || age > TOP_STALE_MS) {
    return unavailable("Dados sem atualização há mais de 2 minutos.", fetchedAt);
  }
  if (!Array.isArray(input.h1) || !Array.isArray(input.m15)) {
    return unavailable("Candles de 1h ou 15m ausentes.", fetchedAt);
  }

  // Descarta qualquer candle em formação, ordena e deduplica antes de validar.
  const h1Closed = closedBars(input.h1, now);
  const m15Closed = closedBars(input.m15, now);

  if (!isValidSeries(h1Closed, TOP_H1_COUNT, TOP_H1_INTERVAL_MS)) {
    return unavailable("Candles de 1h ausentes, incompletos, inválidos ou fora de ordem.", fetchedAt);
  }
  if (!isValidSeries(m15Closed, TOP_M15_COUNT, TOP_M15_INTERVAL_MS)) {
    return unavailable("Candles de 15m ausentes, incompletos, inválidos ou fora de ordem.", fetchedAt);
  }

  const h1 = h1Closed.slice(-TOP_H1_COUNT);
  const m15 = m15Closed.slice(-TOP_M15_COUNT);
  const lastH1 = h1[h1.length - 1];
  const lastM15 = m15[m15.length - 1];
  const previousH1 = h1[h1.length - 2];

  if (lastH1.closeTime > now || lastM15.closeTime > now) {
    return unavailable("Candle em formação detectado; aguardando fechamento.", fetchedAt);
  }
  if (
    lastM15.closeTime <= lastH1.openTime
    || lastM15.closeTime > lastH1.closeTime + TOP_H1_INTERVAL_MS
  ) {
    return unavailable("Candles de 1h e 15m sem alinhamento temporal.", fetchedAt);
  }

  const referenceIndex = h1.length - 13;
  const reference = referenceIndex >= 0 ? h1[referenceIndex] : null;
  const rise12hPct = reference !== null && reference.close > 0
    ? (lastH1.close / reference.close - 1) * 100
    : null;

  const { previous, recent } = measurePeriodReturns(h1);
  const peak = measurePeak(m15);
  const lastClose15m = lastM15.close;
  const drawdownPct = peak.maximum !== null && peak.maximum > 0
    ? clamp((peak.maximum - lastClose15m) / peak.maximum * 100, 0, 100)
    : null;
  const peakAgeMinutes = peak.maximumCloseTime !== null
    ? Math.max(0, (now - peak.maximumCloseTime) / 60_000)
    : null;
  const peakEligible = peakAgeMinutes !== null
    && peakAgeMinutes <= TOP_MAX_CONFIRM_AGE_HOURS * 60 + EPSILON;

  const ema9_15m = topEmaLast(m15.map((bar) => bar.close), 9);
  const ema9_1h = topEmaLast(h1.map((bar) => bar.close), 9);

  const riseMet = peak.riseToPeakPct !== null
    && peak.riseToPeakPct >= TOP_MIN_RISE_12H_PCT - EPSILON;
  // Desaceleração de ALTA: o bloco anterior precisa ter sido positivo. Dois
  // blocos negativos consecutivos descrevem uma queda, não uma alta perdendo
  // força. Limitação conhecida: consolidações longas podem não ser detectadas
  // e este critério deverá ser calibrado com dados reais posteriormente.
  const decelMet = previous !== null
    && previous > EPSILON
    && recent !== null
    && recent < previous - EPSILON;
  const preservedMet = peak.minutesWithoutNewHigh !== null
    && peak.minutesWithoutNewHigh >= TOP_MIN_NO_NEW_HIGH_MINUTES - EPSILON;
  const drawdownMet = drawdownPct !== null && drawdownPct >= TOP_MIN_DRAWDOWN_PCT - EPSILON;
  const ema15Met = ema9_15m !== null && lastClose15m < ema9_15m - EPSILON;

  const h1EmaMet = ema9_1h !== null && lastH1.close < ema9_1h - EPSILON;
  const h1HighMet = lastH1.high <= previousH1.high + EPSILON;
  const h1CloseMet = lastH1.close < previousH1.close - EPSILON;
  const h1FilterMet = h1EmaMet && h1HighMet && h1CloseMet;

  const riseValue = peak.riseToPeakPct === null
    ? "—"
    : `${pctText(peak.riseToPeakPct, true)} · ${priceText(peak.originLow)} → ${priceText(peak.maximum)}`;

  const criteria: TopCriterion[] = [
    {
      id: "riseToPeak",
      label: "Alta relevante de 2% até a máxima",
      met: riseMet,
      value: riseValue,
      detail: peak.originLow === null
        ? "Sem candles fechados anteriores ao topo para determinar a mínima de origem."
        : `Mínimo configurado: ${pctText(TOP_MIN_RISE_12H_PCT)} da mínima anterior até a máxima monitorada.`,
    },
    {
      id: "deceleration",
      label: "Desaceleração do bloco de 3h",
      met: decelMet,
      value: `${pctText(previous, true)} → ${pctText(recent, true)}`,
      detail: "Exige bloco anterior positivo e bloco recente inferior ao anterior. Dois blocos negativos não indicam desaceleração de alta.",
    },
    {
      id: "topPreserved",
      label: "Topo preservado por pelo menos 1h",
      met: preservedMet,
      value: minutesText(peak.minutesWithoutNewHigh),
      detail: `Mínimo configurado: ${TOP_MIN_NO_NEW_HIGH_MINUTES} minutos sem renovar a máxima.`,
    },
    {
      id: "drawdown",
      label: "Recuo de pelo menos 0,5% da máxima",
      met: drawdownMet,
      value: pctText(drawdownPct),
      detail: `Janela de observação inicial: ${pctText(TOP_MIN_DRAWDOWN_PCT)}–${pctText(TOP_MAX_WATCH_DRAWDOWN_PCT)}. Acima de ${pctText(TOP_MAX_WATCH_DRAWDOWN_PCT)}, o mesmo topo não gera nova confirmação.`,
    },
    {
      id: "ema15",
      label: "Fechamento 15m abaixo da EMA9",
      met: ema15Met,
      value: `${priceText(lastClose15m)} < ${priceText(ema9_15m)}`,
      detail: "Usa somente o último candle fechado de 15m.",
    },
  ];

  const h1Filter: TopH1Filter = {
    met: h1FilterMet,
    conditions: [
      {
        id: "ema1h",
        label: "Fechamento 1H < EMA9 1H",
        met: h1EmaMet,
        value: `${priceText(lastH1.close)} < ${priceText(ema9_1h)}`,
        detail: "O fechamento horário precisa perder a média de 9 horas.",
      },
      {
        id: "high1h",
        label: "Máxima 1H ≤ máxima anterior",
        met: h1HighMet,
        value: `${priceText(lastH1.high)} ≤ ${priceText(previousH1.high)}`,
        detail: "A máxima horária não pode ser renovada.",
      },
      {
        id: "close1h",
        label: "Fechamento 1H < fechamento anterior",
        met: h1CloseMet,
        value: `${priceText(lastH1.close)} < ${priceText(previousH1.close)}`,
        detail: "O fechamento horário precisa ser inferior ao anterior.",
      },
    ],
  };

  const classification = classify({
    riseMet,
    decelMet,
    preservedMet,
    drawdownMet,
    ema15Met,
    h1FilterMet,
    drawdownPct,
    peakEligible,
  });

  const { state, confirmed, beyondWatchWindow, partialSignals } = classification;
  const netRiseTxt = pctText(rise12hPct, true);
  const riseToPeakTxt = pctText(peak.riseToPeakPct, true);
  const previousTxt = pctText(previous, true);
  const recentTxt = pctText(recent, true);
  const drawdownTxt = pctText(drawdownPct);
  const preservedTxt = minutesText(peak.minutesWithoutNewHigh);
  const ageTxt = minutesText(peakAgeMinutes);
  const peakTxt = priceText(peak.maximum);
  const originTxt = priceText(peak.originLow);

  let reason: string;

  if (state === "NEUTRAL") {
    const head = partialSignals >= 2
      ? "Sinais técnicos parciais identificados, mas condição de alta relevante não atendida."
      : "Sem alta relevante suficiente para habilitar a análise de exaustão.";
    reason = `${head} Alta de ${riseToPeakTxt} entre a mínima de ${originTxt} e a máxima de ${peakTxt}; valorização líquida de ${netRiseTxt} nas últimas 12h.`;
  } else if (state === "EXHAUSTION_CONFIRMED") {
    reason = `Os cinco critérios e o filtro estrutural 1H foram atendidos. Alta de ${riseToPeakTxt} entre a mínima de ${originTxt} e a máxima de ${peakTxt}, desaceleração de ${previousTxt} para ${recentTxt}, topo preservado por ${preservedTxt}, recuo de ${drawdownTxt} e fechamento de 15m abaixo da EMA9. O topo tem ${ageTxt} e está dentro da janela de confirmação de ${TOP_MAX_CONFIRM_AGE_HOURS}h. Isso não representa reversão definitiva da tendência.`;
  } else if (state === "TOP_WATCH") {
    const missing = missingList(criteria, h1Filter);
    const criteriaMet = criteria.filter((criterion) => criterion.met).length;
    reason = `Exaustão parcial: ${criteriaMet} de 5 critérios técnicos atendidos, com recuo de ${drawdownTxt} dentro da janela de 0,5%–3% e topo de ${ageTxt}. ${missing.length ? `A confirmação ainda exige: ${missing.join("; ")}.` : "Aguardando confirmação estrutural."} Nenhum topo foi confirmado.`;
  } else if (state === "DECELERATING") {
    if (beyondWatchWindow) {
      reason = BEYOND_WINDOW_REASON;
    } else if (!peakEligible) {
      reason = `A máxima monitorada de ${peakTxt} foi formada há ${ageTxt}, acima da janela de confirmação de ${TOP_MAX_CONFIRM_AGE_HOURS}h. Ela permanece apenas como referência informativa: não há nova confirmação de exaustão com o mesmo topo e o caso não é tratado como alta forte.`;
    } else {
      const details: string[] = [];
      if (decelMet) details.push(`bloco de 3h desacelerou de ${previousTxt} para ${recentTxt}`);
      if (preservedMet) details.push(`máxima preservada por ${preservedTxt}`);
      if (drawdownMet) details.push(`recuo de ${drawdownTxt}`);
      if (ema15Met) details.push("fechamento de 15m abaixo da EMA9");
      reason = `Alta de ${riseToPeakTxt} até a máxima de ${peakTxt} com sinais iniciais de perda de força: ${details.join("; ")}. Apenas ${partialSignals} sinal(is) de exaustão parcial; nenhum topo confirmado.`;
    }
  } else {
    reason = `Alta de ${riseToPeakTxt} entre a mínima de ${originTxt} e a máxima de ${peakTxt} (valorização líquida de ${netRiseTxt} em 12h) ainda sustentada. Recuo de ${drawdownTxt}, máxima renovada há ${preservedTxt} e topo de ${ageTxt}, dentro da janela de confirmação. Nenhum alerta de topo.`;
  }

  return {
    state,
    label: LABELS[state],
    tone: TONES[state],
    badge: BADGES[state],
    action: ACTIONS[state],
    reason,
    rise12hPct,
    riseToPeakPct: peak.riseToPeakPct,
    originLow: peak.originLow,
    originAt: peak.originAt,
    previousReturnPct: previous,
    recentReturnPct: recent,
    maximum: peak.maximum,
    maximumAt: peak.maximumAt,
    maximumCloseTime: peak.maximumCloseTime,
    peakAgeMinutes,
    peakEligible,
    minutesWithoutNewHigh: peak.minutesWithoutNewHigh,
    drawdownPct,
    ema9_15m,
    ema9_1h,
    lastClose15m,
    lastClose1h: lastH1.close,
    lastHigh1h: lastH1.high,
    previousClose1h: previousH1.close,
    previousHigh1h: previousH1.high,
    criteria,
    h1Filter,
    confirmed,
    beyondWatchWindow,
    updatedAt: fetchedAt,
  };
}
