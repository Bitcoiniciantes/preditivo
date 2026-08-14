export type AlertBand = "FORA" | "COMPRA" | "COMPRA_FORTE";

export type AlertTransition = "ENTRADA" | "FORTALECEU" | "ENFRAQUECEU" | "ENCERROU" | null;
export type AlertPreference = "FORTES" | "TODOS" | "CAPITULACAO";
export type AlertKind = "COMPRA" | "COMPRA_FORTE" | "SAIDA_COMPRA" | "SAIDA_FORTE" | "CAPITULACAO" | "OPORTUNIDADE" | "BTC_COMPRA";
export type RsiOpportunity = "COMPRA_RETESTE_15M" | "COMPRA_4H" | "VENDA_1H" | "VENDA_4H" | "VENDA_1D" | "VENDA_1S" | "COMPRA_BRENT_1H" | "VENDA_BRENT_1H" | "COMPRA_LINK_1H" | "COMPRA_LINK_4H" | null;
export type SubscriberCommand =
  | "START"
  | "STOP"
  | "STATUS"
  | "HELP"
  | "MOVEMENT4_ON"
  | "MOVEMENT4_OFF"
  | AlertPreference
  | null;

export function alertBand(score: number): AlertBand {
  if (score >= 55) return "COMPRA_FORTE";
  if (score >= 20) return "COMPRA";
  return "FORA";
}

export function alertTransition(
  previous: AlertBand | undefined,
  current: AlertBand,
): AlertTransition {
  if (!previous || previous === current) return null;
  if (previous === "FORA" && current !== "FORA") return "ENTRADA";
  if (previous === "COMPRA" && current === "COMPRA_FORTE") return "FORTALECEU";
  if (previous === "COMPRA_FORTE" && current === "COMPRA") return "ENFRAQUECEU";
  if (previous !== "FORA" && current === "FORA") return "ENCERROU";
  return null;
}

export function capitulationDetected(metrics: {
  rsi: number;
  atrDistance: number;
  volumeRatio: number;
}) {
  return metrics.rsi <= 30 && metrics.atrDistance <= -2 && metrics.volumeRatio >= 1.5;
}

export function rsiOpportunity(asset: string, period: string, rsi: number): RsiOpportunity {
  if (!Number.isFinite(rsi)) return null;
  if (asset === "BRENT" && period === "1H") {
    if (rsi < 21) return "COMPRA_BRENT_1H";
    if (rsi > 80) return "VENDA_BRENT_1H";
    return null;
  }
  if (asset === "LINK" && period === "1H" && rsi < 25) return "COMPRA_LINK_1H";
  if (asset === "LINK" && period === "4H" && rsi < 25) return "COMPRA_LINK_4H";
  if (period === "15M" && rsi < 18) return "COMPRA_RETESTE_15M";
  if (period === "4H" && rsi <= 20) return "COMPRA_4H";
  if (period === "1H" && rsi >= 79) return "VENDA_1H";
  if (period === "4H" && rsi >= 79) return "VENDA_4H";
  if (period === "1D" && rsi >= 88) return "VENDA_1D";
  if (period === "1S" && rsi >= 88) return "VENDA_1S";
  return null;
}

export function capitulationConfirmed(metrics: {
  sourceClose: number;
  confirmationClose: number;
  volumeRatio: number;
}) {
  return (
    Number.isFinite(metrics.sourceClose) &&
    Number.isFinite(metrics.confirmationClose) &&
    metrics.confirmationClose < metrics.sourceClose &&
    metrics.volumeRatio >= 1.5
  );
}

export function sellingPressureStabilized(metrics: {
  open: number;
  close: number;
  low: number;
  referenceLow: number;
  volumeRatio: number;
}) {
  return (
    metrics.close > metrics.open &&
    metrics.low >= metrics.referenceLow &&
    metrics.volumeRatio >= 1
  );
}

export function alertKind(
  transition: AlertTransition,
  current: AlertBand,
  previous?: AlertBand,
): AlertKind | null {
  if (!transition) return null;
  if (transition === "ENFRAQUECEU") return "SAIDA_FORTE";
  if (transition === "ENCERROU") {
    return previous === "COMPRA_FORTE" ? "SAIDA_FORTE" : "SAIDA_COMPRA";
  }
  return current === "COMPRA_FORTE" ? "COMPRA_FORTE" : "COMPRA";
}

export function shouldDeliverAlert(preference: AlertPreference, kind: AlertKind) {
  if (kind === "CAPITULACAO" || kind === "BTC_COMPRA") return true;
  if (preference === "CAPITULACAO") return false;
  if (kind === "OPORTUNIDADE") return true;
  if (preference === "TODOS") return true;
  return kind === "COMPRA_FORTE" || kind === "SAIDA_FORTE";
}
export function bitcoinMovement(reference: number, current: number, threshold = 4) {
  if (!Number.isFinite(reference) || reference <= 0 || !Number.isFinite(current) || current <= 0) {
    return null;
  }
  const changePercent = ((current / reference) - 1) * 100;
  if (changePercent >= threshold) return { direction: "ALTA" as const, changePercent };
  if (changePercent <= -threshold) return { direction: "QUEDA" as const, changePercent };
  return null;
}
export function subscriberCommand(text: unknown): SubscriberCommand {
  if (typeof text !== "string") return null;
  const parts = text.trim().toLocaleLowerCase("pt-BR").split(/\s+/);
  const command = parts[0];
  const argument = parts[1];
  if (command === "/start" || command === "/ativar" || command === "ativar") return "START";
  if (command === "/parar" || command === "parar") return "STOP";
  if (command === "/status" || command === "status") return "STATUS";
  if (command === "/ajuda" || command === "/help" || command === "ajuda") return "HELP";
  if (command === "/fortes" || command === "fortes") return "FORTES";
  if (command === "/todos" || command === "todos") return "TODOS";
  if (command === "/capitulacao" || command === "capitulacao" || command === "capitulação") {
    return "CAPITULACAO";
  }
  if (command === "/movimento4" || command === "movimento4") {
    return ["parar", "off", "desativar"].includes(argument) ? "MOVEMENT4_OFF" : "MOVEMENT4_ON";
  }
  return null;
}
