"use client";
// app/BtcRadarReversal.tsx — BITCOIN · RADAR DE REVERSÃO.
//
// Abas exclusivas do Termômetro Preditivo:
// - CAÇA-FUNDOS: mantém integralmente o Radar de Freio da Queda existente;
// - CAÇA-TOPOS: novo Radar de Exaustão de Alta (lib/top-radar.ts).
//
// A aquisição de candles é compartilhada: um único fetch de 1h + 15m alimenta
// as duas abas. Nenhum endpoint novo é usado e nenhuma ordem é executada.

import { useEffect, useState } from "react";
import { fetchBrakeKlines, BRAKE_ASSETS, type BrakeAssetSymbol, type BrakeKlinesSnapshot } from "../lib/brake-radar";
import { BtcBrakeRadar } from "./BtcBrakeRadar";
import { BtcTopRadar } from "./BtcTopRadar";
import { MultiAssetFundMonitor } from "./MultiAssetFundMonitor";

const REFRESH_MS = 60_000;

type RadarTab = "fundos" | "topos";

export function BtcRadarReversal({
  livePrice = null,
  dailyChangePct = null,
}: {
  livePrice?: number | null;
  dailyChangePct?: number | null;
}) {
  // A página sempre abre no Caça-Fundos, preservando a leitura principal.
  const [tab, setTab] = useState<RadarTab>("fundos");
  const [snapshot, setSnapshot] = useState<BrakeKlinesSnapshot | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<BrakeAssetSymbol>("BTCUSDT");
  const [selectedSnapshot, setSelectedSnapshot] = useState<BrakeKlinesSnapshot | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (snapshot && selectedSymbol === "BTCUSDT") setSelectedSnapshot(snapshot);
  }, [snapshot, selectedSymbol]);

  const selectedAsset = BRAKE_ASSETS.find(({ symbol }) => symbol === selectedSymbol) ?? BRAKE_ASSETS[0];

  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();

    const load = async () => {
      if (running) return;
      running = true;
      try {
        const next = await fetchBrakeKlines(controller.signal);
        if (active) setSnapshot(next);
      } catch (error) {
        // Mantém a última leitura válida. O analisador bloqueia sinais quando
        // os dados envelhecem além de 2 minutos.
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

  return (
    <section className="radarReversal" aria-label="Bitcoin — Radar de Reversão">
      <div className="rrShell">
        <div className="rrHead">
          <div className="rrHeadMain">
            <span className="rrKicker">BTC/USDT · CANDLES FECHADOS</span>
            <h3 className="rrTitle">BITCOIN — RADAR DE REVERSÃO</h3>
          </div>
          <span className="rrSource">BINANCE SPOT · 15M + 1H</span>
        </div>

        <div className="rrTabs" role="tablist" aria-label="Radar de reversão">
          <button
            type="button"
            role="tab"
            id="rr-tab-fundos"
            aria-controls="rr-panel-fundos"
            aria-selected={tab === "fundos"}
            tabIndex={tab === "fundos" ? 0 : -1}
            className="rrTab"
            onClick={() => setTab("fundos")}
          >
            CAÇA-FUNDOS
          </button>
          <button
            type="button"
            role="tab"
            id="rr-tab-topos"
            aria-controls="rr-panel-topos"
            aria-selected={tab === "topos"}
            tabIndex={tab === "topos" ? 0 : -1}
            className="rrTab"
            onClick={() => setTab("topos")}
          >
            CAÇA-TOPOS
          </button>
        </div>
        <MultiAssetFundMonitor
          btcSnapshot={snapshot}
          onSelect={(symbol, nextSnapshot) => {
            setSelectedSymbol(symbol);
            setSelectedSnapshot(nextSnapshot);
          }}
        />
      </div>

      <div
        className="rrPanel"
        id="rr-panel-fundos"
        role="tabpanel"
        aria-labelledby="rr-tab-fundos"
        hidden={tab !== "fundos"}
      >
        <BtcBrakeRadar
          symbol={selectedSymbol}
          assetName={selectedAsset.name}
          snapshot={selectedSnapshot}
          now={now}
          livePrice={livePrice}
          dailyChangePct={dailyChangePct}
        />
      </div>

      <div
        className="rrPanel"
        id="rr-panel-topos"
        role="tabpanel"
        aria-labelledby="rr-tab-topos"
        hidden={tab !== "topos"}
      >
        <BtcTopRadar
          snapshot={snapshot}
          now={now}
          livePrice={livePrice}
          dailyChangePct={dailyChangePct}
        />
      </div>
    </section>
  );
}

export default BtcRadarReversal;
