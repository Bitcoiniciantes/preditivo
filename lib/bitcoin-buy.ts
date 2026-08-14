export const bitcoinBuyLevels = {
  COMPRAR_AGORA: { ceiling: 57_000, action: "COMPRAR AGORA" },
  COMPRAR_URGENTE: { ceiling: 54_000, action: "COMPRAR URGENTE" },
  COMPRA_EXTREMA: { ceiling: 52_000, action: "COMPRA EXTREMA" },
  FLUSH_BITCOIN: { ceiling: 49_999.99, action: "FLUSH BITCOIN - COMPRAR TUDO" },
} as const;

export type BitcoinBuyLevel = keyof typeof bitcoinBuyLevels;

export function bitcoinBuyLevel(price: number): BitcoinBuyLevel | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (price <= bitcoinBuyLevels.FLUSH_BITCOIN.ceiling) return "FLUSH_BITCOIN";
  if (price <= bitcoinBuyLevels.COMPRA_EXTREMA.ceiling) return "COMPRA_EXTREMA";
  if (price <= bitcoinBuyLevels.COMPRAR_URGENTE.ceiling) return "COMPRAR_URGENTE";
  if (price <= bitcoinBuyLevels.COMPRAR_AGORA.ceiling) return "COMPRAR_AGORA";
  return null;
}

function rank(level: BitcoinBuyLevel | null | undefined) {
  if (level === "FLUSH_BITCOIN") return 4;
  if (level === "COMPRA_EXTREMA") return 3;
  if (level === "COMPRAR_URGENTE") return 2;
  if (level === "COMPRAR_AGORA") return 1;
  return 0;
}

export function bitcoinBuyLevelTransition(
  previous: BitcoinBuyLevel | null | undefined,
  current: BitcoinBuyLevel | null,
) {
  return current && rank(current) > rank(previous) ? current : null;
}
