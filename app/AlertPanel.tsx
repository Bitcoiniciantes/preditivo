"use client";

// app/AlertPanel.tsx
// Painel de gerenciamento de alertas (Fase 1 — ALERTA_PAINEL.md Parte 1B).
// Consome APENAS o motor global (useGlobalAlerts). NÃO calcula S/R: os níveis
// vêm do Gráfico/Structure Engine e são enviados ao motor via registerAlert.
//
// Regra V4: o painel não possui motor próprio — todo cálculo de crossover e
// congelamento vive no GlobalAlertContext.

import { useEffect, useState } from "react";
import { useGlobalAlerts, isAlertFrozen } from "./GlobalAlertContext";

type Props = {
  currency: string;
  // S/R calculados pelo gráfico/Structure Engine para o ativo selecionado.
  // O painel apenas os encaminha ao motor via registerAlert.
  currentSymbol?: string;
  currentSupport?: number;
  currentResistance?: number;
  currentPeriod?: string;
};

export function AlertPanel({
  currency,
  currentSymbol,
  currentSupport,
  currentResistance,
  currentPeriod = "1H",
}: Props) {
  const { alertConfigs, alertStates, alertEvents, registerAlert, removeAlert, toggleAlert, acknowledgeAlert } =
    useGlobalAlerts();

  const [notice, setNotice] = useState<string | null>(null);

  // Timestamp estável para avaliação de freeze (V4: isAlertFrozen(state, ts)
  // recebe o tempo explicitamente — sem Date.now() no render). Atualizado por
  // efeito, como um relógio.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const registerCurrent = () => {
    if (!currentSymbol || !currentSupport || !currentResistance) {
      setNotice("Selecione um ativo no gráfico para registrar os níveis atuais.");
      return;
    }
    registerAlert({
      symbol: currentSymbol,
      support: currentSupport,
      resistance: currentResistance,
      period: currentPeriod,
    });
    setNotice(`Alerta registrado para ${currentSymbol} (S ${currentSupport} / R ${currentResistance}).`);
  };

  const symbols = Object.keys(alertConfigs).sort();

  return (
    <article className="card alertPanel">
      <div className="cardTitle">
        <div>
          <span>ALERTAS DE PREÇO</span>
          <b>Suporte × Resistência</b>
        </div>
      </div>

      <div className="alertPanelBody">
        {notice && <p className="alertPanelNotice" role="status">{notice}</p>}

        {currentSymbol && currentSupport && currentResistance ? (
          <button type="button" className="alertPanelRegister" onClick={registerCurrent}>
            ➕ Registrar alerta: {currentSymbol} (S {currentSupport.toLocaleString("pt-BR")} / R {currentResistance.toLocaleString("pt-BR")})
          </button>
        ) : null}

        {symbols.length === 0 ? (
          <p className="alertPanelEmpty">Nenhum alerta registrado. Use o botão acima para monitorar o ativo do gráfico.</p>
        ) : (
          <div className="alertPanelList">
            {symbols.map((symbol) => {
              const config = alertConfigs[symbol];
              const state = alertStates[symbol];
              const frozen = state ? isAlertFrozen(state, now) : false;
              const pendingEvents = alertEvents.filter((e) => e.symbol === symbol);
              const lastEvent = pendingEvents[pendingEvents.length - 1];

              return (
                <div key={symbol} className={`alertPanelRow ${config.enabled ? "enabled" : ""}`}>
                  <div className="alertPanelRowHead">
                    <b>{symbol}</b>
                    <span className={`alertPanelStatus ${config.enabled ? "on" : "off"}`}>
                      {config.enabled ? "ATIVO" : "PAUSADO"}
                    </span>
                  </div>
                  <div className="alertPanelLevels">
                    <span>S {config.support.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>
                    <span>R {config.resistance.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</span>
                    <span className="alertPanelPeriod">{config.period}</span>
                  </div>
                  <div className="alertPanelMeta">
                    {config.enabled && state ? (
                      <>
                        <span>Base: {state.lastPrice !== null ? state.lastPrice.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "aguardando 1º preço"}</span>
                        {state.triggered && <span className="alertPanelTriggered">⚡ {state.triggeredType === "SUPPORT_HIT" ? "SUPORTE" : "RESISTÊNCIA"} ATINGIDO</span>}
                        {frozen && <span className="alertPanelFrozen">🧊 congelado</span>}
                      </>
                    ) : null}
                    {lastEvent && (
                      <span className="alertPanelEvent">
                        🕐 {lastEvent.type === "SUPPORT_HIT" ? "Suporte" : "Resistência"} em {currency} {lastEvent.price.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} —{" "}
                        <button type="button" className="alertPanelAck" onClick={() => acknowledgeAlert(symbol)}>
                          OK
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="alertPanelActions">
                    <button type="button" className="alertPanelToggle" onClick={() => toggleAlert(symbol)}>
                      {config.enabled ? "Pausar" : "Ativar"}
                    </button>
                    <button type="button" className="alertPanelRemove" onClick={() => removeAlert(symbol)} title={`Remover ${symbol}`}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
