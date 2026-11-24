"use client";
// app/BtcBrakeRadar.tsx — RADAR DE FREIO DA QUEDA (BTCUSDT).
// BITCOIN — RADAR DE FREIO DA QUEDA (compatibilidade de integração BTC).
// BTC/USDT · BTC · fechamento 15m (rótulos históricos preservados).
//
// Card independente do ativo selecionado no Termômetro. Lê somente candles
// públicos e fechados da Binance spot (1h + 15m), a cada 60s, e delega toda a
// matemática para lib/brake-radar.ts. Não repete CVD, funding, OI, RSI, order
// book nem qualquer métrica de microestrutura. Não executa ordens.

import { useEffect, useMemo, useState } from "react";
import {
  analyzeBrakeRadar,
  emaLast,
  fetchBrakeDailyReference,
  fetchBrakeKlines,
  formatPreservedMinutes,
  readBrakeDailyReferenceStorage,
  writeBrakeDailyReferenceStorage,
  BRAKE_PRESERVED_REFERENCE_MIN,
  type BrakeDailyReference,
  type BrakeKlinesSnapshot,
  type BrakeRadarReading,
  type BrakeAssetSymbol,
} from "../lib/brake-radar";
import { RadarMiniChart } from "./RadarMiniChart";

const REFRESH_MS = 60_000;

function fmtPct(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  // Arredonda antes de decidir o sinal: −0,04% deve aparecer como 0,0%, não −0,0%.
  const rounded = Math.round(value * 10) / 10;
  const absolute = Math.abs(rounded).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = rounded < 0 ? "−" : signed && rounded > 0 ? "+" : "";
  return `${sign}${absolute}%`;
}

function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  // Mínimo de duas casas; ativos de preço baixo ganham casas extras para não
  // perder a ordem de grandeza (ex.: 0,00421). Nunca arredonda 9,24 para 9.
  const magnitude = Math.floor(Math.log10(Math.abs(value) || 1));
  const digits = Math.max(2, Math.min(8, 2 - magnitude));
  return `$${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function fmtCurrentPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDailyChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function fmtTime(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtRefDate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type BarView = {
  label: string;
  value: number;
  display: string;
  mark: number | null;
  markTitle: string;
  track: boolean;
};

function clampPct(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

// A barra única representa a métrica do estado atual: freio durante a queda,
// retração durante repique/reção. Sem métrica válida, nenhuma barra é desenhada
// (e nenhum percentual falso é inventado).
function barView(reading: BrakeRadarReading, brakeMinPct: number): BarView {
  if (reading.barMetric === "recovery") {
    return {
      label: "RECUPERAÇÃO DA AMPLITUDE (%)",
      value: clampPct(reading.retracementPct),
      display: fmtPct(reading.retracementPct),
      mark: 20,
      markTitle: "Referência de 20% da amplitude",
      track: true,
    };
  }
  if (reading.barMetric === "brake") {
    return {
      label: "FREIO DA QUEDA (%)",
      value: clampPct(reading.brakePct),
      display: fmtPct(reading.brakePct),
      mark: brakeMinPct,
      markTitle: `Mínimo de ${brakeMinPct}% para sinal de reação`,
      track: true,
    };
  }
  return {
    label: "FREIO NÃO APLICÁVEL",
    value: 0,
    display: "",
    mark: null,
    markTitle: "",
    track: false,
  };
}

function returnTone(value: number | null): string {
  if (value === null) return "brMuted";
  const rounded = Math.round(value * 10) / 10;
  if (rounded < 0) return "brNegative";
  if (rounded > 0) return "brPositive";
  return "brMuted";
}

function recoveryTone(reading: BrakeRadarReading): string {
  if (!reading.hasDrop) return "brMuted";
  const value = reading.retracementPct;
  if (value === null) return "brMuted";
  if (value >= 20) return "brPositive";
  if (value >= 15) return "brCaution";
  return "brMuted";
}

function preservedTone(reading: BrakeRadarReading): string {
  if (!reading.hasDrop || reading.preservedMinutes === null) return "brMuted";
  if (reading.preservedMinutes >= BRAKE_PRESERVED_REFERENCE_MIN) return "brPositive";
  if (reading.preservedMinutes >= 30) return "brCaution";
  return "brNegative";
}

type PriceTrend = "up" | "down" | "flat";

function priceTrendTone(trend: PriceTrend): string {
  if (trend === "up") return "brPositive";
  if (trend === "down") return "brNegative";
  return "brMuted";
}
void priceTrendTone;

function changeTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "brMuted";
  if (value > 0) return "brPositive";
  if (value < 0) return "brNegative";
  return "brMuted";
}

export function BtcBrakeRadar({
  symbol = "BTCUSDT",
  assetName = "Bitcoin",
  livePrice = null,
  dailyChangePct = null,
  quoteState = "loading",
  quoteUpdatedAt = null,
  chartState = "loading",
  snapshot: externalSnapshot,
  now: externalNow,
  mode: controlledMode,
}: {
  symbol?: BrakeAssetSymbol;
  assetName?: string;
  livePrice?: number | null;
  dailyChangePct?: number | null;
  quoteState?: "loading" | "ready" | "failed" | "stale";
  quoteUpdatedAt?: number | null;
  chartState?: "loading" | "ready" | "failed" | "stale";
  /** Snapshot compartilhado opcional. Quando presente, evita um segundo fetch. */
  snapshot?: BrakeKlinesSnapshot | null;
  /** Relógio compartilhado opcional com o wrapper de abas. */
  now?: number;
  mode?: "fast" | "conservative";
}) {
  const mode = controlledMode ?? "conservative";
  const [internalSnapshot, setInternalSnapshot] = useState<BrakeKlinesSnapshot | null>(null);
  const [internalNow, setInternalNow] = useState(0);
  // `undefined` = uso autônomo; `null` = wrapper ainda sem dados.
  const shared = externalSnapshot !== undefined;
  const snapshot = shared ? externalSnapshot : internalSnapshot;
  const now = externalNow ?? internalNow;
  const [priceTrend, setPriceTrend] = useState<PriceTrend>("flat");
  void priceTrend;
  const [trackedQuote, setTrackedQuote] = useState<{ symbol: BrakeAssetSymbol; price: number } | null>(null);
  const validLivePrice = livePrice !== null && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : null;
  const validDailyChange = dailyChangePct !== null && Number.isFinite(dailyChangePct)
    ? dailyChangePct
    : null;
  const quoteView = quoteState === "loading" && validLivePrice === null
    ? "loading"
    : quoteState === "failed" && validLivePrice === null
      ? "failed"
      : quoteState === "stale" && validLivePrice !== null
        ? "stale"
        : "ready";

  // Atualização condicionada durante o render, conforme a versão remota.
  // A referência é sempre do MESMO símbolo: ao trocar de ativo o rastreio
  // recomeça, sem comparar preços de tickers diferentes. A primeira leitura de
  // um símbolo usa o sinal de 24h; depois vale o movimento entre cotações.
  if (validLivePrice !== null && (trackedQuote?.symbol !== symbol || trackedQuote.price !== validLivePrice)) {
    if (trackedQuote !== null && trackedQuote.symbol === symbol && trackedQuote.price > 0) {
      const delta = (validLivePrice / trackedQuote.price - 1) * 100;
      setPriceTrend(Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down");
    } else if (validDailyChange !== null && validDailyChange !== 0) {
      setPriceTrend(validDailyChange > 0 ? "up" : "down");
    } else {
      setPriceTrend("flat");
    }
    setTrackedQuote({ symbol, price: validLivePrice });
  }

  useEffect(() => {
    if (shared) return;
    const timer = window.setInterval(() => setInternalNow(Date.now()), 1000);
    setInternalNow(Date.now());
    return () => window.clearInterval(timer);
  }, [shared]);

  useEffect(() => {
    if (shared) return;
    let active = true;
    let running = false;
    const controller = new AbortController();

    const load = async () => {
      if (running) return;
      running = true;
      try {
        const next = await fetchBrakeKlines(controller.signal);
        if (active) {
          setInternalSnapshot(next);
        }
      } catch (error) {
        // Mantém a última leitura válida. Se ela envelhecer > 2 min, o próprio
        // analisador classifica DADOS INDISPONÍVEIS e bloqueia qualquer sinal.
        if ((error as Error)?.name !== "AbortError") {
          /* sem dados novos; o estado de staleness cuida do bloqueio */
        }
      } finally {
        running = false;
      }
    };

    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shared]);

  const [dailyRef, setDailyRef] = useState<BrakeDailyReference | null>(null);
  const [dailyRefStatus, setDailyRefStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timers: number[] = [];
    const wait = (ms: number) => new Promise<void>((resolve) => {
      const id = window.setTimeout(resolve, ms);
      timers.push(id);
    });

    const stored = readBrakeDailyReferenceStorage(symbol);
    let hasValue = !!stored;
    if (stored) {
      setDailyRef(stored);
      setDailyRefStatus("ready");
    } else {
      setDailyRef(null);
      setDailyRefStatus("loading");
    }

    const BACKOFF_MS = [3000, 10_000, 30_000];

    const run = async () => {
      // Escalona a busca inicial para não competir com as requisições principais da abertura.
      await wait(2000);
      if (!active) return;
      let failures = 0;
      while (active) {
        try {
          const next = await fetchBrakeDailyReference(symbol, controller.signal);
          if (!active) return;
          hasValue = true;
          setDailyRef(next);
          setDailyRefStatus("ready");
          writeBrakeDailyReferenceStorage(symbol, next);
          failures = 0;
          await wait(10 * 60_000);
        } catch (error) {
          if (!active || (error as Error)?.name === "AbortError") return;
          if (failures < BACKOFF_MS.length) {
            await wait(BACKOFF_MS[failures]);
            failures += 1;
          } else {
            if (!hasValue) setDailyRefStatus("failed");
            failures = 0;
            await wait(10 * 60_000);
          }
        }
      }
    };

    void run();
    return () => {
      active = false;
      controller.abort();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [symbol]);

  // A: config do modo Rápido (agressivo, somente quando ativo)
  const RAPIDO = { fundoPreservadoMin: 15, freioMinPct: 10, stopMaxPct: 0.8, stopLookback5m: 12, alvoPrincipal: "alvo50" as const, usarPrecoAoVivoEma9: true, bloquearComContexto1hContrario: false };
  const reading = useMemo(
    () => analyzeBrakeRadar(
      {
        h1: snapshot?.h1 ?? [],
        m15: snapshot?.m15 ?? [],
        fetchedAt: snapshot?.fetchedAt ?? null,
        now,
      },
      mode === "fast" ? { brakeMinPct: RAPIDO.freioMinPct, preservedReferenceMin: RAPIDO.fundoPreservadoMin } : undefined,
    ),
    [snapshot, now, mode, RAPIDO.freioMinPct, RAPIDO.fundoPreservadoMin],
  );
  const assetCode = symbol.replace("USDT", "");
  const displayReason = reading.reason
    .replace(/\bBTC\b/g, assetCode)
    .replace(/Bitcoin/g, assetName);

  const bar = barView(reading, mode === "fast" ? RAPIDO.freioMinPct : 25);
  // Referência fechada de 15m usada somente nos cálculos; a cotação exibida é
  // o spot atual do próprio ativo.
  const referencePrice = reading.lastClose15m;
  const preservedText = formatPreservedMinutes(reading.preservedMinutes);
  const preservedMet = reading.preservedMinutes !== null
    && reading.preservedMinutes >= BRAKE_PRESERVED_REFERENCE_MIN;
  const preservedTrack = reading.preservedMinutes === null
    ? 0
    : Math.max(0, Math.min(100, (reading.preservedMinutes / (BRAKE_PRESERVED_REFERENCE_MIN * 2)) * 100));
  // Mínima 30d (somente exibição): menor low entre candles 1d fechados (30d)
  // e candles 15M carregados (24h), para não excluir o fundo de hoje.
  const dailyMin = dailyRef?.minLow ?? null;
  const dailyMinAt = dailyRef?.minLowAt ?? null;
  let m15MinLow: number | null = null;
  let m15MinLowAt: number | null = null;
  for (const bar of (snapshot?.m15 ?? []).slice(-96)) {
    const low = Number(bar.low);
    if (!Number.isFinite(low) || low <= 0) continue;
    if (m15MinLow === null || low < m15MinLow) {
      m15MinLow = low;
      m15MinLowAt = Number(bar.openTime);
    }
  }
  let minimum30d: number | null = null;
  let minimum30dAt: number | null = null;
  if (dailyRef) {
    if (dailyMin !== null && (m15MinLow === null || dailyMin <= m15MinLow)) {
      minimum30d = dailyMin;
      minimum30dAt = dailyMinAt;
    } else if (m15MinLow !== null) {
      minimum30d = m15MinLow;
      minimum30dAt = m15MinLowAt;
    }
  }
  const distanceBase = validLivePrice ?? reading.lastClose15m ?? null;
  const minimum30dDistancePct = minimum30d !== null && distanceBase !== null && distanceBase > 0
    ? ((minimum30d / distanceBase) - 1) * 100
    : null;
  const entry = validLivePrice ?? reading.lastClose15m;
  const stop = reading.minimum12h !== null ? reading.minimum12h * 0.998 : null;
  const amplitude = reading.maximum12h !== null && reading.minimum12h !== null ? reading.maximum12h - reading.minimum12h : null;
  const target50 = reading.minimum12h !== null && amplitude !== null ? reading.minimum12h + amplitude * .5 : null;
  const target100 = reading.maximum12h;
  // Abaixo da mínima/stop não existe setup operacional: os níveis anteriores
  // continuam apenas como referência histórica até uma nova mínima válida.
  const setupInvalidated = entry !== null && ((reading.minimum12h !== null && entry < reading.minimum12h) || (stop !== null && entry <= stop));
  const risk = !setupInvalidated && entry !== null && stop !== null && entry > stop ? (entry - stop) / entry * 100 : null;
  const liveRecovery = entry !== null && reading.minimum12h !== null && amplitude !== null && amplitude > 0 ? (entry - reading.minimum12h) / amplitude * 100 : null;
  const closedRecovery = reading.retracementPct;
  const emaDistance = entry !== null && reading.ema9 !== null ? (entry / reading.ema9 - 1) * 100 : null;
  const closedBars = snapshot?.m15 ?? [];
  const last15 = closedBars.at(-1) ?? null;
  const closedEmaDistance = reading.lastClose15m !== null && reading.ema9 !== null ? (reading.lastClose15m / reading.ema9 - 1) * 100 : null;
  const fmtHHMM = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };
  const fmtHHMMRange = (closeTime: number | null | undefined, intervalMs: number) => {
    if (closeTime === null || closeTime === undefined || !Number.isFinite(closeTime)) return "—";
    const end = closeTime + 1;
    const start = end - intervalMs;
    return `${fmtHHMM(start)}–${fmtHHMM(end)}`;
  };
  type CheckState = "confirmed" | "waiting" | "invalid" | "unavailable";
  const context1h: CheckState = reading.previousReturnPct === null || reading.recentReturnPct === null
    ? "unavailable"
    : reading.recentReturnPct < 0 || reading.accelerating
      ? "invalid"
      : reading.previousReturnPct < 0 && reading.recentReturnPct >= 0 && reading.brakeApplicable && (reading.brakePct ?? 0) >= 25
        ? "confirmed"
        : "waiting";
  const conservativeChecks: { label: string; state: CheckState }[] = [
    { label: "Fundo preservado por 60 min", state: reading.preservedMinutes === null ? "unavailable" : setupInvalidated ? "invalid" : preservedMet ? "confirmed" : "waiting" },
    { label: `Fechamento 15M (${fmtHHMM(last15?.closeTime ?? null)}) acima da EMA9`, state: reading.lastClose15m === null || reading.ema9 === null ? "unavailable" : setupInvalidated || reading.lastClose15m < reading.ema9 ? "invalid" : reading.lastClose15m > reading.ema9 ? "confirmed" : "waiting" },
    { label: "Freio da queda (mín. 25%)", state: !reading.brakeApplicable || reading.brakePct === null ? "unavailable" : (reading.brakePct >= 25 ? "confirmed" : "waiting") },
    { label: "Contexto 1H favorável", state: context1h },
  ];
  const conservativeConfirmed = !setupInvalidated && conservativeChecks.every((check) => check.state === "confirmed");
  const direction = setupInvalidated ? "MÍNIMA ROMPIDA"
    : reading.state === "UNSTABLE" || reading.state === "ACCELERATING" ? "QUEDA EM ANDAMENTO"
      : reading.recovery && reading.recentReturnPct !== null && reading.recentReturnPct > 0 ? "RECUPERAÇÃO GANHANDO FORÇA"
        : reading.recovery ? "RECUPERAÇÃO EM OBSERVAÇÃO" : "QUEDA EM ANDAMENTO";
  const quality = setupInvalidated ? "FUNDO ROMPIDO"
    : conservativeConfirmed ? "REVERSÃO CONFIRMADA"
      : reading.state === "UNSTABLE" || reading.state === "ACCELERATING" || !reading.brakeApplicable ? "SEM ESTABILIZAÇÃO"
        : preservedMet ? "FUNDO PRESERVADO" : "TESTANDO O FUNDO";
  const recoveryClass = (value: number | null) => value === null ? "brMuted" : value < 0 ? "brNegative" : value > 0 ? "brPositive" : "brCaution";
  const recentVolume = closedBars.slice(-12).reduce((sum, bar) => sum + bar.volume, 0);
  const olderBars = closedBars.slice(-96, -12);
  const avgVolume3h = olderBars.length ? olderBars.reduce((sum, bar) => sum + bar.volume, 0) / (olderBars.length / 12) : null;
  const volumeRatio = avgVolume3h && avgVolume3h > 0 ? recentVolume / avgVolume3h : null;
  const volumeStabilizing = quality !== "SEM ESTABILIZAÇÃO" && quality !== "FUNDO ROMPIDO";
  const volumeTone = volumeRatio === null ? "brMuted" : (volumeStabilizing && volumeRatio >= 1 ? "brPositive" : "brMuted");
  const volumeHeadline = volumeRatio === null ? "—" : `${volumeRatio >= 1 ? "▲" : "▼"} ${volumeRatio.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;
  const volumeDetail = volumeRatio === null ? "" : `a média 24h · volume na queda · ${volumeStabilizing ? "estabilização em observação" : "sem estabilização"}`;
  const m5 = snapshot?.m5 ?? [];
  const ema5 = emaLast(m5.map((bar) => bar.close), 9);
  const last5 = m5.at(-1) ?? null;
  const prior5 = m5.at(-2) ?? null;
  const fastCriteria = last5 && prior5 && ema5 !== null ? [last5.close > ema5, last5.close > prior5.high] as const : null;
  const fastTriggerCount = fastCriteria ? fastCriteria.filter(Boolean).length : 0;
  const fastTriggerState = fastCriteria ? (fastTriggerCount === 2 ? "DISPARADO" : fastTriggerCount === 1 ? "ARMADO" : "AGUARDANDO") : "INDISPONÍVEL";
  const fastAgainstTrend = Boolean(fastTriggerCount === 2 && (context1h === "invalid" || quality === "SEM ESTABILIZAÇÃO"));
  const fastDistanceEma5 = last5 && ema5 !== null ? (last5.close / ema5 - 1) * 100 : null;
  const fastDistancePrevHigh = last5 && prior5 ? (last5.close / prior5.high - 1) * 100 : null;
  const last12m5Low = m5.slice(-RAPIDO.stopLookback5m).reduce<number | null>((min, bar) => {
    const low = Number(bar.low);
    if (!Number.isFinite(low) || low <= 0) return min;
    return min === null || low < min ? low : min;
  }, null);
  const fastStopPct = entry !== null ? entry * (1 - RAPIDO.stopMaxPct / 100) : null;
  const fastStop = entry !== null ? Math.max(last12m5Low ?? -Infinity, fastStopPct ?? -Infinity) : null;
  const fastStopValid = fastStop !== null && Number.isFinite(fastStop) && fastStop > 0 && entry !== null && fastStop < entry;
  const fastStopFinal = fastStopValid ? fastStop : null;
  const fastTargetPrincipal = RAPIDO.alvoPrincipal === "alvo50" ? target50 : target100;
  const fastTarget2 = target100;
  const fastSetupInvalidated = entry !== null && ((reading.minimum12h !== null && entry < reading.minimum12h) || (fastStopFinal !== null && entry <= fastStopFinal));
  const fastRisk = !fastSetupInvalidated && entry !== null && fastStopFinal !== null && entry > fastStopFinal ? (entry - fastStopFinal) / entry * 100 : null;
  const fastRR = !fastSetupInvalidated && fastRisk !== null && fastRisk > 0 && fastTargetPrincipal !== null && entry !== null ? (fastTargetPrincipal - entry) / (entry * fastRisk / 100) : null;
  const fastPreservedMet = reading.preservedMinutes !== null && reading.preservedMinutes >= RAPIDO.fundoPreservadoMin;
  const fastPreservedTrack = reading.preservedMinutes === null ? 0 : Math.max(0, Math.min(100, (reading.preservedMinutes / (RAPIDO.fundoPreservadoMin * 2)) * 100));
  const fastPreservedMark = 50; // 15 min em escala 0..30 min
  const preservedRefMin = mode === "fast" ? RAPIDO.fundoPreservadoMin : BRAKE_PRESERVED_REFERENCE_MIN;
  const freioReason = !reading.brakeApplicable
    ? (!reading.hasDrop
      ? "n/d: sem queda relevante"
      : reading.preservedMinutes !== null && reading.preservedMinutes < preservedRefMin
        ? `n/d: exige fundo preservado ≥ ${preservedRefMin} min`
        : "n/d: freio não aplicável neste contexto")
    : reading.brakePct === null
      ? "n/d: dados insuficientes"
      : null;
  // O diagnóstico de preço (reading) não autoriza operação. Esta decisão única
  // abastece selo, AÇÃO e o estado do setup/DCA em ambos os modos.
  const operationalBlocked = reading.state === "UNAVAILABLE"
    || setupInvalidated
    || fastSetupInvalidated
    || reading.state === "ACCELERATING"
    || reading.state === "UNSTABLE";
  const operationalStatus = operationalBlocked
    ? "ENTRADA BLOQUEADA"
    : mode === "fast"
      ? fastTriggerCount === 2 ? "ENTRADA LIBERADA" : "AGUARDAR CONFIRMAÇÃO"
      : conservativeConfirmed ? "ENTRADA LIBERADA" : "AGUARDAR CONFIRMAÇÃO";
  const entryAuthorized = operationalStatus === "ENTRADA LIBERADA";
  const operationalReason = operationalBlocked
    ? (setupInvalidated || fastSetupInvalidated ? "Setup invalidado: aguardar nova referência." : displayReason)
    : mode === "fast"
      ? `Gatilho 5M ${fastTriggerCount}/2 ${fastTriggerState}${fastAgainstTrend ? "; contexto 1H contrário permanece como alerta." : "."}`
      : `${conservativeChecks.filter((check) => check.state === "confirmed").length}/4 confirmações; ${conservativeConfirmed ? "todos os filtros obrigatórios foram atendidos." : "filtros obrigatórios ainda incompletos."}`;
  const technicalLabel = reading.recovery && !entryAuthorized
    ? "RECUPERAÇÃO EM OBSERVAÇÃO"
    : entryAuthorized ? "REAÇÃO CONFIRMADA"
      : reading.label;

  return (
    <article
      className={`card brakeRadar tone-${reading.tone}`}
      aria-live="polite"
      aria-label={`Radar de freio da queda do ${assetName}`}
    >
      <div className="brHead">
        <div className="brHeadMain">
          <h3 className="brTitle">{assetName.toUpperCase()} — Radar de freio da queda</h3>
          <span className="brKicker">{symbol}</span>
          <div className="brState">{technicalLabel}</div>
        </div>
        <div className={`brCurrentPrice brHeadQuote brHeadQuote-${quoteView === "ready" || quoteView === "stale" ? changeTone(validDailyChange) : "brMuted"}`} aria-label={`Cotação spot de ${symbol}`}>
          <div className="brQuoteLine">
            {quoteView === "loading" ? (
              <b className="brQuoteValue brQuoteLoading">Atualizando<span className="brLoadingDots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></b>
            ) : quoteView === "failed" ? (
              <b className="brQuoteValue brQuoteUnavailable">Sem conexão</b>
            ) : validLivePrice !== null ? (
              <>
                <b className={`brQuoteValue ${changeTone(validDailyChange)}`}>
                  ${fmtCurrentPrice(validLivePrice)}
                </b>
                {validDailyChange !== null && (
                  <small className={`brDailyChange ${changeTone(validDailyChange)}`}>
                    {fmtDailyChange(validDailyChange)}
                    <span className="brChangeWindow">24H</span>
                  </small>
                )}
              </>
            ) : null}
          </div>
          {quoteView === "loading" ? <small className="brQuoteRef">buscando Binance spot</small>
            : quoteView === "failed" ? <small className="brQuoteRef">nova tentativa em 60s</small>
              : quoteView === "stale" ? <small className="brQuoteRef">desatualizada · última às {fmtTime(quoteUpdatedAt)}</small>
                : referencePrice !== null && Number.isFinite(referencePrice) && (
            <small className="brQuoteRef">Preço ao vivo (tick) · ref. 15M: {fmtCurrentPrice(referencePrice)}</small>
          )}
        </div>
        <div className="brHeadSide">
          <span className={`brBadge${entryAuthorized ? " brBadgeSpeculative" : ""}`}>{operationalStatus}</span>
          <small className="brUpdated">Snapshot 15M atualizado às {fmtTime(reading.updatedAt)}</small>
        </div>
      </div>

      <section className="brEvolution" aria-label="Evolução 1 do radar">
        <div className="brOperationalGrid">
          <div className={`brOpCard brMap${entryAuthorized ? "" : " brMapHypothetical"}`}>
            <span>{entryAuthorized ? "SETUP ATIVO" : "CENÁRIO HIPOTÉTICO — não ativo"} · MAPA DO SETUP</span>
            {mode === "fast" ? (
              <>
                <dl>
                  <div><dt>Entrada de referência</dt><dd>{fastSetupInvalidated ? "INVÁLIDA" : fmtPrice(entry)}</dd></div>
                  <div><dt>Stop técnico</dt><dd className="brNegative">{fmtPrice(fastStopFinal)}</dd></div>
                  <div><dt>Custo do erro</dt><dd>{fmtPct(fastRisk)}</dd></div>
                  <div><dt>Alvo principal (50%)</dt><dd className={fastSetupInvalidated ? "brMuted" : "brPositive"}>{fmtPrice(fastTargetPrincipal)}</dd></div>
                  <div><dt>Alvo 2 (topo amplitude)</dt><dd className={fastSetupInvalidated ? "brMuted" : "brPositive"}>{fmtPrice(fastTarget2)}</dd></div>
                  <div><dt>R/R</dt><dd>{fastRR !== null && Number.isFinite(fastRR) ? `1 : ${fastRR.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"}</dd></div>
                </dl>
                {fastRisk !== null && fastRisk < 0.5 && <small className="brFastMeta brCaution">Stop curto: sensível a pavios</small>}
              </>
            ) : (
              <dl>
                <div><dt>Entrada de referência</dt><dd>{setupInvalidated ? "INVÁLIDA" : fmtPrice(entry)}</dd></div>
                <div><dt>Stop técnico</dt><dd className="brNegative">{fmtPrice(stop)}</dd></div>
                <div><dt>Custo do erro</dt><dd>{fmtPct(risk)}</dd></div>
                <div><dt>Alvo 50% (histórico)</dt><dd className={setupInvalidated ? "brMuted" : "brPositive"}>{fmtPrice(target50)}</dd></div>
                <div><dt>Alvo principal (histórico)</dt><dd className={setupInvalidated ? "brMuted" : "brPositive"}>{fmtPrice(target100)}</dd></div>
                <div><dt>R/R</dt><dd>{risk !== null && target100 !== null && entry !== null && risk > 0 ? `1 : ${((target100 - entry) / (entry * risk / 100)).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"}</dd></div>
              </dl>
            )}
          </div>
          <div className="brOpCard brTrigger">
            <span>{mode === "fast" ? "GATILHO RÁPIDO (5M)" : `${conservativeChecks.filter((check) => check.state === "confirmed").length}/4 confirmações`}</span>
            {mode === "fast" ? (
              fastCriteria ? (
                <>
                  <div className={`brFastState brFastState-${fastTriggerState.toLowerCase()}`}>
                    <b>{fastTriggerCount}/2 {fastTriggerState}</b>
                    {fastAgainstTrend && <span className="brFastContra">DISPARADO · CONTRA TENDÊNCIA</span>}
                  </div>
                  <small className="brFastMeta">Sinal de curto prazo. Não substitui o veredito 15M/1H.</small>
                  <small className="brFastMeta">Candle 5M fechado: {fmtHHMMRange(last5?.closeTime ?? null, 5 * 60_000)}</small>
                  <small className="brFastDistance">Fech. 5M vs EMA9 5M: {fmtPct(fastDistanceEma5, true)} · vs máxima anterior: {fmtPct(fastDistancePrevHigh, true)}</small>
                  <ul className="brCheckList">
                    <li className={fastCriteria[0] ? "confirmed" : "waiting"}>{fastCriteria[0] ? "✓" : "○"} Fech. 5M acima da EMA9</li>
                    <li className={fastCriteria[1] ? "confirmed" : "waiting"}>{fastCriteria[1] ? "✓" : "○"} Fech. 5M acima da máxima anterior</li>
                  </ul>
                  {fastAgainstTrend && <b className="brCaution">Risco alto: 1H contrário</b>}
                  {fastTriggerCount === 2 && <small className="brFastDisclaimer">Indicador técnico, não é recomendação</small>}
                </>
              ) : (
                <>
                  <b className={setupInvalidated ? "brNegative" : "brMuted"}>{setupInvalidated ? "SETUP INVALIDADO" : "GATILHO 5M INDISPONÍVEL"}</b>
                  <p>Provisório (15M) · última tentativa: {fmtTime(snapshot?.fetchedAt ?? null)}</p>
                </>
              )
            ) : (
              <ul className="brCheckList">{conservativeChecks.map((check, index) => <li key={check.label} className={check.state}>{check.state === "confirmed" ? "✓" : check.state === "invalid" ? "✕" : check.state === "unavailable" ? "—" : "○"} {check.label}{index === 0 && `: ${reading.preservedMinutes ?? "—"} / 60 min`}{index === 1 && `: ${fmtPct(closedEmaDistance, true)} (precisa ≥ 0%)`}{index === 2 && `: ${reading.brakePct === null ? `n/d — ${(freioReason ?? "n/d: motivo indisponível").replace(/^n\/d:\s*/i, "")}` : fmtPct(reading.brakePct)}`}</li>)}</ul>
            )}
          </div>
          <div className="brOpStats">
            <div title="(preço atual − mínima da amplitude) ÷ amplitude"><span>RECUPERAÇÃO AO VIVO ⓘ</span><b className={recoveryClass(liveRecovery)}>{fmtPct(liveRecovery)}</b><small>da amplitude topo→mínima · inclui o candle em formação</small></div>
            <div title="(fechamento 15M − mínima da amplitude) ÷ amplitude"><span>RECUPERAÇÃO FECHADA (15M) ⓘ</span><b className={recoveryClass(closedRecovery)}>{fmtPct(closedRecovery)}</b><small>da amplitude topo→mínima, não é ganho de preço</small></div>
            <div title="(preço atual ÷ EMA9 15M − 1) × 100"><span>PREÇO VS. EMA9 (15M) · AO VIVO ⓘ</span><b className={emaDistance !== null && emaDistance < 0 ? "brNegative" : "brPositive"}>{fmtPct(emaDistance, true)}</b></div>
            <div title="Desaceleração entre dois blocos fechados de 3h"><span>FREIO DA QUEDA ⓘ</span><b className={reading.brakeApplicable ? (reading.brakePct ?? 0) >= (mode === "fast" ? RAPIDO.freioMinPct : 25) ? "brPositive" : "brCaution" : "brMuted"}>{reading.brakeApplicable ? fmtPct(reading.brakePct) : "n/d"}</b><small>{reading.brakeApplicable ? `limite ${mode === "fast" ? RAPIDO.freioMinPct : 25}% (${mode === "fast" ? "Rápido" : "Conservador"})` : (freioReason ?? "motivo indisponível")}</small></div>
          </div>
        </div>
        <div className="brDiagnostics"><span>DIREÇÃO <b>{direction}</b></span><span>QUALIDADE <b>{quality}</b></span><span>CONTEXTO 1H <b>{context1h === "confirmed" ? "Favorável" : context1h === "invalid" ? "Contrário" : context1h === "unavailable" ? "Indisponível" : "Neutro"}</b></span></div>
      </section>

      <div className="brMetrics brMetricsTwo">
        <div className="brMetric">
          <span title="Retorno entre os fechamentos dos últimos 3h">MOVIMENTO RECENTE (3H) ⓘ</span>
          <b className={returnTone(reading.recentReturnPct)}>{fmtPct(reading.recentReturnPct, true)}</b>
          <small className="brMetricSub">
            Anterior: <span className={returnTone(reading.previousReturnPct)}>{fmtPct(reading.previousReturnPct, true)} (3h)</span>
          </small>
        </div>
        <div className="brMetric">
          <span title="Tempo desde a mínima sem nova mínima por fechamento">FUNDO PRESERVADO ⓘ</span>
          {mode === "fast" ? (
            <>
              <b className={fastPreservedMet ? "brPositive" : preservedTone(reading)}>{preservedText}</b>
              <div className={`brPreserveTrack${fastPreservedMet ? " brPreserveTrackMet" : ""}`} aria-hidden="true">
                <i style={{ width: `${fastPreservedTrack}%` }} />
                <em style={{ left: `${fastPreservedMark}%` }} title={`Referência de ${RAPIDO.fundoPreservadoMin} minutos`} />
              </div>
              <small className="brMetricSub">{fastPreservedMet ? `meta ${RAPIDO.fundoPreservadoMin} min atingida` : `meta ${RAPIDO.fundoPreservadoMin} min`}</small>
            </>
          ) : (
            <>
              <b className={preservedTone(reading)}>{preservedText}</b>
              <div className={`brPreserveTrack${preservedMet ? " brPreserveTrackMet" : ""}`} aria-hidden="true">
                <i style={{ width: `${preservedTrack}%` }} />
                <em title="Referência de 60 minutos" />
              </div>
              <small className="brMetricSub">{preservedMet ? "meta atingida" : "meta 60 min"}</small>
            </>
          )}
        </div>
      </div>

      <div className="brActionRow">
      <div className="brAction">
        <span className="brActionLabel">AÇÃO — {mode === "fast" ? "MODO RÁPIDO" : "MODO CONSERVADOR"}</span>
        <><b>{operationalStatus}</b><p>{operationalReason} Movimento {fmtPct(reading.recentReturnPct, true)} (3h), {fmtPct(reading.dropPct, true)} (topo→mínima).</p></>
      </div>
      <div className="brVolumeCard" title="Volume dos últimos 12 candles de 15M comparado à média dos 24h anteriores"><span>VOLUME (3H VS MÉDIA 24H) ⓘ</span><b className={volumeTone}>{volumeHeadline}</b><small>{volumeDetail || "—"}</small></div>
      </div>
      {bar.track && (
        <div className="brBarArea">
          <div className="brBarHead">
            <span>{bar.label}</span>
            {bar.display ? <b>{bar.display}{reading.barMetric === "recovery" ? " · recuperação (ref. 20%)" : reading.barMetric === "brake" ? ` · freio (mín. ${mode === "fast" ? RAPIDO.freioMinPct : 25}% ${mode === "fast" ? "Rápido" : "Conservador"})` : ""}</b> : null}
          </div>
          <div
            className="brBarTrack"
            role="progressbar"
            aria-label={`${bar.label}: ${bar.display}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(bar.value)}
          >
            <i style={{ width: `${bar.value}%` }} />
            {bar.mark !== null && <em style={{ left: `${bar.mark}%` }} title={bar.markTitle} />}
          </div>
        </div>
      )}

      <div className="brContext brFundContext">
        <div className="brFundLeft">
          <div className="brContextRefs">
            <div className="brContextRef brRefMinima">
              <span>
                Mín. 30d
                {minimum30dDistancePct !== null ? (
                  <small className="brRefLabelPct"> ({fmtPct(minimum30dDistancePct, true)}):</small>
                ) : (
                  ":"
                )}
              </span>
              <b
                className={`${minimum30d !== null ? "brNegative" : "brMuted"} brRefValueWithDate${minimum30d === null && dailyRefStatus !== "failed" ? " brRefPending" : ""}`}
                title={minimum30dAt !== null ? `Fundo em ${fmtRefDate(minimum30dAt)}` : undefined}
              >
                {minimum30d !== null ? fmtPrice(minimum30d) : (dailyRefStatus === "failed" ? "—" : "···")}
                <small className={`brRefDate${minimum30dAt !== null && minimum30d !== null ? "" : " brRefDateHidden"}`} aria-hidden={!(minimum30dAt !== null && minimum30d !== null)}>
                  {minimum30dAt !== null && minimum30d !== null ? fmtRefDate(minimum30dAt) : "00/00"}
                </small>
              </b>
            </div>
            <div className="brContextRef">
              <span>Máx. da amplitude:</span>
              <b>{fmtPrice(reading.maximum12h)}</b>
            </div>
            <div className="brContextRef">
              <span>Mín. da queda:</span>
              <b>{fmtPrice(reading.minimum12h)}</b>
            </div>
            <div className="brContextRef">
              <span>EMA9:</span>
              <b>{fmtPrice(reading.ema9)}</b>
            </div>
          </div>
        </div>
        <div className="brFundChart">
          <RadarMiniChart
            candles={snapshot?.m15 ?? []}
            symbol={symbol}
            minimum={reading.minimum12h}
            ema9={reading.ema9}
            state={chartState}
          />
        </div>
      </div>


      <p className="brNote">
        Nível 20% é referência de recuperação da amplitude, não ordem nem gatilho de compra. Somente candles fechados · Binance spot · atualização a cada 60s · não é recomendação.
      </p>
    </article>
  );
}

export default BtcBrakeRadar;
