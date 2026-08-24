"use client";

import { useEffect } from "react";

export function SupportResistanceAlert({
  asset,
  type,
  price,
  timestamp,
  currency,
  isVisible,
  onDismiss,
}: {
  asset: string;
  type: "SUPPORT" | "RESISTANCE";
  price: number;
  timestamp: number;
  currency: string;
  isVisible: boolean;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!isVisible) return;
    // Auto-dismiss após 10 segundos
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [timestamp, isVisible, onDismiss]);

  if (!isVisible) return null;

  const isSupport = type === "SUPPORT";

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
          {currency} {price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
