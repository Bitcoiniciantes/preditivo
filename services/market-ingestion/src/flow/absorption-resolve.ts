// flow/absorption-resolve.ts
// Resolução do Absorption — lógica pura (extraída de index.ts p/ teste de regressão).
//
// CORREÇÃO CRÍTICA (26/08): no disconnect do WS, o handler zerava triggerPrice/triggerTs mas
// deixava `absorptionResolutionPending=true`; após reconnect, a resolução dividia por
// triggerPrice=0 → Infinity/NaN e duração absurda. Este módulo garante que uma resolução
// NUNCA produza Infinity/-Infinity/NaN nem use trigger=0.
//
// Guards obrigatórios:
//   price <= 0            → inválido
//   !Number.isFinite(p)   → inválido
//   !Number.isFinite(triggerPrice)
//   !Number.isFinite(deltaPercent)  (resultado)
//   timestamps inválidos  → inválido
// Os thresholds são passados como entrada (não alterados aqui).

export function isValidPrice(p: number): boolean {
  return typeof p === 'number' && Number.isFinite(p) && p > 0;
}

export type AbsorptionResolveInput = {
  currentPrice: number;
  triggerPrice: number;
  triggerTs: number;
  now: number;
  thresholdPct: number;
  windowMinutes: number;
};

export type AbsorptionResolveResult = {
  action: 'invalid' | 'resolved' | 'failed' | 'pending';
  priceChangePct: number;
  elapsedMin: number;
};

export function resolveAbsorption(input: AbsorptionResolveInput): AbsorptionResolveResult {
  const valid =
    isValidPrice(input.currentPrice) &&
    isValidPrice(input.triggerPrice) &&
    Number.isFinite(input.triggerTs) && input.triggerTs > 0 &&
    Number.isFinite(input.now) && input.now > 0;

  if (!valid) {
    // Estado inválido (ex.: trigger resetado por disconnect). Nunca calcular.
    return { action: 'invalid', priceChangePct: NaN, elapsedMin: NaN };
  }

  const priceChangePct = Math.abs((input.currentPrice - input.triggerPrice) / input.triggerPrice * 100);
  const elapsedMin = (input.now - input.triggerTs) / 60_000;

  // Guarda final: nunca devolver Infinity/NaN.
  if (!Number.isFinite(priceChangePct) || !Number.isFinite(elapsedMin)) {
    return { action: 'invalid', priceChangePct: NaN, elapsedMin: NaN };
  }

  if (priceChangePct >= input.thresholdPct) {
    return { action: 'resolved', priceChangePct, elapsedMin };
  }
  if (elapsedMin > input.windowMinutes) {
    return { action: 'failed', priceChangePct, elapsedMin };
  }
  return { action: 'pending', priceChangePct, elapsedMin };
}
