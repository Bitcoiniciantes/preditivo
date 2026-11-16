"use client";
// app/BtcBrakeRadar.tsx — RADAR DE FREIO DA QUEDA (BTCUSDT).
//
// Card independente do ativo selecionado no Termômetro. Lê somente candles
// públicos e fechados da Binance spot (1h + 15m), a cada 60s, e delega toda a
// matemática para lib/brake-radar.ts. Não repete CVD, funding, OI, RSI, order
// book nem qualquer métrica de microestrutura. Não executa ordens.

import { useEffect, useMemo, useState } from "react";
import {
  analyzeBrakeRadar,
  fetchBrakeKlines,
  formatPreservedMinutes,
  BRAKE_PRESERVED_REFERENCE_MIN,
  type BrakeKlinesSnapshot,
  type BrakeRadarReading,
} from "../lib/brake-radar";

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
  return `$${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
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
function barView(reading: BrakeRadarReading): BarView {
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
      mark: 25,
      markTitle: "Mínimo de 25% para sinal de reação",
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
  if (trend === "down") return "brCaution";
  return "brMuted";
}

function changeTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "brMuted";
  if (value > 0) return "brPositive";
  if (value < 0) return "brNegative";
  return "brMuted";
}

function quoteTone(dailyChangePct: number | null, tickTrend: PriceTrend): string {
  if (dailyChangePct !== null && Number.isFinite(dailyChangePct)) {
    if (dailyChangePct > 0) return "brPositive";
    if (dailyChangePct < 0) return "brCaution";
  }
  return priceTrendTone(tickTrend);
}

export function BtcBrakeRadar({
  livePrice = null,
  dailyChangePct = null,
}: {
  livePrice?: number | null;
  dailyChangePct?: number | null;
}) {
  const [snapshot, setSnapshot] = useState<BrakeKlinesSnapshot | null>(null);
  const [now, setNow] = useState(0);
  const [priceTrend, setPriceTrend] = useState<PriceTrend>("flat");
  const [trackedPrice, setTrackedPrice] = useState<number | null>(null);
  const validLivePrice = livePrice !== null && Number.isFinite(livePrice) && livePrice > 0
    ? livePrice
    : null;

  // Compara com a cotação válida anterior sem setState dentro de efeito.
  if (validLivePrice !== null && validLivePrice !== trackedPrice) {
    if (trackedPrice !== null && trackedPrice > 0) {
      const delta = (validLivePrice / trackedPrice - 1) * 100;
      setPriceTrend(Math.abs(delta) < 0.01 ? "flat" : delta > 0 ? "up" : "down");
    } else {
      setPriceTrend("flat");
    }
    setTrackedPrice(validLivePrice);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();

    const load = async () => {
      if (running) return;
      running = true;
      try {
        const next = await fetchBrakeKlines(controller.signal);
        if (active) {
          setSnapshot(next);
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
  }, []);

  const reading = useMemo(
    () => analyzeBrakeRadar({
      h1: snapshot?.h1 ?? [],
      m15: snapshot?.m15 ?? [],
      fetchedAt: snapshot?.fetchedAt ?? null,
      now,
    }),
    [snapshot, now],
  );

  const bar = barView(reading);
  const displayedPrice = validLivePrice ?? reading.lastClose15m;
  const preservedText = formatPreservedMinutes(reading.preservedMinutes);
  const preservedMet = reading.preservedMinutes !== null
    && reading.preservedMinutes >= BRAKE_PRESERVED_REFERENCE_MIN;
  const preservedTrack = reading.preservedMinutes === null
    ? 0
    : Math.max(0, Math.min(100, (reading.preservedMinutes / (BRAKE_PRESERVED_REFERENCE_MIN * 2)) * 100));

  return (
    <article
      className={`card brakeRadar tone-${reading.tone}`}
      aria-live="polite"
      aria-label="Radar de freio da queda do Bitcoin"
    >
      <div className="brHead">
        <div className="brHeadMain">
          <h3 className="brTitle">BITCOIN — RADAR DE FREIO DA QUEDA</h3>
          <span className="brKicker">BTC/USDT</span>
          <div className="brState">{reading.label}</div>
        </div>
        <div className="brHeadSide">
          <span className="brBadge">{reading.badge}</span>
          <small className="brUpdated">Atualizado às {fmtTime(reading.updatedAt)}</small>
        </div>
      </div>

      <div className="brMetrics">
        <div className="brMetric">
          <span>MOVIMENTO RECENTE (3H)</span>
          <b className={returnTone(reading.recentReturnPct)}>{fmtPct(reading.recentReturnPct, true)}</b>
          <small className="brMetricSub">
            Anterior: <span className={returnTone(reading.previousReturnPct)}>{fmtPct(reading.previousReturnPct, true)}</span>
          </small>
        </div>
        <div className="brMetric">
          <span>RECUPERAÇÃO DA QUEDA</span>
          <b className={recoveryTone(reading)}>{fmtPct(reading.retracementPct)}</b>
          <small className="brMetricSub">
            {reading.hasDrop ? "amplitude topo → mínima" : "contexto · sem DCA"}
          </small>
        </div>
        <div className="brMetric">
          <span>FUNDO PRESERVADO</span>
          <b className={preservedTone(reading)}>{preservedText}</b>
          <div className="brPreserveTrack" aria-hidden="true">
            <i style={{ width: `${preservedTrack}%` }} />
            <em title="Referência de 60 minutos" />
          </div>
          <small className="brMetricSub">{preservedMet ? "meta atingida" : "meta 60 min"}</small>
        </div>
      </div>

      <div className={`brBarArea${bar.track ? "" : " brBarAreaEmpty"}`}>
        <div className="brBarHead">
          <span>{bar.label}</span>
          {bar.display ? <b>{bar.display}</b> : null}
        </div>
        {bar.track && (
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
        )}
      </div>

      <div className="brContext">
        <div className="brContextRefs">
          <span>Mínima: <b>{fmtPrice(reading.minimum12h)}</b></span>
          <span>Nível 20%: <b>{fmtPrice(reading.targetDcaPrice)}</b></span>
          <span>EMA9: <b>{fmtPrice(reading.ema9)}</b></span>
        </div>
        <div className="brCurrentPrice" aria-label="Cotação atual do Bitcoin">
          <div className="brQuoteLine">
            <span className="brQuoteAsset">BTC:</span>
            <b className={quoteTone(dailyChangePct, priceTrend)}>{fmtCurrentPrice(displayedPrice)}</b>
            {dailyChangePct !== null && Number.isFinite(dailyChangePct) ? (
              <small className={`brDailyChange ${changeTone(dailyChangePct)}`}>
                {fmtDailyChange(dailyChangePct)}
              </small>
            ) : null}
          </div>
        </div>
      </div>

      <div className="brAction">
        <span className="brActionLabel">AÇÃO</span>
        <b>{reading.action}</b>
        <p>{reading.reason}</p>
      </div>

      <p className="brNote">
        Nível 20% é referência de recuperação, não ordem nem gatilho de compra. Somente candles fechados · Binance spot · atualização a cada 60s · não é recomendação.
      </p>
    </article>
  );
}

export default BtcBrakeRadar;
