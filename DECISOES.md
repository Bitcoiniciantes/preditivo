# DECISÕES — Registo de gates e congelamentos

> Convenção: cada entrada documenta uma decisão de projeto com data, contexto e regras.
> Alterar uma decisão exige revisar a entrada correspondente (evita flexibilidade excessiva
> pós-resultado).

---

## 2026-08-25 — Fase 1: congelamento + coleta (gate: inconclusiva / aguardando potência estatística)

### Contexto

- Fase 1 (experimento mínimo) executada com commit `93005cd` (`scripts/fase1-experimento-minimo.mjs` + `FASE1_EXPERIMENTO_MINIMO.md`).
- Veredito: **nenhuma evidência fora da amostra** — nenhuma feature sobreviveu Bonferroni no treino (α=0,00152; melhores p-perm: absorption 0,005, OI 0,006, regime 0,008 — todas ⚠ apenas) e nenhuma passou a regra tripla fora da amostra (p<0,05 treino + p<0,05 teste + mesmo sinal de lift).
- Causa raiz: poder estatístico insuficiente — maior teste tem 78 observações (N<90 p/ 30/classe). Uptime efetivo ≈ 25,3h em 22 segmentos; 72 resets de CVD; whale events só existem desde a ativação do `saveEvent()` (2026-08-25T23:07Z).

### Decisões

1. **Código da Fase 1 congelado** — `scripts/fase1-experimento-minimo.mjs` e o desenho estatístico (features, labels UP/RANGE/DOWN por tercis do treino, horizontes 5/15/30 min, stride=horizonte, purging + embargo H_MAX=30 min, χ² por permutação, Bonferroni, N≥30 por classe) não serão alterados.
2. **Coleta continua inalterada** — daemon local (tsx watch) persiste snapshots, regime_events e whale events; nenhuma mudança de features, labels, horizontes ou critérios.
3. **Reexecução** — quando houver mais dados: `node scripts/fase1-experimento-minimo.mjs` (regenera `FASE1_EXPERIMENTO_MINIMO.md`). O relatório é ponto-no-tempo; o script é a fonte de verdade.
4. **Whale events permanecem em seção separada** até amostra suficiente (≥ 90 janelas de 15 min ≈ 22,5h de uptime pós-ativação p/ H=15 com stride 15 min). Nunca tratados como zero no histórico anterior.
5. **Painel: nenhuma probabilidade preditiva exibida** enquanto o gate estatístico não for atingido. Verificado: a UI atual só mostra estado/concordância heurística de regras fixas ("Concordância dos sinais", regime_confidence, score) — não há `P(classe|dados)` exibida em lugar nenhum.
6. **Não avançar para Fase 2** (labels/outcomes imutáveis) e **não introduzir ML nem Pattern Engine** até haver sinal reproduzido fora da amostra.

### Nota metodológica

O experimento detectou e corrigiu um bug real de validação durante o desenvolvimento: as fronteiras dos tercis das features precisavam ser determinadas **exclusivamente no treino** e reaplicadas ao teste (validação fora da amostra correta). A correção ocorreu **antes** do resultado final, o que aumenta a confiabilidade da conclusão atual.

### Gate atual

**Fase 1 — inconclusiva / aguardando potência estatística.**

Alterar a hipótese agora (após resultado inconclusivo) introduziria flexibilidade excessiva e impediria atribuir um eventual resultado futuro ao aumento da amostra vs. mudança metodológica. Por isso o desenho fica congelado até nova avaliação com mais dados.

### Adendo 2026-08-25 (painel observacional + reexecução)

- Construído o **painel observacional** (preço, sparkline 15m, CVD Δ, OI/ΔOI, book imbalance, regime, flow, absorção, divergência, whale events, persistência, churn, sequência temporal, gaps/qualidade) e a área **ANÁLISE PREDITIVA** com o status honesto do gate (INCONCLUSIVA → VALIDATION → PREDICTIVE SIGNAL). **Nenhuma probabilidade preditiva é exibida**; o bloco PREDICTIVE SIGNAL é inalcançável enquanto o gate não for liberado em revisão (PREDICTIVE_GATE=false). Distinção explícita: N ≥ 30 por classe é a regra; N total ≥ 90 (≈30 por classe com tercis do treino) é o equivalente exibido. Históricos rotulados pela origem: geral (snapshots, desde 22/08 20:22Z) vs whale events (desde ativação do saveEvent, 25/08 23:07Z).
- **Reexecução do experimento congelado** (25/08 ~23:36Z; 26,5h efetivas, 16,8k whale events / 87 min): veredito **mantido — NENHUMA evidência fora da amostra** (5m: treino 202/teste 82; 15m: 62/27; 30m: 28/13). `nº absorption_* 15m` passou a **sobreviver Bonferroni no treino (5m)** — sinal somente in-sample, **não promovido** (regra: exigência de replicação fora da amostra). Nada foi alterado na hipótese, features ou thresholds.
- Próximo passo: acumular dados; reexecutar o script congelado quando o N do teste crescer; não mexer no modelo até ver o resultado OOS.

### Adendo 2026-08-26 (gate por conjunto + fluxo de amostra — definições inequívocas)

**1. Gate N ≥ 30 por classe — conjunto onde se aplica (definição):**

O gate N ≥ 30 por classe aplica-se ao conjunto **onde a probabilidade é exibida**:

- Para liberar probabilidades preditivas (UP/RANGE/DOWN), o **TESTE/OOS** deve satisfazer N ≥ 30 por classe (N total ≥ 90 com tercis do treino, 3 classes ~balanceadas), porque é no OOS que se demonstra generalização.
- O treino também deve satisfazer N ≥ 30 por classe para exibir probabilidades de treino (não são exibidas hoje).
- Consequência: **N total ≥ 90 no conjunto inteiro NÃO é suficiente** — 91 observações poderiam ser 20/51/20 por classe (PASS no total, FAIL por classe). A distribuição por classe do OOS é o critério de liberação.

**2. Fluxo de amostra — definições (auditoria: `scripts/fase1-amostra-diagnostico.mjs`; o experimento congelado permanece intocado):**

- **N bruto**: total de snapshots no SQLite (base única p/ todos os horizontes).
- **stride**: âncoras descartadas por estarem a menos de h min da âncora aceita anterior (outcomes sem sobreposição).
- **candidatos**: âncoras que chegam às checagens de janela.
- **rejeições de janela**: gap > 3 min dentro de [t-15m, t] (daemon offline) ou < 10 snapshots.
- **rejeições de outcome**: segmento quebrado antes de t+h; sem snapshot em ±2,5 min; fora da tolerância.
- **N elegível** = "Observações" do relatório da Fase 1.
- **split**: treino = elegíveis com t+h ≤ fronteira B (purging); OOS = elegíveis com t ≥ B+30 min (embargo = maior horizonte); **excluídos split** = faixa do meio (t+h > B e t < B+30 min) — por construção, todo excluído cruza a fronteira E cai no embargo.

Números (26/08 ~00:41Z, 1595 snapshots):

| H | N bruto | candidatos | N elegível | treino | OOS | excluídos split |
|---|---:|---:|---:|---:|---:|---:|
| 5m | 1595 | 490 | 291 | 203 | 82 | 6 |
| 15m | 1595 | 372 | 92 | 63 | 27 | 2 |
| 30m | 1595 | 432 | 42 | 28 | 13 | 1 |

Verificações aritméticas OK (elegível = treino + OOS + excluídos; bruto = stride + candidatos; candidatos = rejeições + elegíveis). Por isso **290 ≠ 202 + 82**: a diferença (6) são os elegíveis excluídos pelo split.

**3. Reexecução (26/08 ~00:41Z):** veredito **mantido — NENHUMA evidência fora da amostra** (5m 203/82 · 15m 63/27 · 30m 28/13). `nº absorption_* 15m`, que havia sobrevivido Bonferroni no treino na rodada anterior, **não sobreviveu nesta rodada** — instabilidade do sinal in-sample, confirmando a decisão de não promovê-lo sem replicação OOS.

**4. Estados do painel (vocabulário corrigido):** `VALIDAÇÃO EXECUTADA · OOS: NENHUMA EVIDÊNCIA · PREDIÇÃO: BLOQUEADA` (OOS ≥ 90, sem replicação) vs `VALIDAÇÃO NÃO EXECUTÁVEL · AMOSTRA INSUFICIENTE (OOS < 90)` (caso atual) — nunca mais "INCONCLUSIVA/amostra insuficiente" como rótulo único.
