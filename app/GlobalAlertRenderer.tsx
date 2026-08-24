"use client";

// app/GlobalAlertRenderer.tsx
// Renderiza APENAS os alertas disparados (popups flutuantes), independentemente
// da página ou do ativo aberto. Consome `alertEvents` e `acknowledgeAlert` do
// GlobalAlertContext.
//
// O AlertPanel (gerenciamento) NÃO vive aqui — ele é montado no fluxo da página
// (app/page.tsx), acima do rodapé, em container com a largura do site.

import { useGlobalAlerts } from "./GlobalAlertContext";
import { SupportResistanceAlert } from "./SupportResistanceAlert";

export function GlobalAlertRenderer({ currency }: { currency: string }) {
  const { alertEvents, acknowledgeAlert } = useGlobalAlerts();

  if (alertEvents.length === 0) return null;

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
      {alertEvents.map((event) => (
        <SupportResistanceAlert
          key={`${event.symbol}-${event.type}-${event.timestamp}`}
          asset={event.symbol}
          type={event.type === "SUPPORT_HIT" ? "SUPPORT" : "RESISTANCE"}
          price={event.price}
          timestamp={event.timestamp}
          currency={currency}
          isVisible={true}
          onDismiss={() => acknowledgeAlert(event.symbol)}
        />
      ))}
    </div>
  );
}
