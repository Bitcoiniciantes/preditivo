# AUDITORIA P0 — RETRIGGER / CHURN DOS DETECTORES

**Data:** 26/08/2026 · **Tipo:** diagnóstico somente-leitura. Nenhuma alteração de produção.
Detectores: `engine/regime.ts`, `engine/flow-regime.ts`, `engine/absorption.ts`; gating no
`src/index.ts` (`broadcastLoop`). Fonte de verdade: código + dados SQLite.

---

## 1. O que dispara uma nova transição

| Detector | Disparo da transição (broadcast) | Confirmação interna | Dwell mínimo |
|---|---|---|---|
| **Regime** | `regimeResult.regime !== lastRegime` (index.ts:197) → `regime_change` | `confirmationThreshold = 3` ticks (regime.ts:126-128) | **nenhum** |
| **Flow** | `flowResult.flowRegime !== lastFlowRegime` (index.ts:202) → `flow_change` | `confirmationThreshold = 5` (flow-regime.ts:108) | **nenhum** |
| **Absorption** | `absorptionResult.state !== lastAbsorptionState` (index.ts:223); NONE→BEAR/BULL → `absorption_triggered` + re-arm (index.ts:226-256) | trigger 5, exit 2 (absorption.ts) | **nenhum** |

Cada tick = 1 ciclo do broadcast (~1 s). A transição só é emitida quando o estado **confirmado**
(`currentState`) muda — o candidato pode piscar sem emitir.

## 2. Pode ocorrer nova transição com estado/pending anterior?

- **Regime/Flow/Absorption:** o candidato pode inverter antes de atingir a confirmação
  (`confirmationCount` reseta — regime.ts:121-124; flow-regime.ts:103-106). Uma transição **confirmada**
  pode ocorrer imediatamente após a anterior (**sem dwell**). → **CONFIRMADO** (transições consecutivas
  rápidas são possíveis).
- **Absorption:** `absorptionResolutionPending` (um por vez); um novo trigger **interrompe** a resolução
  pendente (`absorption_interrupted`, index.ts:228-241) e re-arma. → **CONFIRMADO** (novo trigger com
  pending anterior).
- **Divergence:** `pendingResolution` (um), sobrescrito a cada `evaluate`; consumido 1× por ciclo.
  → **CONFIRMADO** (um pending, pode ser suplantado).

## 3. Episódios de 1-5s são estados válidos?

- Confirmação = 3-5 ticks (~3-5 s). Episódios **menores** que a janela de confirmação NÃO são estados
  (absorvidos pela confirmação). Episódios **≥ confirmação** (3-5 s) são **confirmados e contados** como
  estado. Não há dwell mínimo além da confirmação. → **CONFIRMADO** (episódios curtos confirmados valem
  como estado; sem dwell).

## 4. persistence / churn / duration contam esses episódios como estados de mercado?

- O observatório rastreia `since` (tempo desde a última mudança do estado **exibido/confirmado**) e
  `churn` (transições do estado exibido). `regime_events` grava transições confirmadas.
- Logo, um episódio confirmado de 1-5 s **conta exatamente como estado de mercado** nas métricas de
  persistence/churn/duration. → **CONFIRMADO**.

## 5. Retrigger de Absorption no mesmo preço — esperado ou bug?

- Cada reentrada confirmada NONE→BEAR/BULL **re-arma** o trigger no `currentPrice` (index.ts:243-245).
  Se o preço não mover ≥ 0,05% e a janela (5 min) expirar → `absorption_failed`; uma nova reentrada
  re-arma no mesmo (ou similar) preço → novo `absorption_triggered`. Um flicker NONE→BULL→NONE→BULL
  confirmado também re-arma.
- → **CONFIRMADO: comportamento esperado do desenho atual** (re-arm a cada reentrada confirmada). Não é
  um crash, mas **infla as contagens de `absorption_*`** — e essas contagens são **features** da Fase 1.

## 6. A conclusão estatística da Fase 1 usa essas métricas como features/targets?

- **Features da Fase 1** (fase1-experimento-minimo.mjs, FEATURES): `regime` (categórico), `flow`
  (contagem de flow_change na janela de 15m), `abs` (contagem de absorption_*), `div` (contagem de
  divergence*) — derivadas de `regime_events` (transições confirmadas).
- **Target**: tercil do retorno à frente (NÃO é métrica de estado).
- → **CONFIRMADO: regime/flow/abs/div são FEATURES; o target é o retorno à frente.** O churn/retrigger
  infla as contagens-feature; a conclusão "NENHUMA evidência" já foi calculada SOBRE essas contagens
  (reflete o dado como está). Caveat: parte da variância das features reflete churn do detector, não só
  estrutura de mercado — não invalida a conclusão, mas é um limite interpretativo a registrar.

---

## RESUMO DE CLASSIFICAÇÕES

| # | Questão | Classificação |
|---|---|---|
| 1 | Evento que dispara transição | confirmado-state muda (após confirmação 3-5 ticks) — **CONFIRMADO** |
| 2 | Nova transição com pending anterior | sim, possível (sem dwell; absorption interrompe resolução) — **CONFIRMADO** |
| 3 | Episódios 1-5s são estados válidos | sim, se confirmados (≥3-5 ticks); sem dwell — **CONFIRMADO** |
| 4 | persistence/churn/duration contam esses episódios | sim, exatamente como estados — **CONFIRMADO** |
| 5 | Retrigger Absorption no mesmo preço | esperado pelo desenho (re-arm); infla contagens — **CONFIRMADO** |
| 6 | Fase 1 usa as métricas como features/targets | features (regime + contagens); target = retorno à frente — **CONFIRMADO** |

**Impacto:** o comportamento é **intencional** (confirmação sem dwell + re-arm do absorption). As
contagens-feature da Fase 1 refletem esse churn; a conclusão "nenhuma evidência" já embute isso. Não é
necessário corrigir agora (hysteresis/dwell já estão na 2ª fase). Nenhuma alteração de produção.
