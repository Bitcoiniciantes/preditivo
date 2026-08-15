export type PositionSide = "LONG" | "SHORT";

export type PositionInput = {
  averagePrice: number;
  quantity: number;
  currentPrice: number;
  side: PositionSide;
};

export function calculatePosition(input: PositionInput) {
  const { averagePrice, quantity, currentPrice, side } = input;
  if (![averagePrice, quantity, currentPrice].every(Number.isFinite) || averagePrice <= 0 || quantity <= 0 || currentPrice <= 0) return null;
  const costBasis = averagePrice * quantity;
  const grossPnl = (side === "LONG" ? currentPrice - averagePrice : averagePrice - currentPrice) * quantity;
  return { costBasis, grossPnl, grossPercent: grossPnl / costBasis * 100 };
}
