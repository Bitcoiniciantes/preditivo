"use client";

import { useEffect } from "react";
import type { AlertState } from "./useSupportResistanceAlert";

export function SupportResistanceAlert({
  alert,
  asset,
  currency,
  onDismiss,
}: {
  alert: AlertState | null;
  asset: string;
  currency: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!alert?.isVisible) return;
    // Auto-dismiss após 10 segundos
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [alert?.timestamp, alert?.isVisible, onDismiss]);

  if (!alert?.isVisible) return null;

  const isSupport = alert.type === "SUPPORT";

  return (
    <div
      className={`priceAlert ${isSupport ? "supportAlert" : "resistanceAlert"}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="priceAlertIcon">{isSupport ? "⬇️" : "⬆️"}</div>
      <div className="priceAlertContent">
        <strong>{isSupport ? "SUPORTE ATINGIDO" : "RESISTÊNCIA ATINGIDA"}</strong>
        <span>{asset}</span>
        <span className="priceAlertPrice">
          {currency} {alert.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <button
        className="priceAlertClose"
        onClick={onDismiss}
        aria-label="Fechar alerta"
        type="button"
      >
        ×
      </button>
    </div>
  );
}
