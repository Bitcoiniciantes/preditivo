"use client";
// Contexto do veredito congelado da Fase 1 (lido no build pelo layout).
// O painel preditivo NUNCA calcula nada: ele só exibe o que este relatório já
// demonstrou fora da amostra. Sem relatório → estado "sem avaliação".
import { createContext, useContext } from "react";
import type { Fase1Verdict } from "../lib/fase1-verdict";

const Fase1VerdictContext = createContext<Fase1Verdict | null>(null);

export function Fase1VerdictProvider({ report, children }: { report: Fase1Verdict | null; children: React.ReactNode }) {
  return <Fase1VerdictContext.Provider value={report}>{children}</Fase1VerdictContext.Provider>;
}

export function useFase1Verdict(): Fase1Verdict | null {
  return useContext(Fase1VerdictContext);
}
