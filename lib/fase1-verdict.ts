// lib/fase1-verdict.ts — SOMENTE server-side (usado pelo layout no build/dev).
// Lê o relatório congelado da Fase 1 (FASE1_EXPERIMENTO_MINIMO.md) e extrai o veredito
// por horizonte. O relatório é regenerado por scripts/fase1-experimento-minimo.mjs
// (congelado); o painel apenas reflete o que o experimento já demonstrou — nunca inventa.
import fs from "node:fs";
import path from "node:path";

export type Fase1HorizonVerdict = {
  evidence: string; // "nenhuma" ou lista de features com evidência fora da amostra
};

export type Fase1Verdict = {
  generatedAt: string | null;
  conclusion: string | null;
  horizons: Record<string, Fase1HorizonVerdict>;
};

export function readFase1Verdict(): Fase1Verdict | null {
  try {
    const file = path.join(process.cwd(), "FASE1_EXPERIMENTO_MINIMO.md");
    if (!fs.existsSync(file)) return null;
    const md = fs.readFileSync(file, "utf8");

    const horizons: Record<string, Fase1HorizonVerdict> = {};
    const horizonRe = /^- Horizonte (\d+) min \(treino \d+ \/ teste \d+\):/gm;
    const evRe = /^\s+- evidência fora da amostra \(a\+b\+c\): (.+)$/gm;
    const hBlocks = [...md.matchAll(horizonRe)];
    const evMatches = [...md.matchAll(evRe)];
    hBlocks.forEach((h, i) => {
      horizons[h[1]] = { evidence: evMatches[i]?.[1]?.trim() ?? "?" };
    });

    return {
      generatedAt: md.match(/^Gerado em: (.+)$/m)?.[1]?.trim() ?? null,
      conclusion: md.match(/^CONCLUSÃO: (.+)$/m)?.[1]?.trim() ?? null,
      horizons,
    };
  } catch {
    return null;
  }
}
