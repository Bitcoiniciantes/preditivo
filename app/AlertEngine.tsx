"use client";

// app/AlertEngine.tsx
// Ponte entre o feed global de preços e o motor de alertas (alerta2.md seções
// 7 e 9). Vive na raiz do layout: cria o livePrices multi-ativo (cobrindo
// todos os criptos do projeto, não só o ativo selecionado), envolve a árvore
// com o GlobalAlertProvider e renderiza os alertas globalmente.
//
// Criptos monitorados: os do defaults do projeto que têm stream Binance.
// Ativos estáticos (MSTR, PRATA, COBRE, URÂNIO) não têm ticker ao vivo e ficam
// fora do feed — alertas para eles não disparam (documentado no audit).

import { useLivePrices } from "../lib/useLivePrices";
import { GlobalAlertProvider } from "./GlobalAlertContext";
import { GlobalAlertRenderer } from "./GlobalAlertRenderer";

const CRYPTO_SYMBOLS = ["BTC", "ETH", "LINK", "AVAX", "PAXG"];

export function AlertEngine({ children }: { children: React.ReactNode }) {
  const { livePrices } = useLivePrices(CRYPTO_SYMBOLS, true);

  return (
    <GlobalAlertProvider livePrices={livePrices}>
      {children}
      <GlobalAlertRenderer currency="USDT" />
    </GlobalAlertProvider>
  );
}
