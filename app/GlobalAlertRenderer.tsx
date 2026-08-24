"use client";

// app/GlobalAlertRenderer.tsx
// Renderiza os alertas disparados pelo motor global, independentemente da
// página ou do ativo aberto. Posicionar na raiz do layout, dentro do
// GlobalAlertProvider (alerta2.md, seção 5).

import { useGlobalAlerts } from "./GlobalAlertContext";
import { SupportResistanceAlert } from "./SupportResistanceAlert";

export function GlobalAlertRenderer({ currency }: { currency: string }) {
  const { activeAlerts, removeActiveAlert } = useGlobalAlerts();

  if (activeAlerts.length === 0) return null;

  return (
    <div
      className="globalAlertContainer"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {activeAlerts.map((alert) => (
        <SupportResistanceAlert
          key={alert.id}
          asset={alert.symbol}
          type={alert.type}
          price={alert.price}
          timestamp={alert.timestamp}
          currency={currency}
          isVisible={true}
          onDismiss={() => removeActiveAlert(alert.id)}
        />
      ))}
    </div>
  );
}
