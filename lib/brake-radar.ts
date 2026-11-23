// lib/brake-radar.ts — RADAR DE FREIO DA QUEDA (BTCUSDT).
//
// Cálculo puro, em memória, sobre candles públicos da Binance. Não usa banco,
// WebSocket, Firebase nem qualquer backend novo. O componente visual apenas
// consome `fetchBrakeKlines()` + `analyzeBrakeRadar()`.
//
// Regras:
// - somente candles FECHADOS (o candle em formação é descartado);
// - 24 candles de 1h (12h para a queda + blocos de 3h para o freio);
// - 48 candles de 15m (confirmação estrutural e EMA(9));
// - timestamps e ordem cronológica sempre respeitados;
// - nenhum score 0–100 de probabilidade: `brakePct` mede só desaceleração.

export const BRAKE_H1_INTERVAL_MS = 60 * 60_000;
export const BRAKE_M15_INTERVAL_MS = 15 * 60_000;
export const BRAKE_M5_INTERVAL_MS = 5 * 60_000;
export const BRAKE_STALE_MS = 2 * 60_000;
export const BRAKE_DROP_THRESHOLD_PCT = 1.5;
export const BRAKE_MIN_BRAKE_PCT = 25;
export const BRAKE_MIN_RETRACEMENT_PCT = 20;
// Repique em observação: recuperação relevante, ainda sem os cinco critérios.
export const BRAKE_MIN_REBOUND_RETRACEMENT_PCT = 15;
export const BRAKE_MIN_RECENT_REBOUND_PCT = 0.4;
// Recuo máximo (em módulo) que ainda é lido como acomodação dentro de uma
// recuperação, e não como retomada da queda. Só vale quando o fundo segue
// preservado e a retração continua acima de 15%; acima disso o estado é crítico.
export const BRAKE_MAX_MODERATE_PULLBACK_PCT = 0.5;
// Referência visual de fundo preservado e nível de recuperação para DCA.
export const BRAKE_PRESERVED_REFERENCE_MIN = 60;
export const BRAKE_DCA_LEVEL_PCT = 20;
// Abaixo disso a mínima é considerada recente (renovação nas últimas 1–2 velas).
export const BRAKE_RECENT_NEW_LOW_CANDLES = 2;
// Um bloco de 3h abaixo disso não é uma queda relevante a desacelerar. Evita
// que uma recuperação depois de um bloco lateral seja lida como "freio de 100%".
export const BRAKE_MIN_PREVIOUS_DECLINE_PCT = 0.5;
export const BRAKE_H1_COUNT = 24;
export const BRAKE_M15_COUNT = 48;
/** Janela ampliada apenas para visualização no minigráfico (24h em 15m). */
export const BRAKE_M15_DISPLAY_COUNT = 96;
/** Janela de referência diária para o extremo de 30 dias (somente exibição). */
export const BRAKE_D1_INTERVAL_MS = 24 * 60 * 60_000;
export const BRAKE_D1_COUNT = 30;
export const BRAKE_D1_REFERENCE_CACHE_MS = 10 * 60_000;

const EPSILON = 1e-9;

export type BrakeKline = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BrakeTone = "gray" | "green" | "amber" | "red" | "cyan";

export type BrakeState =
  | "UNAVAILABLE"
  | "NO_DROP"
  | "ACCELERATING"
  | "UNSTABLE"
  | "SLOWING"
  | "REBOUND"
  | "REACTION";

export type BrakeBarMetric = "brake" | "recovery" | "none";

export type BrakeRadarReading = {
  state: BrakeState;
  label: string;
  tone: BrakeTone;
  badge: string;
  action: string;
  reason: string;
  /** Queda do topo até a mínima válida nas últimas 12h (%). Negativa. */
  dropPct: number | null;
  /** Retorno dos 3h anteriores aos 3h mais recentes (%). */
  previousReturnPct: number | null;
  /** Retorno dos 3h mais recentes (%). */
  recentReturnPct: number | null;
  /** 0–100: desaceleração da queda. null = métrica não aplicável. */
  brakePct: number | null;
  brakeApplicable: boolean;
  maximum12h: number | null;
  minimum12h: number | null;
  minimumAt: number | null;
  candlesWithoutNewLow: number | null;
  retracementPct: number | null;
  ema9: number | null;
  lastClose15m: number | null;
  updatedAt: number | null;
  accelerating: boolean;
  /** true quando existe recuperação relevante após uma mínima identificada. */
  recovery: boolean;
  /** Existe queda válida de pelo menos 1,5% na janela de 12h. */
  hasDrop: boolean;
  /** Minutos de fundo preservado, contados em candles fechados de 15m. */
  preservedMinutes: number | null;
  /** Referência de recuperação de 20% da amplitude 12h. Não é ordem. */
  targetDcaPrice: number | null;
  /** Métrica que a barra única representa neste estado. */
  barMetric: BrakeBarMetric;
};

type BrakeKlineInput = {
  h1: BrakeKline[];
  m15: BrakeKline[];
  /** Momento da última leitura bem-sucedida (client-side). */
  fetchedAt: number | null;
  now: number;
};

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Converte a resposta bruta de /api/v3/klines em barras numéricas ordenadas. */
export function parseBrakeKlines(rows: unknown, intervalMs = BRAKE_M15_INTERVAL_MS): BrakeKline[] {
  if (!Array.isArray(rows)) return [];
  const out: BrakeKline[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const raw = row as RawKline;
    const openTime = Number(raw[0]);
    const open = Number(raw[1]);
    const high = Number(raw[2]);
    const low = Number(raw[3]);
    const close = Number(raw[4]);
    const volume = Number(raw[5]);
    // closeTime é o 7º campo (índice 6). Ausente em fixtures antigas: deriva.
    const closeTime = Number(raw[6] ?? openTime + intervalMs - 1);
    if (![openTime, closeTime, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
    if (high < low - EPSILON) continue;
    if (high < Math.max(open, close) - EPSILON) continue;
    if (low > Math.min(open, close) + EPSILON) continue;
    if (volume < 0) continue;
    out.push({ openTime, closeTime, open, high, low, close, volume });
  }
  out.sort((a, b) => a.openTime - b.openTime);
  // Remove duplicatas (mantém a primeira ocorrência do timestamp).
  return out.filter((bar, index) => index === 0 || bar.openTime !== out[index - 1].openTime);
}

/** Mantém apenas candles já fechados no instante `now`. */
export function closedBrakeKlines(bars: BrakeKline[], now: number): BrakeKline[] {
  return bars.filter((bar) => bar.closeTime <= now);
}

/** EMA clássica, semeada pela SMA dos primeiros `period` valores. */
export function emaLast(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const k = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    ema = (values[index] - ema) * k + ema;
  }
  return ema;
}

/**
 * Freio da queda a partir dos retornos de dois blocos consecutivos de 3h.
 * Retorna null quando o bloco anterior não foi de queda (métrica não aplicável).
 */
export function computeBrakePct(previous: number, recent: number): number | null {
  if (!Number.isFinite(previous) || !Number.isFinite(recent)) return null;
  if (previous >= 0) return null;
  if (recent >= 0) return 100;
  if (recent > previous) {
    return clamp((1 - Math.abs(recent) / Math.abs(previous)) * 100, 0, 100);
  }
  return 0;
}

function isValidSeries(bars: BrakeKline[], expected: number, interval: number): boolean {
  if (bars.length < expected) return false;
  const series = bars.slice(-expected);
  for (let index = 0; index < series.length; index++) {
    const bar = series[index];
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return false;
    if (bar.high < bar.low - EPSILON) return false;
    if (bar.high < Math.max(bar.open, bar.close) - EPSILON) return false;
    if (bar.low > Math.min(bar.open, bar.close) + EPSILON) return false;
    if (index > 0) {
      const step = bar.openTime - series[index - 1].openTime;
      if (step !== interval) return false;
    }
  }
  return true;
}

type DropWindow = {
  dropPct: number | null;
  maximum12h: number | null;
  minimum12h: number | null;
  minimumAt: number | null;
  maximumAt: number | null;
};

// Maior queda válida (topo antes da mínima) dentro da janela de 12h.
function findDrop12h(h1: BrakeKline[]): DropWindow {
  if (h1.length < 2) {
    return { dropPct: null, maximum12h: null, minimum12h: null, minimumAt: null, maximumAt: null };
  }
  let runningHigh = h1[0].high;
  let runningHighAt = h1[0].openTime;
  let best: DropWindow = {
    dropPct: null,
    maximum12h: null,
    minimum12h: null,
    minimumAt: null,
    maximumAt: null,
  };
  let bestDrop = 0;

  // Só compara mínimas com topos de candles ANTERIORES — evita eleger um
  // "topo" que na verdade veio depois da mínima dentro da janela.
  for (let index = 1; index < h1.length; index++) {
    const bar = h1[index];
    if (runningHigh > 0) {
      const drop = (bar.low / runningHigh - 1) * 100;
      if (drop < bestDrop) {
        bestDrop = drop;
        best = {
          dropPct: drop,
          maximum12h: runningHigh,
          minimum12h: bar.low,
          minimumAt: bar.openTime,
          maximumAt: runningHighAt,
        };
      }
    }
    if (bar.high > runningHigh) {
      runningHigh = bar.high;
      runningHighAt = bar.openTime;
    }
  }
  return best;
}

// Timestamp exato (15m) em que a mínima da hora foi registrada. A queda é
// medida em 1h, mas a contagem estrutural precisa do candle de 15m correto.
function findMinimum15mAt(m15: BrakeKline[], hourStart: number): number {
  const hourEnd = hourStart + BRAKE_H1_INTERVAL_MS;
  let best: BrakeKline | null = null;
  for (const bar of m15) {
    if (bar.openTime < hourStart || bar.openTime >= hourEnd) continue;
    if (!best || bar.low < best.low) best = bar;
  }
  return best ? best.openTime : hourStart;
}

type StructureResult = {
  candlesWithoutNewLow: number | null;
  retracementPct: number | null;
  ema9: number | null;
  lastClose15m: number | null;
};

function measureStructure(
  m15: BrakeKline[],
  minimumAt: number | null,
  minimum12h: number | null,
  maximum12h: number | null,
): StructureResult {
  if (minimumAt === null || minimum12h === null || maximum12h === null) {
    return { candlesWithoutNewLow: null, retracementPct: null, ema9: null, lastClose15m: null };
  }
  const minimum15mAt = findMinimum15mAt(m15, minimumAt);
  let count = 0;
  let runningLow = minimum12h;
  for (const bar of m15) {
    if (bar.openTime <= minimum15mAt) continue;
    if (bar.low < runningLow - EPSILON) {
      // Nova mínima inferior: a contagem reinicia no candle que a registrou.
      runningLow = bar.low;
      count = 0;
    } else {
      count += 1;
    }
  }

  const lastClose15m = m15[m15.length - 1].close;
  const range = maximum12h - minimum12h;
  const retracementPct = range > 0
    ? ((lastClose15m - minimum12h) / range) * 100
    : null;
  const ema9 = emaLast(m15.map((bar) => bar.close), 9);
  return { candlesWithoutNewLow: count, retracementPct, ema9, lastClose15m };
}

type PeriodReturns = {
  previous: number | null;
  recent: number | null;
};

// Retornos entre t−6h↔t−3h e t−3h↔t usando fechamentos de 1h.
function measurePeriodReturns(h1: BrakeKline[]): PeriodReturns {
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

const ACTIONS: Record<BrakeState, string> = {
  UNAVAILABLE: "Aguardando atualização. Nenhum sinal disponível.",
  NO_DROP: "AGUARDAR — Sem queda relevante para DCA.",
  ACCELERATING: "NÃO INICIAR DCA — Queda acelerando.",
  UNSTABLE: "NÃO INICIAR DCA — Queda sem estabilização.",
  SLOWING: "AGUARDAR — Queda desacelerando, mas reação ainda não confirmada.",
  REBOUND: "AGUARDAR — Repique em observação. DCA inativo.",
  REACTION: "DCA 1 LIBERADO — Cinco critérios técnicos atendidos.",
};

function unavailable(reason: string, updatedAt: number | null): BrakeRadarReading {
  return {
    state: "UNAVAILABLE",
    label: "DADOS INDISPONÍVEIS",
    tone: "gray",
    badge: "OFFLINE",
    action: ACTIONS.UNAVAILABLE,
    reason,
    dropPct: null,
    previousReturnPct: null,
    recentReturnPct: null,
    brakePct: null,
    brakeApplicable: false,
    maximum12h: null,
    minimum12h: null,
    minimumAt: null,
    candlesWithoutNewLow: null,
    retracementPct: null,
    ema9: null,
    lastClose15m: null,
    updatedAt,
    accelerating: false,
    recovery: false,
    hasDrop: false,
    preservedMinutes: null,
    targetDcaPrice: null,
    barMetric: "none",
  };
}

function pctText(value: number, signed = false): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded < 0 ? "−" : signed && rounded > 0 ? "+" : "";
  return `${sign}${Math.abs(rounded).toFixed(1).replace(".", ",")}%`;
}

/** Formata minutos preservados como `30 min`, `1h` ou `1h 15m`. */
export function formatPreservedMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function analyzeBrakeRadar(input: BrakeKlineInput): BrakeRadarReading {
  const { fetchedAt, now } = input;

  if (fetchedAt === null || !Number.isFinite(fetchedAt)) {
    return unavailable("Sem leitura válida dos candles.", null);
  }
  const age = now - fetchedAt;
  if (!Number.isFinite(age) || age > BRAKE_STALE_MS) {
    return unavailable("Dados sem atualização há mais de 2 minutos.", fetchedAt);
  }
  if (!isValidSeries(input.h1, BRAKE_H1_COUNT, BRAKE_H1_INTERVAL_MS)) {
    return unavailable("Candles de 1h ausentes, incompletos ou fora de ordem.", fetchedAt);
  }
  if (!isValidSeries(input.m15, BRAKE_M15_COUNT, BRAKE_M15_INTERVAL_MS)) {
    return unavailable("Candles de 15m ausentes, incompletos ou fora de ordem.", fetchedAt);
  }

  const h1 = input.h1.slice(-BRAKE_H1_COUNT);
  const m15 = input.m15.slice(-BRAKE_M15_COUNT);
  const lastH1 = h1[h1.length - 1];
  const lastM15 = m15[m15.length - 1];
  if (lastH1.closeTime > now || lastM15.closeTime > now) {
    return unavailable("Candle em formação detectado; aguardando fechamento.", fetchedAt);
  }
  // O último candle de 15m pode ser mais recente que o último de 1h (a hora
  // corrente ainda está aberta), mas não pode estar defasado em relação a ele
  // nem mais de uma hora à frente. Isso garante que as duas séries descrevem o
  // mesmo período.
  if (
    lastM15.closeTime <= lastH1.openTime
    || lastM15.closeTime > lastH1.closeTime + BRAKE_H1_INTERVAL_MS
  ) {
    return unavailable("Candles de 1h e 15m sem alinhamento temporal.", fetchedAt);
  }

  const dropWindow = findDrop12h(h1.slice(-12));
  const { previous, recent } = measurePeriodReturns(h1);
  const rawBrakePct = previous !== null && recent !== null ? computeBrakePct(previous, recent) : null;
  // Retorno >= 0 depois de um bloco em queda não é "freio": é recuperação. Quando
  // o bloco anterior está praticamente estável, não existe queda para desacelerar.
  const rebound = previous !== null && recent !== null && previous < 0 && recent >= 0;
  const nearZeroPrevious = previous !== null && Math.abs(previous) < BRAKE_MIN_PREVIOUS_DECLINE_PCT;
  const brakeApplicable = rawBrakePct !== null && !(rebound && nearZeroPrevious);
  const brakePct = brakeApplicable ? rawBrakePct : null;
  const structure = measureStructure(m15, dropWindow.minimumAt, dropWindow.minimum12h, dropWindow.maximum12h);
  const preservedMinutes = structure.candlesWithoutNewLow !== null
    ? structure.candlesWithoutNewLow * (BRAKE_M15_INTERVAL_MS / 60_000)
    : null;

  const hasDrop = dropWindow.dropPct !== null && dropWindow.dropPct <= -BRAKE_DROP_THRESHOLD_PCT;
  const range = dropWindow.maximum12h !== null && dropWindow.minimum12h !== null
    ? dropWindow.maximum12h - dropWindow.minimum12h
    : null;
  const targetDcaPrice = range !== null && range > 0 && dropWindow.minimum12h !== null
    ? dropWindow.minimum12h + range * (BRAKE_DCA_LEVEL_PCT / 100)
    : null;
  const lastCloseAboveEma = structure.lastClose15m !== null && structure.ema9 !== null
    ? structure.lastClose15m > structure.ema9
    : false;

  const recentNewLow = hasDrop
    && structure.candlesWithoutNewLow !== null
    && structure.candlesWithoutNewLow < BRAKE_RECENT_NEW_LOW_CANDLES;
  const retracementRecovery = structure.retracementPct !== null
    && structure.retracementPct >= BRAKE_MIN_REBOUND_RETRACEMENT_PCT;
  const recentRecovery = recent !== null && recent >= BRAKE_MIN_RECENT_REBOUND_PCT;
  const priceAboveBottom = structure.lastClose15m !== null && dropWindow.minimum12h !== null
    ? structure.lastClose15m > dropWindow.minimum12h + EPSILON
    : false;
  const hasIdentifiedBottom = dropWindow.minimumAt !== null && dropWindow.minimum12h !== null;
  // Com queda relevante, a retração de 15% ou o retorno de 0,4% já caracterizam
  // repique. Sem queda relevante, só o retorno recente >= 0,4% evita que uma
  // oscilação lateral seja lida como oportunidade.
  const recovery = hasIdentifiedBottom && priceAboveBottom
    && (hasDrop
      ? (retracementRecovery || recentRecovery || (!brakeApplicable && recent !== null && recent >= 0))
      : recentRecovery);

  const reactionConfirmed = Boolean(
    hasDrop
      && brakeApplicable
      && (brakePct ?? 0) >= BRAKE_MIN_BRAKE_PCT
      && (structure.candlesWithoutNewLow ?? 0) >= 4
      && (structure.retracementPct ?? -Infinity) >= BRAKE_MIN_RETRACEMENT_PCT
      && lastCloseAboveEma
  );

  const accelerating = previous !== null && recent !== null && previous < 0 && recent < previous;
  const measurableBrakeBelow = brakeApplicable && (brakePct ?? 0) < BRAKE_MIN_BRAKE_PCT;
  // Recuo moderado dentro de uma recuperação relevante. Sem freio mensurável o
  // bloco anterior foi de alta ou lateral; se o recuo recente é pequeno, o fundo
  // segue preservado e a retração continua acima de 15%, não existe retomada de
  // queda. Vai para REPIQUE EM OBSERVAÇÃO — os cinco critérios seguem bloqueando
  // o DCA, porque reação exige freio aplicável de pelo menos 25%.
  const moderatePullback = hasDrop
    && !brakeApplicable
    && recent !== null
    && recent < 0
    && recent >= -BRAKE_MAX_MODERATE_PULLBACK_PCT
    && !recentNewLow
    && recovery
    && !accelerating;
  const noBrakeWithNegativeRecent = !brakeApplicable
    && recent !== null
    && recent < 0
    && !moderatePullback;
  const criticalDrop = hasDrop && (measurableBrakeBelow || recentNewLow || noBrakeWithNegativeRecent);

  const dropTxt = dropWindow.dropPct !== null ? pctText(Math.abs(dropWindow.dropPct)) : "—";
  const recentTxt = recent !== null ? pctText(recent, true) : "—";
  const previousTxt = previous !== null ? pctText(previous, true) : "—";
  const preservedTxt = formatPreservedMinutes(preservedMinutes);
  const brakeClause = brakeApplicable && brakePct !== null
    ? `freio de ${pctText(brakePct)}`
    : "sem freio mensurável";
  const brakeText = brakeApplicable && brakePct !== null
    ? `Freio de ${pctText(brakePct)}`
    : "Sem freio mensurável";

  let state: BrakeState;
  let label: string;
  let tone: BrakeTone;
  let badge: string;
  let reason: string;

  if (!hasDrop) {
    if (recovery) {
      // Repique sem queda relevante: leitura contextual, sem gatilho de DCA.
      state = "REBOUND";
      label = "REPIQUE EM OBSERVAÇÃO";
      tone = "cyan";
      badge = "AGUARDAR";
      const bits: string[] = [];
      if (retracementRecovery) {
        bits.push(`recuperou ${pctText(structure.retracementPct ?? 0)} da amplitude recente`);
      }
      if (recentRecovery) bits.push(`retorno recente de ${recentTxt}`);
      reason = `BTC ${bits.join(" e ") || "apresenta recuperação"}, sem queda relevante de 1,5% nas últimas 12h. Leitura contextual; sem gatilho de DCA.`;
    } else {
      state = "NO_DROP";
      label = "MERCADO LATERAL / SEM QUEDA";
      tone = "gray";
      badge = "AGUARDAR";
      reason = dropWindow.dropPct === null
        ? `Sem queda válida de 1,5% nas últimas 12h. Movimento recente de ${recentTxt} em 3h; DCA de queda inativo.`
        : `Queda de ${dropTxt} nas últimas 12h, abaixo do mínimo de 1,5%. Movimento recente de ${recentTxt} em 3h; DCA de queda inativo.`;
    }
  } else if (reactionConfirmed) {
    state = "REACTION";
    label = "REAÇÃO CONFIRMADA";
    tone = "green";
    badge = "DCA 1 LIBERADO";
    reason = `Reação inicial identificada; não significa fundo definitivo. Queda de ${dropTxt}, ${brakeClause}, retração de ${pctText(structure.retracementPct ?? 0)} e ${preservedTxt} de fundo preservado, com fechamento acima da EMA(9).`;
  } else if (criticalDrop) {
    // Vermelho: queda relevante ainda perigosa. "Acelerando" só com evidência
    // matemática de aumento de velocidade; caso contrário, sem estabilização.
    tone = "red";
    badge = "NÃO INICIAR";
    if (accelerating) {
      state = "ACCELERATING";
      label = "QUEDA ACELERANDO";
      reason = `Queda de ${dropTxt}; ${brakeClause}; velocidade de queda aumentando (${previousTxt} → ${recentTxt}) e fundo preservado por ${preservedTxt}.`;
    } else {
      state = "UNSTABLE";
      label = "QUEDA SEM ESTABILIZAÇÃO";
      const details: string[] = [];
      if (!brakeApplicable) {
        details.push("sem freio mensurável");
      } else if ((brakePct ?? 0) < BRAKE_MIN_BRAKE_PCT) {
        details.push(`freio de ${pctText(brakePct ?? 0)} abaixo de 25%`);
      }
      if (recentNewLow) {
        details.push(`nova mínima recente (fundo preservado por ${preservedTxt})`);
      }
      if (recent !== null && recent < 0) {
        details.push(`movimento recente de ${recentTxt}`);
      }
      if (details.length === 0) details.push("estabilização ainda não confirmada");
      reason = `Queda de ${dropTxt} e ${details.join("; ")}. Nenhum sinal de DCA enquanto a queda não estabilizar.`;
    }
  } else if (recovery) {
    // Repique com queda relevante, ainda sem os cinco critérios de DCA.
    state = "REBOUND";
    label = "REPIQUE EM OBSERVAÇÃO";
    tone = "cyan";
    badge = "AGUARDAR";
    const preservedClause = preservedMinutes !== null
      && preservedMinutes < BRAKE_PRESERVED_REFERENCE_MIN
      ? `mas preservou a mínima por apenas ${preservedTxt}`
      : `e preservou a mínima por ${preservedTxt}`;
    const missing: string[] = [];
    if ((structure.candlesWithoutNewLow ?? 0) < 4) {
      missing.push("pelo menos 60 minutos de fundo preservado");
    }
    if ((structure.retracementPct ?? 0) < BRAKE_MIN_RETRACEMENT_PCT) {
      missing.push("retração de pelo menos 20%");
    }
    if (!lastCloseAboveEma) missing.push("fechamento acima da EMA(9)");
    if (!brakeApplicable || (brakePct ?? 0) < BRAKE_MIN_BRAKE_PCT) {
      missing.push("freio aplicável de pelo menos 25%");
    }
    const pullbackClause = moderatePullback
      ? ` O recuo recente de ${recentTxt} é moderado e não caracteriza retomada da queda.`
      : "";
    reason = `BTC recuperou ${pctText(structure.retracementPct ?? 0)} da amplitude da queda, ${preservedClause}.${pullbackClause} ${missing.length ? `Confirmação exige ${missing.join(", ")}.` : "Aguardando os demais critérios."}`;
  } else if (brakeApplicable && (brakePct ?? 0) >= BRAKE_MIN_BRAKE_PCT) {
    state = "SLOWING";
    label = "QUEDA DESACELERANDO";
    tone = "amber";
    badge = "AGUARDAR";
    const missing: string[] = [];
    if ((structure.retracementPct ?? 0) < BRAKE_MIN_REBOUND_RETRACEMENT_PCT) {
      missing.push(`recuperação de ${pctText(structure.retracementPct ?? 0)} (repique exige 15%)`);
    }
    if ((structure.candlesWithoutNewLow ?? 0) < 4) {
      missing.push(`fundo preservado de ${preservedTxt} (mínimo 60 min)`);
    }
    if (!lastCloseAboveEma) missing.push("fechamento abaixo da EMA(9)");
    reason = `${brakeText}, com mínima preservada por ${preservedTxt}. ${missing.length ? `Ainda falta ${missing.join("; ")} para reação.` : "Aguardando confirmação estrutural."}`;
  } else {
    // Fallback conservador: sem freio mensurável e sem repique significativo.
    state = "UNSTABLE";
    label = "QUEDA SEM ESTABILIZAÇÃO";
    tone = "red";
    badge = "NÃO INICIAR";
    reason = `Queda de ${dropTxt} sem freio mensurável e sem repique significativo. Fundo preservado por ${preservedTxt}; nenhum sinal de DCA.`;
  }

  let barMetric: BrakeBarMetric = "none";
  if ((state === "REACTION" || state === "REBOUND") && structure.retracementPct !== null) {
    barMetric = "recovery";
  } else if (
    (state === "ACCELERATING" || state === "UNSTABLE" || state === "SLOWING")
    && brakeApplicable
    && brakePct !== null
  ) {
    barMetric = "brake";
  }

  return {
    state,
    label,
    tone,
    badge,
    action: ACTIONS[state],
    reason,
    dropPct: dropWindow.dropPct,
    previousReturnPct: previous,
    recentReturnPct: recent,
    brakePct,
    brakeApplicable,
    maximum12h: dropWindow.maximum12h,
    minimum12h: dropWindow.minimum12h,
    minimumAt: dropWindow.minimumAt,
    candlesWithoutNewLow: structure.candlesWithoutNewLow,
    retracementPct: structure.retracementPct,
    ema9: structure.ema9,
    lastClose15m: structure.lastClose15m,
    updatedAt: fetchedAt,
    accelerating,
    recovery,
    hasDrop,
    preservedMinutes,
    targetDcaPrice,
    barMetric,
  };
}

// ── Aquisição pública (Binance spot, sem API Key) ──────────────────────────

const BINANCE_BASES = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines",
];

export const BRAKE_ASSETS = [
  { symbol: "BTCUSDT", name: "Bitcoin" },
  { symbol: "ETHUSDT", name: "Ethereum" },
  { symbol: "SOLUSDT", name: "Solana" },
  { symbol: "LINKUSDT", name: "Chainlink" },
  { symbol: "AVAXUSDT", name: "Avalanche" },
] as const;

export type BrakeBaseAssetSymbol = (typeof BRAKE_ASSETS)[number]["symbol"];
export type BrakeAssetSymbol = string;
export const BRAKE_EXTRA_STORAGE_KEY = "radar-reversao-extra-assets";
export const BRAKE_MAX_EXTRA_ASSETS = 3;
const BRAKE_SYMBOLS = new Set<string>(BRAKE_ASSETS.map(({ symbol }) => symbol));

export function isBaseBrakeAssetSymbol(symbol: string): symbol is BrakeBaseAssetSymbol {
  return BRAKE_SYMBOLS.has(symbol);
}

export function isBrakeAssetSymbol(symbol: string): symbol is BrakeBaseAssetSymbol {
  return BRAKE_SYMBOLS.has(symbol);
}

export function isValidBrakeRadarSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol);
}

export function cleanBrakeTicker(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export function toBrakeSpotSymbol(ticker: string): string | null {
  const clean = cleanBrakeTicker(ticker);
  if (!clean) return null;
  const symbol = clean.endsWith("USDT") ? clean : `${clean}USDT`;
  return isValidBrakeRadarSymbol(symbol) ? symbol : null;
}

export function brakeAssetName(symbol: string): string {
  const base = BRAKE_ASSETS.find((asset) => asset.symbol === symbol);
  if (base) return base.name;
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  minimum: number,
  signal?: AbortSignal,
): Promise<BrakeKline[]> {
  let lastError: unknown = null;
  const intervalMs =
    interval === "1d" ? BRAKE_D1_INTERVAL_MS
      : interval === "1h" ? BRAKE_H1_INTERVAL_MS
        : interval === "5m" ? BRAKE_M5_INTERVAL_MS : BRAKE_M15_INTERVAL_MS;
  for (const base of BINANCE_BASES) {
    try {
      const url = `${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const now = Date.now();
      const bars = closedBrakeKlines(parseBrakeKlines(await response.json(), intervalMs), now);
      if (bars.length < minimum) throw new Error("candles fechados insuficientes");
      return bars;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("klines indisponíveis");
}

export type BrakeKlinesSnapshot = {
  h1: BrakeKline[];
  m15: BrakeKline[];
  /** Exclusivo do gatilho rápido; não alimenta o gráfico nem o motor 15M/1H. */
  m5?: BrakeKline[];
  fetchedAt: number;
};

/** 25 candles de 1h e 97 de 15m: um extra descarta o candle em formação.
 *  Os 96 de 15m (24h) alimentam o minigráfico; os cálculos do radar continuam
 *  usando apenas os últimos BRAKE_M15_COUNT (48) candles fechados. */
export async function fetchBrakeKlines(
  signal?: AbortSignal,
  symbol: string = "BTCUSDT",
): Promise<BrakeKlinesSnapshot> {
  if (!isValidBrakeRadarSymbol(symbol)) throw new Error("símbolo não permitido");
  const [h1, m15, m5] = await Promise.all([
    fetchKlines(symbol, "1h", BRAKE_H1_COUNT + 1, BRAKE_H1_COUNT, signal),
    fetchKlines(symbol, "15m", BRAKE_M15_DISPLAY_COUNT + 1, BRAKE_M15_COUNT, signal),
    fetchKlines(symbol, "5m", 101, 2, signal).catch(() => []),
  ]);
  return { h1, m15, m5, fetchedAt: Date.now() };
}

export type BrakeDailyReference = {
  minLow: number | null;
  minLowAt: number | null;
  maxHigh: number | null;
  maxHighAt: number | null;
  fetchedAt: number;
};

type BrakeDailyReferenceCacheEntry = {
  value: BrakeDailyReference;
  expiresAt: number;
  promise: null;
};

type BrakeDailyReferenceInflightEntry = {
  value: null;
  expiresAt: 0;
  promise: Promise<BrakeDailyReference>;
};

const brakeDailyReferenceCache = new Map<
  string,
  BrakeDailyReferenceCacheEntry | BrakeDailyReferenceInflightEntry
>();

function computeBrakeDailyReference(bars: BrakeKline[], fetchedAt: number): BrakeDailyReference {
  const window = bars.slice(-BRAKE_D1_COUNT);
  let minLow: number | null = null;
  let minLowAt: number | null = null;
  let maxHigh: number | null = null;
  let maxHighAt: number | null = null;
  for (const bar of window) {
    const low = Number(bar.low);
    if (Number.isFinite(low) && low > 0 && (minLow === null || low < minLow)) {
      minLow = low;
      minLowAt = bar.openTime;
    }
    const high = Number(bar.high);
    if (Number.isFinite(high) && high > 0 && (maxHigh === null || high > maxHigh)) {
      maxHigh = high;
      maxHighAt = bar.openTime;
    }
  }
  return { minLow, minLowAt, maxHigh, maxHighAt, fetchedAt };
}

const BRAKE_DAILY_REF_LS_PREFIX = "brake-daily-ref:";

export function readBrakeDailyReferenceStorage(symbol: string): BrakeDailyReference | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(BRAKE_DAILY_REF_LS_PREFIX + symbol);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrakeDailyReference>;
    const minLow = typeof parsed.minLow === "number" && Number.isFinite(parsed.minLow) && parsed.minLow > 0 ? parsed.minLow : null;
    const minLowAt = typeof parsed.minLowAt === "number" && Number.isFinite(parsed.minLowAt) ? parsed.minLowAt : null;
    const maxHigh = typeof parsed.maxHigh === "number" && Number.isFinite(parsed.maxHigh) && parsed.maxHigh > 0 ? parsed.maxHigh : null;
    const maxHighAt = typeof parsed.maxHighAt === "number" && Number.isFinite(parsed.maxHighAt) ? parsed.maxHighAt : null;
    const fetchedAt = typeof parsed.fetchedAt === "number" && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : 0;
    if (minLow === null && maxHigh === null) return null;
    return { minLow, minLowAt, maxHigh, maxHighAt, fetchedAt };
  } catch {
    return null;
  }
}

export function writeBrakeDailyReferenceStorage(symbol: string, value: BrakeDailyReference): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(BRAKE_DAILY_REF_LS_PREFIX + symbol, JSON.stringify(value));
  } catch { /* quota/indisponível */ }
}

/** Referência diária de 30d (somente exibição). Cacheia por ativo por 10 min. Nunca cacheia falha. */
export async function fetchBrakeDailyReference(
  symbol: string = "BTCUSDT",
  signal?: AbortSignal,
): Promise<BrakeDailyReference> {
  if (!isValidBrakeRadarSymbol(symbol)) throw new Error("símbolo não permitido");
  const now = Date.now();
  const cached = brakeDailyReferenceCache.get(symbol);
  if (cached && cached.value && cached.expiresAt > now) return cached.value;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const bars = await fetchKlines(symbol, "1d", BRAKE_D1_COUNT + 1, 1, signal);
    const value = computeBrakeDailyReference(bars, Date.now());
    brakeDailyReferenceCache.set(symbol, {
      value,
      expiresAt: Date.now() + BRAKE_D1_REFERENCE_CACHE_MS,
      promise: null,
    });
    return value;
  })();

  brakeDailyReferenceCache.set(symbol, { value: null, expiresAt: 0, promise });
  try {
    return await promise;
  } catch (error) {
    const current = brakeDailyReferenceCache.get(symbol);
    if (current?.promise === promise) brakeDailyReferenceCache.delete(symbol);
    throw error;
  }
}

// ── Cotação spot do ativo selecionado (informativa) ────────────────────────
//
// Uma única chamada por ativo selecionado, no mesmo host público dos candles.
// A resposta nunca é reaproveitada para outro símbolo: se o payload não trouxer
// a cotação do ativo pedido, os campos ficam nulos e a UI mostra "Indisponível".

export type BrakeSpotQuote = {
  symbol: string;
  price: number | null;
  changePct24h: number | null;
};

const BINANCE_TICKER_BASES = [
  "https://data-api.binance.vision/api/v3/ticker/24hr",
  "https://api.binance.com/api/v3/ticker/24hr",
];

function parseBrakeSpotQuote(payload: unknown, symbol: string): BrakeSpotQuote {
  if (!payload || typeof payload !== "object") return { symbol, price: null, changePct24h: null };
  const body = payload as { symbol?: unknown; lastPrice?: unknown; priceChangePercent?: unknown };
  if (typeof body.symbol === "string" && body.symbol.toUpperCase() !== symbol) {
    return { symbol, price: null, changePct24h: null };
  }
  const price = Number(body.lastPrice);
  const changePct24h = Number(body.priceChangePercent);
  return {
    symbol,
    price: Number.isFinite(price) && price > 0 ? price : null,
    changePct24h: Number.isFinite(changePct24h) ? changePct24h : null,
  };
}

export async function fetchBrakeSpotQuote(
  symbol: string,
  signal?: AbortSignal,
): Promise<BrakeSpotQuote> {
  if (!isValidBrakeRadarSymbol(symbol)) throw new Error("símbolo não permitido");
  let lastError: unknown = null;
  for (const base of BINANCE_TICKER_BASES) {
    try {
      const response = await fetch(`${base}?symbol=${symbol}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseBrakeSpotQuote(await response.json(), symbol);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("cotação indisponível");
}
