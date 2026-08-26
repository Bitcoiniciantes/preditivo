// lib/fase1-verdict.ts — SOMENTE server-side (usado pelo layout no build/dev).
// Lê o relatório congelado da Fase 1 (FASE1_EXPERIMENTO_MINIMO.md) e extrai o veredito
// por horizonte + os N do fluxo de amostra (Observações/Treino/OOS da tabela §1).
// O relatório é regenerado por scripts/fase1-experimento-minimo.mjs (congelado);
// o painel apenas reflete o que o experimento já demonstrou — nunca inventa.
import fs from "node:fs";
import path from "node:path";

export type Fase1HorizonVerdict = {
  obs: number | null; // N elegível (janela íntegra + outcome)
  train: number | null;
  test: number | null; // OOS (pós purging + embargo)
  oosClasses: { up: number | null; range: number | null; down: number | null }; // distribuição do OOS (§2)
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
      horizons[h[1]] = {
        obs: null,
        train: null,
        test: null,
        oosClasses: { up: null, range: null, down: null },
        evidence: evMatches[i]?.[1]?.trim() ?? "?",
      };
    });

    // Tabela §1: "| 5 min | 290 | 202 | 82 | < ... > |" → obs / treino / OOS
    const nRe = /^\| (\d+) min \| (\d+) \| (\d+) \| (\d+) \|/gm;
    for (const m of md.matchAll(nRe)) {
      const h = horizons[m[1]];
      if (!h) continue;
      h.obs = Number(m[2]);
      h.train = Number(m[3]);
      h.test = Number(m[4]);
    }

    // Tabela §2 (linha do Teste): "| Teste | 83 | 29 (34.9%) | 27 (32.5%) | 27 (32.5%) |"
    // → distribuição UP/RANGE/DOWN do OOS (gate por classe).
    const oosRe = /^\| Teste \| (\d+) \| (\d+) .*\| (\d+) .*\| (\d+) .*\|$/gm;
    const testRows = [...md.matchAll(oosRe)];
    const hBlocks2 = [...md.matchAll(horizonRe)];
    hBlocks2.forEach((h, i) => {
      const row = testRows[i];
      const hh = horizons[h[1]];
      if (!hh || !row) return;
      hh.oosClasses = { up: Number(row[2]), range: Number(row[3]), down: Number(row[4]) };
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
