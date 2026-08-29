# AUDITORIA — ABSORPTION RETRIGGERING (pós-fix)

**Data:** 26/08/2026 · **Tipo:** somente leitura (SQLite `regime_events` + `snapshots`). Nenhuma
alteração de código/thresholds/detector/hysteresis/dwell/experimento. 7.407 triggers em 130,9h.

---

## 1. TOTAIS

| Métrica | Valor |
|---|---|
| Triggers | 7.407 (56,6/h) |
| Resolved | 1.904 |
| Failed | 66 |
| **Interrupted** | **5.419** |
| **Taxa de interruption** | **73,2% dos triggers** (41,4/h) |

## 2. Intervalo entre triggers

- **p50 = 34s**, p25 = 20s, p90 = 91s, max = 59.412s (~16h).
- **77% dos gaps < 60s** · **99,5% < 5min** · apenas 36 gaps ≥ 5min.
→ os triggers se repetem de forma extremamente rápida (re-arm constante).

## 3. Sequência de direções (pares consecutivos de triggers)

| Par | N |
|---|---|
| **BULL→BULL** | 2.166 |
| **BEAR→BEAR** | 5.067 |
| BULL→BEAR | 86 |
| BEAR→BULL | 87 |

- **99,5% dos pares são MESMA DIREÇÃO** (7.233/7.267); flips são raros (173). O detector **re-arma na
  mesma direção** (BULL→NONE→BULL), não inverte. BULL 2.253 · BEAR 5.154.

## 4. Distribuição do Δ% nos interruptions

- **p50 = 0,0133%**, p25 = 0,0052%, p90 = 0,0359%, max = 0,0936%.
- **5.351/5.399 (99,1%) com Δ < 0,05%** (threshold de resolução) → os triggers são interrompidos
  porque o preço **quase não moveu**; a resolução só ocorre nos raros casos em que o preço saiu.

## 5. Sequências (clusters da mesma direção, gap < 5min)

- **201 sequências** · triggers/seq p50 = 5, p90 = 62, max = 932.
- **99,5% dos triggers (7.369/7.407) estão em sequências de 2+** (retrigger dentro da mesma sequência).
- Duração da sequência: p50 = 2,9 min, p90 = 45,9 min, max = 746,5 min.
→ o retriggering é **altamente agrupado**: a MESMA direção se re-arma repetidamente em janelas curtas.

## 6. Outcome futuro dos triggers (5m/15m/30m)

| H | n | BULL ret médio | BEAR ret médio | Direção correta |
|---|---|---|---|---|
| 5m | 7.354 | -0,003% | -0,002% | **49,0%** |
| 15m | 7.212 | +0,002% | -0,009% | **49,5%** |
| 30m | 7.113 | +0,002% | -0,009% | **49,1%** |

→ a direção do trigger **não tem poder preditivo** (≈50% = chance; retornos BULL/BEAR ≈ 0 e similares).

## 7. Persistência do sinal vs movimento futuro (|ret| 15m após o 1º trigger da sequência)

| Grupo | n | \|ret\| 15m |
|---|---|---|
| Sequência de 1 (isolado) | 35 | 0,228% |
| Sequência de 2+ (retrigger) | 152 | 0,191% |
| Duração curta (tercil inferior) | — | 0,229% |
| Duração longa (tercil superior) | — | 0,170% |

→ maior retrigger/persistência **NÃO** precede movimento maior — na verdade é levemente inverso.

---

## CONCLUSÃO — ruído do detector ou característica informativa?

**Predominantemente RUÍDO DO DETECTOR.** Evidências convergentes:

1. **Retriggering quase todo na mesma direção** (99,5%), com **mediana de 34s** e o trigger sendo
   interrompido porque o preço **não moveu ≥ 0,05%** (99,1% das interruptions). Isso é o **re-arm
   mecânico** do ciclo confirmação(5)/exit(2) sobre condições persistentes (imb < -0,15 e whaleCvd >
   +100k), não um novo fenômeno de mercado a cada trigger.
2. **Direção não prediz** o futuro (5m/15m/30m ≈ 50%, chance).
3. **Persistência não está correlacionada com movimento futuro** (mais retrigger → movimento até menor).

**Impacto:** o retriggering infla as contagens de `absorption_*` (que são **features da Fase 1**). Como
essas contagens não carregam direção informativa e o Fase 1 já reportou **NENHUMA evidência OOS**, o
retriggering é consistente com ruído do detector (não invalida o experimento — ele já reflete o dado).
Não corrigido nesta etapa (aguardando autorização; hysteresis/dwell permanecem na 2ª fase).

> Observação metodológica: o audit foi feito no histórico completo (130,9h, pré-fix). Os eventos
> "pós-fix" são em número insuficiente para análise isolada; o fix de disconnect não altera o ciclo
> normal de trigger/resolução, então o padrão de retriggering medido permanece válido.
