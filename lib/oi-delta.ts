// lib/oi-delta.ts
// ΔOI — cálculo/renderização corrigidos (CORREÇÃO P0, 26/08).
//
// Causa raiz do "ΔOI 0.000%": o daemon expõe oiChange = (atual − anterior)/anterior entre polls de
// 5s (oi.ts), e o painel exibia (oi_delta*100).toFixed(3)% — com OI ~105k unidades, uma variação de
// 5s < 0,5 unidade vira < 0,0005% e trunca para 0.000%.
//
// Correção: computar o ΔOI sobre uma janela de referência MATERIAL (1 min) a partir de um buffer
// de (ts, oi) do stream, exibindo delta absoluto (contratos) + percentual com precisão suficiente.
// O OI absoluto NÃO é alterado; nada do daemon/banco é tocado.

export type OiPoint = { ts: number; oi: number };
export type OiDelta = { oiAbs: number; oiPct: number } | null;

/**
 * ΔOI sobre `windowMs` (padrão 60s) usando o ponto mais antigo dentro da janela como base e o
 * mais recente como referência. Retorna null quando não há série suficiente.
 */
export function computeOiDelta(history: OiPoint[], windowMs = 60_000, now?: number): OiDelta {
  if (history.length === 0) return null;
  const latest = history[history.length - 1];
  const ref = now ?? latest.ts;
  const cutoff = ref - windowMs;
  let base: OiPoint | null = null;
  for (const p of history) {
    if (p.ts >= cutoff) { base = p; break; }
  }
  if (!base) base = history[0];
  if (!base || base.ts >= latest.ts || base.oi <= 0) return null;
  const oiAbs = latest.oi - base.oi;
  return { oiAbs, oiPct: (oiAbs / base.oi) * 100 };
}

/** Formata o ΔOI de forma material: "+30 (0.02857%)" — nunca 0.000% por truncamento. */
export function fmtOiDelta(delta: OiDelta): string {
  if (!delta) return "—";
  const sign = delta.oiAbs >= 0 ? "+" : "";
  const abs = `${sign}${delta.oiAbs.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  const pct = `${sign}${delta.oiPct.toFixed(5)}%`;
  return `${abs} (${pct})`;
}
