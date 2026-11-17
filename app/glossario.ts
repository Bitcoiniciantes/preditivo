// app/glossario.ts
// Vocabulário canônico do Indicador Único (Fase 1A).
//
// Contém SOMENTE equivalências confirmadas pela Fase 0, isto é, rótulos que
// representam a mesma variável/fonte já exibida nos painéis atuais.
// Nenhuma equivalência puramente semântica foi inventada aqui.
// Código desconhecido nunca ganha rótulo novo: o código cru é exibido.
//
// Não usar "ABSORÇÃO COMPRADORA" (sem decisão explícita do dono).
// "Compradores/Vendedores dominando" e "PRESSÃO COMPRADORA/VENDEDORA" NÃO são
// equivalentes a flow_regime e por isso NÃO constam deste módulo.
//
// LINGUAGEM PROIBIDA (vale para preço, funding, OI, volatilidade e qualquer
// métrica — decorrente do Passo 2, §§6/13): nenhuma frase, rótulo, tooltip ou
// descrição pode narrar comportamento FUTURO da métrica ("reversão próxima",
// "prestes a", "antecede", "virada", "chance/probabilidade de", "sinal de
// compra/venda", "recomendação de entrada/saída"). Descrever somente onde a
// métrica ESTÁ agora (nível, classe, estado observado), nunca o que ela fará.

export type Tom = "bull" | "bear" | "range" | "neutral" | "info" | "absorption" | "steady";

export const COR_TOM: Record<Tom, string> = {
  bull: "var(--lime)",
  bear: "var(--red)",
  range: "#f0ad4e",
  neutral: "var(--muted)",
  info: "var(--cyan)",
  absorption: "#9b70ed",
  steady: "#8ea3b7",
};

export interface Rotulo {
  label: string;
  tone: Tom;
}

function cru(codigo: string): Rotulo {
  return { label: codigo || "—", tone: "neutral" };
}

export function rotuloRegime(codigo: string | undefined): Rotulo {
  switch (codigo) {
    case "BULL_TREND":
      return { label: "TENDÊNCIA ALTA", tone: "bull" };
    case "BEAR_TREND":
      return { label: "TENDÊNCIA BAIXA", tone: "bear" };
    case "RANGE":
      return { label: "LATERAL", tone: "range" };
    default:
      return cru(codigo ?? "");
  }
}

export function rotuloFlow(codigo: string | undefined): Rotulo {
  switch (codigo) {
    case "BULL_FLOW":
      return { label: "FLUXO COMPRADOR", tone: "bull" };
    case "BEAR_FLOW":
      return { label: "FLUXO VENDEDOR", tone: "bear" };
    case "NEUTRAL_FLOW":
      return { label: "FLUXO NEUTRO", tone: "steady" };
    default:
      return cru(codigo ?? "");
  }
}

export function rotuloAbsorcao(codigo: string | undefined): Rotulo {
  switch (codigo) {
    case "BULL_ABSORPTION":
      return { label: "ABSORÇÃO COMPRA", tone: "absorption" };
    case "BEAR_ABSORPTION":
      return { label: "ABSORÇÃO VENDA", tone: "absorption" };
    case "NONE":
      return { label: "NENHUMA", tone: "neutral" };
    default:
      return cru(codigo ?? "");
  }
}

export function rotuloDivergencia(codigo: string | undefined): Rotulo {
  switch (codigo) {
    case "DIVERGENCE_BULL":
      return { label: "DIVERGÊNCIA DE ALTA", tone: "range" };
    case "DIVERGENCE_BEAR":
      return { label: "DIVERGÊNCIA DE BAIXA", tone: "range" };
    case "NONE":
      return { label: "NENHUMA", tone: "neutral" };
    default:
      return cru(codigo ?? "");
  }
}

// Classe de funding do snapshot (`neutral`, `positive`, `negative`, `extreme`
// em `derivatives/funding.ts:16-24`). Só tradução de rótulo; a distinção de
// extremo é preservada como está no motor.
export function rotuloFunding(codigo: string | undefined): string {
  switch (codigo) {
    case "positive":
      return "positivo";
    case "negative":
      return "negativo";
    case "neutral":
      return "neutro";
    case "extreme":
      return "extremo";
    default:
      return codigo || "—";
  }
}

// Ação textual dos eventos do histórico (tradução de rótulo; o tipo cru é
// mantido para tipos desconhecidos — nada é agrupado nem descartado).
export function acaoEvento(type: string): string | null {
  switch (type) {
    case "absorption_triggered":
      return "Absorção iniciada";
    case "absorption_interrupted":
      return "Absorção interrompida";
    case "absorption_resolved":
      return "Absorção encerrada";
    case "absorption_failed":
      return "Absorção expirada";
    case "divergence":
      return "Divergência";
    case "divergence_resolved":
      return "Divergência confirmada";
    case "divergence_failed":
      return "Divergência não confirmada";
    case "flow_change":
      return "Fluxo";
    default:
      return null;
  }
}

// Rótulo do destino (`to`) de um evento do histórico, pelo domínio do tipo.
export function rotuloDestinoEvento(type: string, to: string): string {
  if (type === "flow_change") return rotuloFlow(to).label;
  if (type.startsWith("absorption")) return rotuloAbsorcao(to).label;
  if (type === "divergence") return rotuloDivergencia(to).label;
  return rotuloRegime(to).label;
}

// Tom do marcador do histórico: mudança de regime pela direção `to`.
export function tomEvento(type: string, to: string): Tom {
  if (type === "regime_change") {
    if (to === "BULL_TREND") return "bull";
    if (to === "BEAR_TREND") return "bear";
    if (to === "RANGE") return "range";
    return "neutral";
  }
  if (type.startsWith("divergence")) return "range";
  if (type.startsWith("absorption")) return "absorption";
  if (type === "flow_change") return "steady";
  return "neutral";
}
