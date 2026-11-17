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

**1. Gate de liberação — definição formal (aprovada em 2026-08-26):**

A probabilidade preditiva somente poderá ser liberada quando o **OOS** satisfizer **simultaneamente**:

- OOS total ≥ 90;
- UP OOS ≥ 30;
- RANGE OOS ≥ 30;
- DOWN OOS ≥ 30;
- o teste OOS passar os critérios estatísticos definidos no experimento congelado;
- revisão/aprovação registrada neste documento.

**N total do histórico não libera previsão.** A distribuição por classe do OOS é o critério (91 observações poderiam ser 20/51/20 por classe: PASS no total, FAIL por classe). O treino também deve satisfazer N ≥ 30 por classe para exibir probabilidades de treino (não são exibidas hoje). Enquanto qualquer condição falhar: `PREDICTIVE SIGNAL = LOCKED · PROBABILIDADES = BLOQUEADAS`.

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

**4. Estados do painel (vocabulário corrigido):** `VALIDAÇÃO EXECUTADA · OOS: NENHUMA EVIDÊNCIA · PREDIÇÃO: BLOQUEADA` (OOS total ≥ 90 e classes ≥ 30, sem replicação) vs `VALIDAÇÃO NÃO EXECUTÁVEL · AMOSTRA INSUFICIENTE (OOS < 90 ou classe < 30)` (caso atual) — nunca mais "INCONCLUSIVA/amostra insuficiente" como rótulo único.

### Adendo 2026-08-26 — Rodada R3 (~00:48Z) e histórico de estabilidade

**Execução (scripts congelados, apenas execução — nenhum parâmetro alterado):**

| H | N bruto | N elegível | treino | OOS | excluídos split | OOS UP/RANGE/DOWN | gate por classe |
|---|---:|---:|---:|---:|---:|---:|---|
| 5m | 1600 | 292 | 203 | 83 | 6 | 29 / 27 / 27 | NÃO (total 83 < 90) |
| 15m | 1600 | 92 | 63 | 27 | 2 | 9 / 15 / 3 | NÃO (total 27 < 90) |
| 30m | 1600 | 42 | 28 | 13 | 1 | 5 / 6 / 2 | NÃO (total 13 < 90) |

Veredito: **NENHUMA evidência fora da amostra** (5m/15m/30m). Sobreviventes Bonferroni no treino: `nº absorption_* 15m` (5m) — **somente treino, sem replicação OOS → NÃO PROMOVER**.

**Tabela de estabilidade (rodadas comparáveis):**

| Feature/sinal | R1 (25/08 23:36Z) | R2 (26/08 00:41Z) | R3 (26/08 00:48Z) | R4 (26/08 11:53Z) | Estável? |
|---|---|---|---|---|---|
| `absorption_*` (5m) — Bonferroni no treino | sim | não | sim | não | **INSTÁVEL** (sim/não/sim/não) → não promovido |
| OOS: evidência fora da amostra (todos os H) | nenhuma | nenhuma | nenhuma | nenhuma | **ESTÁVEL** (negativo consistente) |
| OOS N (5m / 15m / 30m) | 82 / 27 / 13 | 82 / 27 / 13 | 83 / 27 / 13 | **121 / 40 / 19** | crescendo (5m passou de 90) |
| OOS 5m UP/RANGE/DOWN | — | — | 29/27/27 | **33/53/35** | 5m: gate por classe **ATENDIDO** |
| Gate por classe (OOS) | NÃO | NÃO | NÃO | **5m SIM · 15m/30m NÃO** | 5m transicionou |

**R4 (26/08 11:53Z, 36,0h efetivas):** 5m 419=292+121+6 · 15m 136=94+40+2 · 30m 64=44+19+1; OOS 5m = 121
(UP 33 / RANGE 53 / DOWN 35) → **gate de classe ATINGIDO para 5m**; relatório: NENHUMA evidência OOS →
painel exibirá `VALIDAÇÃO EXECUTADA · OOS: NENHUMA EVIDÊNCIA · PREDIÇÃO: BLOQUEADA` (probabilidades
permanecem bloqueadas). Nenhum parâmetro do experimento alterado.

Interpretação (regra): significância isolada no treino **não é evidência** — `TRAIN SIGNIFICANT + OOS NON-SIGNIFICANT = NÃO PROMOVER`. O comportamento oscilante de `absorption_*` entre rodadas é registrado como **evidência de instabilidade** do sinal in-sample, reforçando o gate de replicação OOS.

**Estado:** MODELO LOCKED · FEATURES LOCKED · THRESHOLDS LOCKED · EXPERIMENTO LOCKED · COLETA ATIVA · OOS ACUMULANDO · PREDICTIVE SIGNAL LOCKED. Próxima execução: `node scripts/fase1-amostra-diagnostico.mjs` + `node scripts/fase1-experimento-minimo.mjs`, sem alterar nenhum parâmetro.

### Adendo 2026-09-05 — Rodada R5: re-gate oficial (protocolo executado, nada alterado)

> **CLASSIFICAÇÃO OFICIAL DO R5 (correção metodológica, 2026-09-05): EXPLORATÓRIO/PRELIMINAR,
> NÃO-CONFIRMATÓRIO; relatório NÃO-REPRODUTÍVEL de forma confiável (bug de RNG: §3 e §7 divergem
> na classificação Bonferroni da mesma feature). Nenhum gate é decidido pelo R5 sob a regra antiga
> (a+b+c). Ver "Correção metodológica R5" e "Protocolo prospectivo R6" abaixo.

**Execução:** `node scripts/fase1-experimento-minimo.mjs` em 2026-09-05T22:13:40Z (regenerou
`FASE1_EXPERIMENTO_MINIMO.md`, saída própria do protocolo). Verificado pós-execução:
`git diff` vazio em `scripts/` (script congelado intacto); nenhuma alteração em features,
thresholds, CVD, Regime, Flow, Absorption, classes, targets, horizontes, split, purging,
embargo, schema ou dados históricos; painel intocado; `PREDICTIVE_GATE=false` mantido
(`app/PredictiveStatusCard.tsx:28`).

**Dados:** 14.927 snapshots, 248,8h efetivas, 38 segmentos, 275 resets de CVD;
regime_events 88.159; whale events 304.700 (seção separada, excluídos do experimento principal).

**Gate de amostragem (definição formal 26/08 — OOS ≥ 90 E cada classe ≥ 30):**

| H | Treino | OOS | OOS UP/RANGE/DOWN | gate |
|---|---:|---:|---|---|
| 5m | 2064 | 880 | 276 / 340 / 264 | **PASS** |
| 15m | 697 | 299 | 96 / 107 / 96 | **PASS** |
| 30m | 345 | 148 | 51 / 57 / 40 | **PASS** |

→ **Gate de amostragem CUMPRIDO nos 3 horizontes** (primeira vez para 15m e 30m).

**Critério estatístico OOS (regra tripla do §7: p-perm<0,05 treino + p-perm<0,05 teste + mesmo sinal de lift):**

| H | evidência fora da amostra (a+b+c) | Bonferroni treino (§7) |
|---|---|---|
| 5m | **retorno 15m, ΔCVD 15m, ΔCVD large 15m** | ΔCVD 15m, ΔCVD large 15m, score médio 15m, regime (agrupado), nº divergence\* 15m |
| 15m | **retorno 15m, ΔCVD 15m, ΔCVD large 15m** | nenhuma |
| 30m | nenhuma | nenhuma |

Veredito do script: *"há evidência preliminar fora da amostra em um ou mais horizontes"*.
**Primeira rodada com evidência OOS** (R1–R4: nenhuma) — coincide com o salto de N.

**Ressalvas registradas (sem alterar o experimento):**

1. **Efeitos minúsculos** — Cramér V 0,07–0,14; lifts de centésimos de ponto percentual
   (ex.: 5m retorno 0,013% → −0,013%). Significância estatística ≠ relevância econômica.
   **Nenhuma probabilidade gerada.**
2. **Discrepância §3 vs §7 na lista Bonferroni do 5m** (tabela §3: `retorno 15m` ★ e `ΔCVD 15m` ⚠;
   lista do veredito §7: `ΔCVD 15m` presente, `retorno 15m` ausente). Mecanismo: o script chama
   `analyze()` duas vezes com RNG compartilhado (`mulberry32(SEED)` em stream contínuo) — os
   p-perm do veredito vêm de sorteios distintos dos das tabelas. **Vale o §7** (veredito oficial
   do script). Congelado como está; corrigir seria alterar o experimento.
3. **Estabilidade pendente** — precedente `absorption_*` (sim/não/sim/não) exige confirmação do
   sinal em rodadas futuras antes de qualquer promoção. 30m segue sem evidência.

**Decisão:** gate de amostragem PASS nos 3 horizontes; evidência OOS preliminar em 5m e 15m,
ausente em 30m. **PREDICTIVE_GATE permanece `false`** — falta a etapa de revisão/aprovação;
sem probabilidades, sem alteração do painel. Próximo passo: acumular dados e reexecutar (R6)
para checar estabilidade do sinal; revisão humana decide sobre Fase 2.

**Estado:** MODELO LOCKED · FEATURES LOCKED · THRESHOLDS LOCKED · EXPERIMENTO LOCKED · COLETA ATIVA · OOS ACUMULANDO · PREDICTIVE SIGNAL LOCKED (aguardando revisão/aprovação).

### Correção metodológica R5 (2026-09-05 — só reclassificação; nenhum script rodado, nenhum código alterado)

**1. Por que o R5 não pode ser confirmatório.**
- O pool OOS do R5 contém em grande parte os mesmos dados já examinados em R1–R4 (a fronteira B
  desloca-se, mas o grueso do OOS já foi visto). Reexaminar o mesmo pool a cada rodada é teste
  múltiplo ao longo do tempo: a taxa de falso positivo acumula. R5 = gerador de hipóteses, não validador.
- O relatório do R5 contradiz a si mesmo na condição (d): a lista Bonferroni do §7 no 5m (ΔCVD,
  ΔCVD large, score, regime, divergence — **sem** `retorno 15m`) difere dos flags da tabela §3
  (`retorno 15m` ★, `ΔCVD 15m` ⚠ com p=0,0020). Mecanismo já identificado: `analyze()` é chamada
  duas vezes com o mesmo RNG em stream contínuo (`mulberry32(SEED)` compartilhado) — veredito e
  tabelas vêm de sorteios de permutação distintos. Um relatório cujas metades discordam sobre a
  mesma classificação **não é reprodutível de forma confiável** (os p-perm exatos variam por
  construção a cada passada).

**2. Critério oficial de PASS.**

```
CRITÉRIO OFICIAL DE PASS (definido em 2026-09-05):
Uma feature só conta como evidência OOS se: (a) p treino < 0,05 E (b) p teste < 0,05
E (c) mesmo sinal de lift E (d) sobrevive correção de Bonferroni (α=0,00152) no treino.
Regras anteriores (a+b+c sem Bonferroni) são consideradas incorretas e não devem
ser usadas para decisões de gate daqui em diante.
```

**3. Reavaliação retroativa do R5 sob a+b+c+d (reclassificação dos números já publicados).**

| H | Feature (a+b+c no R5: p-treino/p-teste/sinal) | (d) pela tabela §3 | (d) pela lista §7 | Situação sob a+b+c+d |
|---|---|---|---|---|
| 5m | retorno 15m (0,0010/0,0010/sim) | SIM (★) | NÃO (ausente) | **INDETERMINADO** (relatório contraditório) |
| 5m | ΔCVD 15m (0,0020/0,0010/sim) | NÃO (0,0020 > α) | SIM (presente) | **INDETERMINADO** (relatório contraditório) |
| 5m | ΔCVD large 15m (0,0010/0,0010/sim) | SIM (★) | SIM (presente) | sustenta (d) nas duas leituras |
| 15m | retorno 15m (0,036/0,005/sim) | NÃO | NÃO | **FAIL (d)** |
| 15m | ΔCVD 15m (0,046/0,006/sim) | NÃO | NÃO | **FAIL (d)** |
| 15m | ΔCVD large 15m (0,012/0,001/sim) | NÃO | NÃO | **FAIL (d)** |
| 30m | (nenhuma em a+b+c) | — | — | nada a reclassificar |

Leitura honesta: sob o critério correto restam **zero confirmações limpas** — 3 falham (d) de forma
consistente (15m), 2 são indeterminadas por contradição interna do relatório (5m), e apenas
`ΔCVD large 15m` em 5m sustenta (d) nas duas leituras — o que, vindo de relatório
não-reprodutível, conta como **candidata exploratória, não evidência**.

**Decisão corretiva:** o veredito "há evidência preliminar fora da amostra" do R5 fica **rebaixado
a hipótese exploratória**. Nenhuma promoção, nenhuma probabilidade, nenhum avanço à Fase 2 com base em R5.

### Protocolo prospectivo R6 (pré-registrado em 2026-09-05 — ainda NÃO executado)

Validação confirmatória limpa, desenhada antes de ver qualquer dado novo.

1. **Corte temporal:** somente observações com janela integralmente posterior ao R5 — âncora `t`
   com `t − 15min > 2026-09-05T22:13:40Z` (timestamp do relatório R5). Nada do OOS visto em R1–R5 entra.
2. **Conjunto confirmatório (fixo, sem seleção futura):** `retorno 15m`, `ΔCVD 15m`, `ΔCVD large 15m`
   × horizontes 5/15/30 = 9 testes; α Bonferroni da família = 0,05/9 ≈ 0,0056. PASS por teste exige
   p < 0,0056 **e** mesmo sinal de lift do OOS do R5. As demais 8 features saem só como exploratórias
   (sem consequência de gate). Classes: fronteiras de tercis do **treino R5**, reaplicadas — sem
   reestimar nos dados novos.
3. **N mínimo alvo (pré-comprometido):** 120 observações elegíveis novas por horizonte (≈40/classe
   esperadas, margem sobre o mínimo 30/classe; total ≥ 90). Gatilho: o horizonte mais lento (30m,
   ritmo atual ~39/dia) atingir 120 → **execução única sincronizada** dos 3 horizontes sobre o pool
   novo congelado. ETA ≈ 3–4 dias (~2026-09-09/10, sujeito a gaps).
4. **Execução única:** o protocolo R6 roda **uma única vez** quando o gatilho for atingido. Monitorar
   o acúmulo de N é permitido **somente por contagens read-only** (queries diretas, banco em modo
   read-only; nenhum script analítico executado, nenhum teste calculado) — monitorar N não é testar.
   Proibido rodar o protocolo em dados parciais "para ver como está" ou repetir após o resultado.
5. **Correção do RNG (somente na versão nova):** `scripts/fase1-experimento-minimo.mjs` **não será
   tocado**. Para o R6 será criado, na ocasião da execução, um script versionado separado (mesmos
   parâmetros/constantes do congelado) com seed determinística própria por teste (derivada de
   feature+horizonte+conjunto) e **passada única** de análise cujos números alimentam tanto as
   tabelas quanto o veredito (elimina a divergência §3 vs §7 por construção). Divergência residual
   entre execuções = FAIL de reprodutibilidade, registrado como tal.
6. **Gate R6:** PASS = amostragem (OOS novo ≥ 90 e cada classe ≥ 30, por horizonte) **e** ao menos
   uma hipótese do conjunto confirmatório aprovada pela regra do item 2. Mesmo com PASS,
   `PREDICTIVE_GATE` só muda em revisão/aprovação registrada aqui.

**Estado:** MODELO LOCKED · FEATURES LOCKED · THRESHOLDS LOCKED · EXPERIMENTO LOCKED (RNG fix só na
versão R6 futura) · COLETA ATIVA · R5 REBAIXADO A EXPLORATÓRIO · R6 PRÉ-REGISTRADO, AGUARDANDO N
(acúmulo pós-corte iniciado em 2026-09-05T22:13:40Z; contagem via monitoração read-only) ·
PREDICTIVE SIGNAL LOCKED.

### Adendo 2026-09-07 — Auditoria confirmatória pós-R5 e formalização do critério R6 (sem executar R6)

> R6 continua NÃO executado. Este adendo só audita, decide e implementa o harness
> (`scripts/fase1-r6-confirmatorio.mjs`, ainda não rodado em modo completo).
> `scripts/fase1-experimento-minimo.mjs`, `FASE1_EXPERIMENTO_MINIMO.md`, features,
> thresholds, classes, targets, horizontes, split histórico, schema e dados históricos:
> intocados. `PREDICTIVE_GATE=false` mantido.

**1. Auditoria do RNG compartilhado (mecanismo confirmado no código congelado).**
- Causa: `const rng = mulberry32(SEED)` em nível de módulo
  (`scripts/fase1-experimento-minimo.mjs:51`) com `shuffle()` consumindo o stream
  contínuo; `analyze()` é chamada uma vez por horizonte no loop das §§1–5 (:340–350)
  e **de novo** no loop do veredito §7 (:441–442), via `permutationP()` (:86–95).
  Veredito e tabelas vêm portanto de sorteios de permutação distintos — por construção.
- Evidência no R5: lista Bonferroni §7 do 5m (ΔCVD, ΔCVD large, score, regime,
  divergence — **sem** `retorno 15m`) vs flags da tabela §3 (`retorno 15m` ★,
  `ΔCVD 15m` ⚠ p=0,0020). Troca `retorno 15m` ↔ `ΔCVD 15m` entre as duas passadas.
- Agravante de granularidade: com 999 permutações o piso do p-perm é 0,0010; o α
  de 33 testes (0,00152) fica imediatamente acima do piso — empates no piso
  (vários 0,0010) viram ★/⚠ ao sabor do sorteio. Classificação Bonferroni sob 33
  testes com este RNG **não é reprodutível de forma confiável**.
- Decisão: o fix (seed determinística própria por teste + passada única cujos
  números alimentam tabelas e veredito) vive **somente** no script versionado R6.
  Divergência residual entre execuções do R6 = FAIL de reprodutibilidade registrado.

**2. Bonferroni: exigida ou não? Decisão: EXIGIDA (d), família = 9 testes, α ≈ 0,0056.**
- Sem correção, 33 testes a α=0,05 esperam ~1,65 falsos positivos sob o nulo —
  compatível com o precedente `absorption_*` (sim/não/sim/não em R1–R4) e com a
  aparição simultânea de 6 "evidências" (a+b+c) justo no salto de N do R5.
- Reexaminar o pool OOS deslocado a cada rodada (R1–R5) é teste múltiplo temporal:
  a taxa de falso positivo acumula mesmo com o desenho congelado. R5 = gerador de
  hipóteses, nunca validador (já decidido em 2026-09-05, aqui confirmado).
- A família correta é a do **conjunto confirmatório pré-registrado** (3 features ×
  3 horizontes = 9 testes; α=0,05/9≈0,0056) — não 33: as 8 demais features saem
  como exploratórias e não integram nenhuma alegação de gate. Penalizar a
  confirmação por testes exploratórios fora da alegação seria conservadorismo
  sem base; ignorar a multiplicidade dentro da alegação seria inflacionar o erro.
- Regra por teste R6 (desambiguação do pré-registro): p = p-perm χ² calculado
  **no pool novo** (amostra integralmente pós-corte), PASS ⇔ `p < 0,0056`
  **E** sinal do lift novo = sinal de referência do OOS do R5 (tabela abaixo).
  p do treino R5 não entra (treino R5 foi geração de hipótese, não confirmação).

**3. Sinais de referência do OOS do R5 (lifts §3 "Lift teste", valores literais).**

| H | retorno 15m | ΔCVD 15m | ΔCVD large 15m |
|---|---|---|---|
| 5m | −1 (0,013% → −0,013%) | −1 (0,005% → −0,010%) | −1 (0,001% → −0,011%) |
| 15m | −1 (0,011% → −0,015%) | −1 (0,001% → −0,018%) | −1 (−0,003% → −0,021%) |
| 30m | +1 (−0,020% → −0,015%, n.s. no R5) | −1 (−0,026% → −0,047%, n.s.) | −1 (−0,016% → −0,030%, n.s.) |

Nota honesta: as referências de 30m vêm de lifts não-significativos (ruído); o teste
de 30m vale pela amarração pré-registrada, e a restrição ativa é o p<0,0056 no novo.

**4. Fronteiras R5 reaplicadas sem reestimar (método de reprodução, não estimação).**
- Classes: tercis do fwdRet do **treino R5**; bins de feature: tercis do **treino R5**
  (fronteiras do treino reaplicadas ao novo, mesma função `binFeature`).
- Valores exatos não constam do `.md` (só arredondados); o script R6 os **reproduz
  deterministicamente**: snapshots com t ≤ corte → observações com a lógica
  congelada idêntica → treino R5 via fronteiras B publicadas no §1 do R5
  (5m 2026-09-01T22:39:41.055Z; 15m 2026-09-02T00:52:41.905Z;
  30m 2026-09-02T03:57:57.927Z) → `tercileBins` (sem RNG — bit-idêntico, pois o
  SQLite é append-only e o pré-corte é imutável). Reprodução auditável, não
  reestimação: nenhum número novo do pool pós-corte entra nas fronteiras.
- Corte: âncora elegível ⇔ `t − 15min > 2026-09-05T22:13:40.401Z` ("Gerado em" do R5).

**5. Gatilho e execução única (inalterados, com guardrails no script).**
- Gatilho (formalização 2026-09-07 — o N>=120 sozinho NÃO basta): a execução única
  só ocorre quando, **simultaneamente e PARA CADA HORIZONTE**, (i) N total novo
  ≥ 120 **E** (ii) UP ≥ 30 **E** (iii) RANGE ≥ 30 **E** (iv) DOWN ≥ 30, sempre no
  pool prospectivo. A conferência é manual na saída do `--check-n` (que já imprime
  N + classes por horizonte; o script permanece congelado). Enquanto qualquer
  horizonte falhar qualquer subitem — ex.: 30m em 85/120 com 27/43/15 — **não
  executar**. Após a execução única, não repetir o teste sobre o mesmo holdout;
  `PREDICTIVE_GATE=false` mantido independentemente do resultado automático —
  qualquer promoção depende de revisão humana posterior registrada aqui.
- Gate R6: amostragem (novo ≥ 90 e cada classe ≥ 30, por horizonte) **E** ≥1 PASS
  confirmatório. Mesmo com PASS, `PREDICTIVE_GATE` só muda em revisão registrada
  aqui. Saída em arquivo novo (`FASE1_R6_CONFIRMATORIO.md`); painel e veredito
  congelado intocados (o painel lê só `FASE1_EXPERIMENTO_MINIMO.md`).

**Estado:** EXPERIMENTO R5 LOCKED (intocado) · CRITÉRIO CONFIRMATÓRIO FORMALIZADO
(a+b+c+d, família 9, α≈0,0056, sinais de referência acima) · HARNESS R6 IMPLEMENTADO,
EXECUTADO UMA ÚNICA VEZ em 2026-09-09T02:20:26.856Z (relatório `FASE1_R6_CONFIRMATORIO.md`;
ver decisão pós-R6 abaixo) · PREDICTIVE_GATE=false · PREDICTIVE SIGNAL LOCKED.

### Adendo 2026-09-09 — Decisão pós-R6: APROVAÇÃO DA FASE 2 (execução única registrada, sem reexecutar)

> `fase1-r6-confirmatorio.mjs` executado **uma única vez** em 2026-09-09T02:20:26.856Z
> (exit code 0, sem flags, sem `--check-n`). Repetir é proibido. `FASE1_R6_CONFIRMATORIO.md`
> é artefato histórico da execução única — intocado. Nenhum parâmetro (seed, α, cortes,
> fronteiras, classes, família), nenhum script, nenhum dado e nenhum resultado foram alterados.

**1. N e classes efetivos (pool prospectivo congelado no instante da execução).**
- 5m: N=827 (UP 229 / RANGE 360 / DOWN 238) — amostragem PASS.
- 15m: N=292 (UP 86 / RANGE 129 / DOWN 77) — amostragem PASS.
- 30m: N=149 (UP 49 / RANGE 68 / DOWN 32) — amostragem PASS.

**2. Resultado confirmatório: 1/9 PASS, 8/9 não PASS (NÃO é 9/9).**
- PASS único: `retorno 15m` @ 5m — χ²=28,3, p-perm=0,0010 (< α=0,00556), Cramér V=0,131,
  lift 0,006% → −0,001%, sinal −1 compatível com a referência R5.
- Não PASS (registrados explicitamente): 5m ΔCVD (p=0,0150, sinal +1≠−1),
  5m ΔCVD large (p=0,0400, sinal +1≠−1); 15m retorno (p=0,7530), 15m ΔCVD (p=0,6430),
  15m ΔCVD large (p=0,6880); 30m retorno (p=0,9810, sinal −1≠+1), 30m ΔCVD (p=0,4590),
  30m ΔCVD large (p=0,1880).

**3. Veredito global R6: PASS** — amostragem PASS nos 3 horizontes E ≥1 PASS confirmatório,
conforme o gate formalizado em 2026-09-07. 15m e 30m: nenhum PASS confirmatório.

**4. Decisão explícita: APROVAR O AVANÇO À FASE 2.**
Justificativa: gate formal do R6 satisfeito; três horizontes com N mínimo e mínimo por
classe; 1 hipótese confirmatória PASS pelo critério a+b+c+d (família 9, α≈0,0056, sinal
de referência). A Fase 2 é etapa posterior de **validação/monitoramento**, não prova de
que todas as relações investigadas foram confirmadas — apenas 1 de 9 o foi.

**5. Escopo documental da Fase 2 (registrado; NÃO implementado nesta tarefa).**
- Monitorar prospectivamente a hipótese confirmada (`retorno 15m` @ 5m); as 8 demais
  permanecem exploratórias/não confirmadas.
- Sem ML, sem Pattern Engine e sem exibição de probabilidades até decisão explícita
  própria (ver item 6). Experimento, painel e veredito congelados intocados.

**6. PREDICTIVE_GATE: permanece `false` (NÃO liberado nesta tarefa).**
A aprovação da Fase 2 não libera automaticamente o gate: a liberação de probabilidades
exige decisão explícita adicional e posterior (gate de liberação 2026-08-26 + revisão
registrada aqui), a ser tomada no escopo da Fase 2. O bloco PREDICTIVE SIGNAL segue
inalcançável; nenhuma probabilidade preditiva é exibida.

**Estado:** R6 EXECUTADO 1× (2026-09-09T02:20:26Z, gate PASS 1/9) · FASE 2 APROVADA (escopo
documental acima; implementação pendente) · PREDICTIVE_GATE=false · PREDICTIVE SIGNAL
LOCKED · REPETIÇÃO DO R6 PROIBIDA.

### Pré-registro F2-v1 (2026-09-09 — decisão formal; implementação pendente)

> Réplica prospectiva controlada da única hipótese confirmada no R6. Nada implementado
> nesta entrada: sem scripts, sem tabela, sem coleta, sem teste. R5/R6 intocados;
> `FASE1_R6_CONFIRMATORIO.md` intocado; R6 jamais reexecutado; painel intocado;
> nenhuma probabilidade exibida; `PREDICTIVE_GATE=false` mantido; sem commit.

**1. Hipótese (definição R6 congelada, sem reestimar).**
- `ret15` @ horizonte 5m: ret15 = p(t)/p(t−15m)−1 sobre janela 15m íntegra (≥10 snaps,
  sem gap >3min); stride 5m; outcome ±150s.
- Bins: tercis do ret15 do TREINO R5 reproduzidos deterministicamente por
  `reproduceR5Train(5)` — fronteiras jamais reestimadas.
- Classes 5m do treino R5: DOWN < −0,028% ≤ RANGE ≤ 0,025% < UP.

**2. Corte temporal (pool disjunto do R6).**
- Pool F2 ⇔ âncoras com `t−15m > 2026-09-09T02:20:26.856Z` (timestamp da execução única
  do R6). Interseção de âncoras R6∩F2 deve ser 0 (verificação obrigatória na implementação).

**3. α = 0,0056 (decisão humana explícita).**
- Escolha deliberada: mesma força de evidência do R6, para que F2 seja replicação
  diretamente comparável ao resultado original (p=0,0010).
- Sem nova Bonferroni além disso: F2 possui uma única hipótese pré-especificada.

**4. N mínimo = 120 + classes (decisão humana explícita).**
- Gate amostral F2 ⇔ N ≥ 120 E UP ≥ 30 E RANGE ≥ 30 E DOWN ≥ 30, simultaneamente.
  Não avaliar pool incompleto.

**5. Seed/família (decisão humana explícita).**
- `F2|ret15|5|20260909` — 999 permutações χ², passada única. Nunca reutilizar qualquer
  seed/família `R6|...`.

**6. Persistência (decisão humana explícita).**
- Tabela SQLite nova `fase2_observations`: `anchor_t` PRIMARY KEY,
  `CREATE TABLE IF NOT EXISTS`, inserção idempotente (`INSERT OR IGNORE`), append-only.
- Nenhuma alteração em `snapshots`, `events` ou `regime_events`; leitura histórica
  sempre readOnly; acesso estritamente separado.
- Esclarecimento (auditoria 2026-09-09, sem alterar código): `fase2_observations`
  reside em arquivo separado `services/market-ingestion/data/fase2.db` (dir já
  gitignored), não dentro de `market.db` — construção que satisfaz simultaneamente
  a tabela nova e `market.db` estritamente readOnly. Compatível com este pré-registro.

**7. Time-box = 14 dias (decisão humana explícita).**
- Sem N mínimo + classes em 14 dias → encerrar como `UNDERPOWERED`, sem avaliação
  estatística. Sem prorrogação oportunista em função dos dados observados.

**8. Avaliação única.**
- Durante a coleta: somente N, UP, RANGE, DOWN e `samplingOk`. Nenhum p-value, χ²,
  lift ou outra estatística inferencial; nenhuma reavaliação intermediária; nenhum
  aumento oportunista de N após olhar resultado.
- Atingido o gate → UMA avaliação → gerar `FASE2_RELATORIO.md` → parar → revisão humana.

**9. Critério PASS/FAIL.**
- PASS ⇔ `p < 0,0056` E sinal do lift = −1. FAIL ⇔ qualquer outro resultado.
- `UNDERPOWERED` ⇔ time-box esgotado sem gate amostral (sem teste, sem alegação).

**10. PREDICTIVE_GATE: permanece `false` independentemente do resultado F2.**
- F2-PASS jamais altera o gate automaticamente. Liberação futura exige revisão humana,
  entrada neste documento e critérios próprios de exibição/calibração.

**Controles obrigatórios:** R5/R6 intocados · relatório R6 intocado · R6 jamais
reexecutado · fronteiras jamais reestimadas · pool F2 disjunto · painel intocado ·
sem probabilidades · sem teste intermediário · sem reprocessamento pós-resultado ·
sem extensão oportunista de N ou time-box.

**Estado:** F2-v1 PRÉ-REGISTRADO (decisões humanas acima; implementação NÃO iniciada) ·
PREDICTIVE_GATE=false · PREDICTIVE SIGNAL LOCKED.

### Encerramento F2-v1 — FAIL / não replicada (avaliação única 2026-09-10T00:07:12Z)

> F2-v1 CONCLUÍDA e avaliada UMA única vez
> (`node scripts/fase2-monitor.mjs --evaluate-once`, 2026-09-10T00:07:12Z).
> Nenhum código, protocolo ou dado alterado para a avaliação; coleta NÃO estendida;
> R5/R6 intocados; fronteiras jamais reestimadas.

**1. Resultado.** N=171 (UP=56, RANGE=53, DOWN=62) · χ²=4,28 · p-perm=0,3670
(999 permutações, seed `F2|ret15|5|20260909`, α=0,0056) · Cramér V=0,112 ·
lift −0,006% → −0,016%, sinal −1 (igual à referência) · **PASS=não**.

**2. Conclusão.** `ret15 @ 5m` NÃO foi replicada prospectivamente (p ≫ α;
associação indistinguível de ruído). Registro formal: **F2-v1 = FAIL / não replicada**.

**3. PREDICTIVE_GATE permanece `false`.** Nenhuma probabilidade preditiva liberada;
nenhuma exibição nova no painel. Liberação futura exige revisão humana, novo
pré-registro e entrada própria neste documento.

**4. Evidência congelada (não tocar).** `services/market-ingestion/data/fase2-result.json`,
`FASE2_RELATORIO.md`, `services/market-ingestion/data/fase2.db` (N=171, append-only,
meta `evaluated=1`). Sem reexecução, sem reestimação, sem reprocessamento.

**5. Regra prospectiva.** Nenhuma nova análise estatística sobre o pool F2 e nenhum
novo experimento sem decisão explícita e novo pré-registro. Repetição da F2-v1
PROIBIDA (trava anti-repetição ativa: `evaluated=1` + arquivos de resultado).

**Nota operacional (fora do protocolo estatístico).** Coleta interrompida
~12:20Z–12:29Z por queda do daemon+supervisor (`ENOTFOUND fstream.binance.com`);
restart urgente 12:29:42Z via `supervise-daemon.ps1 -RequireBuild`; cadeia revalidada
8/8. Gap tratado por design (âncoras sobre o gap descartadas). Gate cruzado às
19:20:31Z (N=120, 39/39/42). Task `Preditivo-Daemon` criada (auto-start no logon;
infra, sem efeito estatístico).

**Estado:** F2-v1 ENCERRADA (FAIL, avaliação única 2026-09-10T00:07:12Z) ·
REPETIÇÃO DA F2 PROIBIDA · R6 NÃO reexecutado · PREDICTIVE_GATE=false ·
PREDICTIVE SIGNAL LOCKED.

### Fase operacional — volatilityFactor 5.0 + histerese 3→5 — 2026-09-14

> Registro canônico da fase atual e de todos os próximos marcos. Este registro será
> atualizado conforme cada marco for concluído. Não alterar retroativamente resultados
> históricos; apenas acrescentar/atualizar o estado operacional da fase.

**1. DECISÃO.**
- Filosofia: "bom o suficiente, estatisticamente honesto e operacionalmente estável".
- Não buscar fórmula perfeita.
- Manter `volatilityFactor = 5.0`.
- Implementar histerese assimétrica: entrada em novo regime = 3 confirmações;
  saída de regime = 5 confirmações; transição direta BULL↔BEAR também exige 5.
- Não alterar outros parâmetros/indicadores.

**2. IMPLEMENTAÇÃO.**
- Arquivo: `services/market-ingestion/src/engine/regime.ts`.
- `confirmationEnter = 3`; `confirmationExit = 5`.
- `confirmationThreshold = 3` mantido como alias deprecated por compatibilidade, quando aplicável.
- `updateState()` como único ponto lógico alterado.
- `volatilityFactor = 5.0` preservado (`baseThreshold 0.05`, `windowSeconds 60`, `minSamples 10` intactos).
- `flow-regime.ts` não alterado. R6/F2 não alterados.
- Testes: `services/market-ingestion/tests/hysteresis-test.ts` atualizado
  (`volatilityFactor 2.0→5.0`, determinístico, Fase 3 recalibrada) +
  `services/market-ingestion/tests/regime-hysteresis-3-5.test.ts` criado.

**3. VALIDAÇÃO (2026-09-14).**
- `regime-hysteresis-3-5.test.ts`: 14/14 PASS.
- `hysteresis-test.ts`: 8/8 PASS.
- typecheck (`market-ingestion`): PASS.
- `npm test` raiz: 66/66 PASS.
- build (`market-ingestion`): PASS.

**4. DEPLOY (14/09/2026).**
- Deploy controlado: daemon antigo (PID 17692, desde 12/09) substituído via supervisor
  existente (PID 8476); processo atual PID 11692 (criado 14/09 18:36:37 local).
- `market.db` preservado (sem apagar, recriar ou resetar).
- Snapshots retomaram cadência ~60s (60s/60s pós-restart).
- Gap máximo pós-restart: 122s (janela do restart); gaps >3min: 0.
- `regime_events` ativo (contagem crescente).
- Código novo presente no `dist` (`dist/engine/regime.js` com `confirmationEnter/confirmationExit`).

**5. ESTADO DA COLETA.**
- Início da observação operacional: 14/09/2026; duração planejada: 3–5 dias.
- Coleta principal permanece ativa. R6 congelado. F2-v1 encerrado/FAIL e congelado.
- Nenhum novo experimento estatístico será aberto durante esta fase.

**6. O QUE SERÁ MONITORADO (checklist atualizável).**
- [ ] estabilidade do daemon
- [ ] continuidade dos snapshots
- [ ] gaps de coleta
- [ ] frequência de mudanças de regime
- [ ] duração dos regimes
- [ ] ocorrência de flapping
- [ ] comportamento da histerese 3→5 em transições reais
- [ ] sinais obviamente incoerentes
- [ ] erros operacionais
- [ ] comparação qualitativa com comportamento anterior

**7. GATE FINAL DA FASE.**
- PASS quando: coleta estável; sem falhas relevantes; flapping razoavelmente controlado;
  sem deterioração evidente; sinais operacionalmente aceitáveis; histerese funcionando
  conforme esperado.
- FAIL somente diante de problema concreto e recorrente.
- Se PASS → congelar `volatilityFactor 5.0 + histerese 3→5` → encerrar ajustes do motor →
  avançar para o painel final.

**8. PRÓXIMOS MARCOS (roteiro — atualizar conforme concluído).**
- [x] Implementar `volatilityFactor 5.0`
- [x] Implementar histerese 3→5
- [x] Testes determinísticos
- [x] Typecheck
- [x] Testes raiz
- [x] Build
- [x] Deploy controlado
- [x] Confirmar daemon
- [x] Confirmar snapshots
- [x] Corrigir resiliência do supervisor/daemon (15/09 — ver §11)
- [x] Confirmar execução autônoma (Hidden, bateria, BootTrigger)
- [x] Testar restart automático (kill controlado 15/09 19:00Z — PASS)
- [ ] Observar coleta (3–5 dias, desde 14/09; gap 96min em 15/09 tratado)
- [ ] Confirmar estabilidade operacional
- [ ] Avaliar flapping
- [ ] Comparar com comportamento anterior
- [ ] Decidir PASS/FAIL
- [ ] Se PASS, congelar parâmetros
- [ ] Avançar para painel final
- [ ] Registrar encerramento da fase

**9. REGRA DE ATUALIZAÇÃO.**
"Este registro será atualizado conforme cada marco for concluído. Não alterar
retroativamente resultados históricos; apenas acrescentar/atualizar o estado operacional da fase."
Atualizações futuras da coleta alteram ESTA seção em vez de criar documentos paralelos desnecessários.

**10. RESTRIÇÕES.**
- Não reabrir R6. Não reavaliar F2-v1. Não usar os registros pós-encerramento do F2
  como evidência do experimento original. Não fazer grid search. Não adicionar
  indicadores. Não alterar parâmetros durante a observação sem uma nova decisão registrada.
- `PREDICTIVE_GATE=false` mantido; nenhuma probabilidade liberada nesta fase.

**11. INCIDENTE OPERACIONAL — 15/09/2026 (resiliência do Preditivo-Daemon).**
- Data/hora: gap `2026-09-15T15:40:36Z` (último snapshot 29245) → retomada `17:16:59Z` (29246) e
  segundo gap `17:27:59Z` → `19:01:04Z` (29265) durante testes; gap principal ~96 min (5708s).
- Sintoma: `node dist/index.js` (daemon) e supervisor `powershell` encerraram sem crash técnico
  registrado (`daemon.err` vazio, `daemon-crash.log` sem entrada, `supervisor.log` sem `exit`).
  `tasklist` às 17:15:38Z sem `node` em 3001; `Get-NetTCPConnection :3001` vazio.
- Causa raiz: tarefa `Preditivo-Daemon` (`\Preditivo-Daemon` `InteractiveToken`, `LogonTrigger` único,
  `DisallowStartIfOnBatteries=true`, `StopIfGoingOnBatteries=true`, `Hidden=false`, `WakeToRun=false`,
  `ExecutionTimeLimit PT72H`, `RestartCount 0`, sem `BootTrigger`, `MultipleInstances IgnoreNew`).
  Dependia de sessão interativa com janela PowerShell visível; ao fechar/minimizar a janela ou
  ao entrar em bateria/sleep, o supervisor era encerrado e a tarefa não reiniciava até o próximo
  logon/manual `schtasks /Run`. O script `supervise-daemon.ps1` em si é resiliente (loop com
  backoff 1s→15s, anti-loop 5 falhas <10s → 30s, detecção de porta 3001 e lock `daemon.lock`),
  mas o hospedeiro (Task Scheduler) não era.
- Correção aplicada (menor solução robusta, sem tocar `volatilityFactor 5.0`, histerese `3→5`,
  `RegimeDetector`, R6/F2 ou `market.db`):
  tarefa recriada via `schtasks /Create /XML` elevado (UAC) com
  `DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`, `Hidden=true`,
  `WakeToRun=true`, `ExecutionTimeLimit PT0S` (sem limite), `RestartOnFailure Count 999 Interval PT1M`,
  `MultipleInstances IgnoreNew` preservado, `LogonTrigger` + `BootTrigger` adicionado,
  `Action` com `-WindowStyle Hidden`, `WorkingDirectory` preservado. Intervenção manual nas
  Tasks `Preditivo-F2-Monitor`/`Preditivo-R6-Status` não necessária.
- Teste de recuperação automática (obrigatório, não destrutivo no banco):
  1) `schtasks /Run` com daemon já vivo → `supervisor.log` `processo do daemon já existe: pid=13496`
     — sem segunda instância, sem `EADDRINUSE` (PASS).
  2) `Stop-Process -Id 13496 -Force` (kill controlado do filho) → `supervisor.log`
     `exit -1 após 350s - reiniciando em 1000ms` → novo `node 12272` em `:3001` (PASS).
  3) `market.db` preservado (`29264` → `29265`, sem reset), snapshots retomados `19:01:04Z`
     (gap de restart ~110s), `3000` (`11240` Next) e `3001` (`12272` daemon) únicos.
  4) `volatilityFactor 5.0 + histerese 3→5` intactos no `dist` (`confirmationEnter 3 / confirmationExit 5`).
  Logs: `supervisor.log` registra início/PID/exit/restart com timestamp; `daemon.log` preserva
  heartbeat/broadcast (sobrescrito a cada restart, histórico de crash em `daemon-crash.log` append).
- Resultado: supervisor agora autônomo em background (Hidden), sobrevive a fechamento de janela/terminal
  e a transição de bateria, reinicia o daemon em ~1s após morte, não cria dupla instância (lock +
  porta), e inicia em `Boot` e `Logon` para a janela offline de 4h.

**12. PAINEL DEFINITIVO — início da construção (2026-09-18).**
- Início: 2026-09-18 ~18:05Z, em paralelo com a coleta, sem interromper nem reiniciar o daemon.
- Arquivos alterados/criados (escopo fechado, só painel):
  - `scripts/painel-status.mjs` (NOVO) — gerador do artefato; abre `market.db` estritamente
    read-only (`DatabaseSync` com `readOnly: true`); só contagens + últimos 50 `regime_events`
    (24h/7d, durações por regime); escrita atômica (tmp + rename); nenhum teste estatístico,
    nenhuma probabilidade, nenhum parâmetro.
  - `public/painel-status.json` (ARTEFATO GERADO pelo script, gitignored como `r6-status.json`;
    nunca editado à mão) — refresh sugerido a cada 5 min via Task Scheduler.
  - `app/PainelDefinitivo.tsx` (NOVO) — seção observacional: consome o MESMO WebSocket do
    `MarketStreamProvider` (nenhum socket próprio) + `fetch painel-status.json` a cada 60s;
    exibe regime atual, indicadores do motor, saúde da coleta, timestamps e histórico de
    mudanças de regime; reutiliza classes CSS `obs*`.
  - `app/page.tsx` (1 bloco: import + `<PainelDefinitivo/>` após `flowWidgetsRow`).
  - `.gitignore` (`/public/painel-status.json` como artefato não versionado).
- Validações realizadas:
  - `node scripts/painel-status.mjs` → JSON válido (33.731 snapshots, 182.548 regime_events,
    1.483 mudanças 24h); `market.db` sem escrita pelo script (modo read-only).
  - `npx tsc --noEmit` raiz: PASS, sem erros.
  - `npm test` raiz: 66/66 PASS.
  - `eslint` nos 3 arquivos do painel: limpo.
  - `npm run build`: PASS (Next 16.3.1, rota `/` prerenderizada com `id="painel-definitivo"`);
    artefatos de build em `out/` revertidos em seguida (`git checkout + clean`), fora do escopo.
  - Daemon: mesmos PIDs antes/depois (sem restart); porta 3001 única; WAL com escrita
    contínua (coleta ativa); `git status --porcelain -- services/` sem alteração minha
    (só pré-existentes); parâmetros `volatilityFactor 5.0 + histerese 3→5` intactos.
- Estado atual: coleta continua normalmente enquanto o painel é construído; R6 congelado;
  F2-v1 congelado (FAIL); `PREDICTIVE_GATE=false`; nenhuma probabilidade exibida.
- Atualização automática (2026-09-18 ~18:15–18:25Z — pendente operacional concluído):
  - Tarefa criada: `\Preditivo-Painel-Status` (Task Scheduler, espelho da `Preditivo-R6-Status`):
    `C:\Program Files\nodejs\node.exe "…\scripts\painel-status.mjs"`, WorkingDirectory na raiz
    do projeto, gatilho a cada 5 min (`Repetition PT5M`, duração 10 anos, `StartWhenAvailable`),
    habilitada; `node.exe` direto (sem janela PowerShell); `MultipleInstancesPolicy=IgnoreNew`
    (sem instâncias concorrentes do gerador); bateria sem restrição
    (`DisallowStartIfOnBatteries=false`, `StopIfGoingOnBatteries=false`, como a correção do
    daemon); `InteractiveToken` como a task R6 de referência. Não inicia/reinicia o daemon;
    não escreve em `market.db` (script read-only).
  - Teste manual (`schtasks /Run`, 18:17:52Z): `LastTaskResult=0`; `public/painel-status.json`
    atualizado (33.731→33.738 snapshots, 182.548→182.606 regime_events); JSON válido
    (`updatedAt` recente, `recent=50`); PIDs do daemon inalterados; porta 3001 com o mesmo
    dono (9580); snapshots seguindo (coleta ativa); nenhum erro novo.
  - Teste automático (execução agendada 18:22:40Z, sem tocar no daemon): `LastRunTime`
    15:22:41 local, resultado 0, 0 perdidas, próxima 15:27:40; JSON avançou
    (18:17:52→18:22:41Z, 33.738→33.743 snapshots); PIDs/porta inalterados.
  - `git status`: nenhuma alteração minha em `services/`, motor, parâmetros, R6/F2 ou coleta.
- Refinamento visual/UX (2026-09-18 ~18:35–18:45Z — só apresentação, escopo de 2 arquivos):
  - `app/PainelDefinitivo.tsx` (único componente alterado): faixa de status operacional no topo
    mapeando o `status` já existente do stream (`live`→`● SISTEMA OPERACIONAL`,
    `connecting/reconnecting`→`● ATENÇÃO — COLETA ATRASADA`, `off/disconnected`→`● PROBLEMA —
    COLETA INDISPONÍVEL`, sem threshold novo); badge de regime com cor só no badge
    (BULL verde / BEAR vermelho / RANGE âmbar / demais cinza) + rótulo PT explícito;
    confiança como número + barra discreta (largura = valor existente) + nota "não é
    probabilidade de acerto"; cores pontuais em flow/divergência (âmbar)/absorção (roxo);
    saúde com cinza "aguardando" para `UNKNOWN/UNAVAILABLE`; histórico com marcador por tipo
    e destaque para `regime_change`; contagens `"N mudança(s) · ~Xmin"` (mesmos números);
    gaps em 2 linhas (`Segmentos N` / `Gaps >3min N total`); células reordenadas
    (status→regime→conf/vol→fluxo→saúde→CVD→histórico). Mesmas fontes, mesmos valores,
    nenhum cálculo/indicador novo, nenhum socket novo.
  - Diagnóstico CSS (screenshot ≠ validação): o `next dev` antigo (PID 11240, desde 15/09)
    servia TSX novo com bundle CSS obsoleto (stylesheet sem regras `pdef`, confirmado em
    browser zerado); reparo autorizado: restart idêntico do `next dev`
    (`npm run dev`, mesmo diretório; 11240→10144 na porta 3000; daemon 9580/3001 intocado,
    sem limpar `.next/dev` — não foi preciso). Sem alteração de código.
- Leitura PT-BR do histórico (2026-09-18 ~19:40Z — só `app/PainelDefinitivo.tsx`, apresentação):
  tipos traduzidos (`absorption_triggered`→"Absorção iniciada", `absorption_interrupted`→
  "Absorção interrompida", `absorption_resolved`→"Absorção encerrada", `absorption_failed`→
  "Absorção expirada", `divergence*`→"Divergência…", `flow_change`→"Fluxo"), valor `to` à
  direita traduzido, `regime_change` em destaque, sem agrupar/descartar; "atualizado há X"
  ao lado do título (usa `updatedAt` do artefato); FLUXO NEUTRO e marcador `flow_change`
  no mesmo cinza-azulado discreto; `<1min` quando `avgMin < 1` no artefato + nota
  "base: últimos 50 eventos" (confirmado no código: `RECENT_LIMIT=50` em
  `scripts/painel-status.mjs`; `avgMin` = média arredondada em minutos; 24h/7d são janelas
  temporais separadas — por isso ~10 vs ~1,5k).
  Validações: tsc PASS; eslint limpo; `npm test` 66/66; build PASS (`out/` revertido);
  screenshot pós-alteração com dados reais (badge BEAR, barra 55%, traduções, `<1min`,
  "atualizado há 15s"); console sem erros do painel; task `Preditivo-Painel-Status`
  rodando (resultado 0, 0 perdidas); daemon/porta intactos.
  Medição (sem correção nesta etapa): WS ~1s vs artefato ~5min — rodapé/histórico
  defasado ~15s após cada geração, crescendo até ~5min entre execuções da task.
  - `app/globals.css` (somente append de bloco escopado `#painel-definitivo`, ~20 linhas;
    nenhuma regra existente tocada).
  - Validações: `tsc --noEmit` PASS; `eslint` limpo; `npm test` 66/66 PASS; `npm run build`
    PASS (pré-render contém `pdefStatus/pdefBadge`); `out/` revertido após o build.
    Navegador (skill browser-automation, `http://localhost:3000`, dev server pré-existente
    PID 11240 — não criado nem reiniciado por mim): painel montado com dados reais do WS
    (`SISTEMA OPERACIONAL · último dado há 0s`); badge RANGE âmbar e BEAR vermelho
    observados ao vivo em sequência (estados reais, motor intocado); console sem erros do
    painel (só CORS/aborts pré-existentes de fontes externas); 12 linhas de histórico com
    tons corretos; saúde WS/OI/FUNDING "normal".
  - Motor, parâmetros (`volatilityFactor 5.0`, histerese `3→5`), `market.db`,
    `scripts/painel-status.mjs`, tasks `Preditivo-Daemon`/`Preditivo-Painel-Status`, R6/F2:
    intactos (PIDs 2820/3208/9580/11240/17324 inalterados; porta 3001 → 9580; task do painel
    Ready com próxima execução agendada).

**Estado:** FASE OPERACIONAL EM OBSERVAÇÃO (desde 14/09/2026, 3–5 dias) ·
`volatilityFactor 5.0 + histerese 3→5` EM COLETA · R6 CONGELADO · F2-v1 CONGELADO (FAIL) ·
RESILIÊNCIA CORRIGIDA (15/09 19:01Z) · PAINEL IMPLEMENTADO + ATUALIZAÇÃO AUTOMÁTICA ATIVA + REFINAMENTO VISUAL VALIDADO (18/09) ·
FASE 1A IMPLEMENTADA — INDICADOR ÚNICO EM `/indicador-unico` (19/09, aguardando conferência do dono; Fase 1B/2 NÃO executadas) ·
PREDICTIVE_GATE=false · PREDICTIVE SIGNAL LOCKED.

### GATE FINAL — 2026-09-21 (fase `volatilityFactor 5.0 + histerese 3→5` — somente leitura)

> Avaliação da fase já coletada, sem alterar parâmetros, sem reiniciar o daemon,
> sem interromper a coleta, sem novo experimento, sem grid search/recalibração/
> otimização, sem alterar R6/F2. Motor e banco acessados somente em leitura.

- Período avaliado: **2026-09-14T18:00:34Z → 2026-09-21T14:22:07Z** (~164,4h).
- Fase: **9.796 snapshots**; **56.729 regime_events**; **9.041 regime_change (~55/h)**.
- Gaps >3min na fase: **5**, maior de **17.069s em 15/09**, já tratado/documentado (§11 + correção de resiliência 15/09 19:01Z).
- Cadência: mediana **60,0s** / p99 **60,015s** (média 60,4s, efeito dos gaps).
- Daemon **PID 9580 estável desde 15/09 22:08 local**, sem restarts após a correção; porta 3001 em LISTEN no PID 9580.
- `sent=saved=8.334`; `errors=0`, `backlog=0`, `dbWorkerAlive=true`; **WS LIVE**; **OI/Funding sem NULL** na fase.
- Regime: duração média **65,5s** / mediana **27,1s**; reversões <30s **53,4%** (ref. v1: 68%); BULL↔BEAR diretas **13 (0,14%)**; distribuição das entradas **RANGE 49,9% / BULL 25,3% / BEAR 24,8%**.
- Histerese 3→5 **confirmada no código em produção** (`dist/engine/regime.js` com `volatilityFactor 5.0`, `confirmationEnter 3`, `confirmationExit 5`; lógica `src/engine/regime.ts:133-151`); verificação direta por evento das confirmações: **NÃO CONCLUSIVA, porque candidatos não são persistidos** (só eventos confirmados); sem comportamento anômalo evidente.
- Sem evidência de deterioração em relação à referência documentada.
- `PREDICTIVE_GATE=false` mantido; nenhuma probabilidade liberada.

**Conclusão:**

`GATE FINAL: PASS`
`PARÂMETROS: CONGELAR volatilityFactor=5.0 + histerese 3→5`
`COLETA: CONTINUA` (o GATE encerra a avaliação; o daemon segue acumulando com os parâmetros congelados; coleta NÃO desligada automaticamente).

**Estado:** FASE OPERACIONAL CONGELADA (`volatilityFactor 5.0 + histerese 3→5`) · COLETA ATIVA · R6 CONGELADO · F2-v1 CONGELADO (FAIL) · PREDICTIVE_GATE=false · PREDICTIVE SIGNAL LOCKED.

### Fase 1A — Indicador Único (2026-09-19 — só apresentação, sem redundância)

- **Objetivo:** consolidar os dados operacionais dos 5 painéis numa leitura única,
  referência visual/hierárquica = Painel Definitivo; 5 painéis intocados e no ar.
- **O que entrou (rota `/indicador-unico`, link "Indicador Único" no header):**
  `app/glossario.ts` (novo; só equivalências confirmadas; `DIVERGENCE_BEAR` =
  "DIVERGÊNCIA DE BAIXA" conforme `PainelDefinitivo`; sem "ABSORÇÃO COMPRADORA"),
  `app/IndicadorUnico.tsx` (novo; 6 blocos: status, regime, fluxo/estrutura,
  CVD/OI/funding, saúde, mudanças+histórico), `app/indicador-unico/page.tsx`
  (nova rota com `MarketStreamProvider` existente + volta "Painéis"),
  append escopado `#indicador-unico` em `app/globals.css`, 1 anchor no header
  de `app/page.tsx`. WS via `useMarketStreamContext`; JSON via fetch do
  `painel-status.json` com a mesma cadência 60s dos consumidores existentes
  (sem socket/provider/polling/cadência novos).
- **O que foi excluído e por quê:** Confluência/NEXUS/`analysis.score`/ActionTag/
  "FORÇAS EM DISPUTA" (outro motor e outra fonte — Fase 0 §1); modo leigo e frases
  de CVD acumulado (CVD é acumulado desde reset, sem janela comparável — Fase 0 §3/§8);
  sparkline/whale-sessão/churn/CVD-Δ15m (cálculos exclusivos do Observatório);
  `StructuralAlert`, R6/OOS/estatística (gate); eixo "Fluxo +15" (é o score
  reescalado, não fluxo); qualquer probabilidade ou texto de ação/projeção.
- **Rótulos/fonte por grupo:** faixa de status = `status` do stream; regime/confiança/
  volatilidade = `data.regime*` ("Força do movimento (60s)", `min(100,|netChange|/
  threshold*50)`, janela 60s); Score do motor = `data.score` ±100;
  Concordância = `score_quality` 55–100 (variáveis distintas, linhas separadas);
  fluxo canônico = `data.imb` ("Book imbalance (instantâneo)" ±%);
  `flow_regime` textual; Força = `flow_strength` (secundária);
  CVD/OI/ΔOI/funding crus; saúde = `quality`+`dbStats` ("Uptime efetivo
  (snapshots ÷ 60)", sem correção); histórico = JSON (24h/7d/contagens/`recent`,
  "atualizado há X" via `updatedAt`, nota dos 50 eventos).
- **Cadências (não sincronizadas):** WS ~1s ("ao vivo") × JSON ~5min (idade exibida).
- **Validações:** tsc PASS; lint 0 erros (4 warnings pré-existentes em script
  congelado); `npm test` 66/66; build PASS com `/indicador-unico` (`out/`
  revertido); dev reiniciado idêntico (10144→588, `.next/dev` limpo — CSS
  obsoleto de novo, mesmo procedimento autorizado); stylesheet servido com 15
  regras `.iu`; screenshot com dados reais; console sem erros do indicador;
  daemon 9580/3001 e tasks intactos.
- **Pendências reais:** 404 de `icon.svg` na rota (pré-existente, sem `icon.svg`
  em `public/`); "atualizado há X" defasado até ~5min entre gerações do JSON
  (estrutural, por desenho).
- **Acréscimos pós-validação (19/09 — só `glossario.ts`, `IndicadorUnico.tsx` e este registro):**
  - Vocabulário: divergência usa os rótulos do Painel Definitivo ("DIVERGÊNCIA DE
    ALTA/BAIXA"); `FLUXO ANTECEDE PREÇO` removido do Indicador Único (sem terceira
    nomenclatura). `divergence_resolved` = "Divergência encerrada" (só indica que a
    divergência terminou com saída de RANGE na direção prevista —
    `flow-regime.ts:58-63`); `divergence_failed` = "Divergência não confirmada",
    mantido pela distinção explícita do código (`matched ? resolved : failed`,
    `flow-regime.ts:55-59`).
  - Remoção da interface: "Força do fluxo (instantânea)" retirada do Indicador Único
    (motivo: número sem calibração demonstrada; o canônico segue `data.imb`).
  - **Pendência de calibração (não corrigida):** `flow-regime.ts:88-92` —
    `dominance = imb×50 + clamp(whaleCvd/500000)×50`; o termo whale é a soma
    assinada em USD dos trades ≥US$100k (`flow/cvd.ts:14-27`, `config.whaleNotionalUsd`),
    acumulada desde o último reset. Redação factual: investigar o comportamento e a
    saturação do termo whale no cálculo existente, especialmente sob diferentes
    estados pós-reset e períodos de acumulação. Motor, fórmula, divisor, saturação
    e thresholds intocados.
- **Último ajuste (19/09 — só `glossario.ts`, `IndicadorUnico.tsx` e este registro):**
  `Classe funding` (`IndicadorUnico`, bloco CVD/OI/FUNDING) exibia o cru em inglês
  (`neutral/positive/negative/extreme`, `derivatives/funding.ts:16-24`) → traduzido
  via `glossario.rotuloFunding` (neutro/positivo/negativo/extremo, distinção de
  extremo preservada); sem tocar cálculo, thresholds, fonte ou cadência.
  `divergence_resolved` → "Divergência confirmada" (termina com saída na direção
  prevista, `flow-regime.ts:55-63`); `divergence_failed` segue "Divergência não
  confirmada". `Força do fluxo (instantânea)` permanece removida; calibração do
  termo whale permanece pendente como investigação; nenhuma lógica do motor alterada.
- **Observação externa (19/09, entre 00:29 e 11:26 — leituras de tela do
  dono/analista, NÃO verificada nos logs nem no motor):** em 6 leituras, a Força
  do fluxo coincidiu com `imbalance ÷ 2 + 50`, com CVD whale entre aproximadamente
  596M e 681M. Não constitui regra estrutural nem evidência do funcionamento interno;
  não vira fórmula, regra, threshold ou hipótese validada; não se afirma que
  `BEAR_FLOW` é inalcançável. Investigar posteriormente junto com o comportamento
  e a saturação do termo whale em `flow-regime.ts:88-92`.
- **Pendência de vocabulário (Fase 2):** o Painel Definitivo pode exibir
  "Divergência encerrada" para o mesmo evento `divergence_resolved` que o
  Indicador Único agora exibe como "Divergência confirmada". A padronização fica
  pendente para a Fase 2, junto à desativação dos painéis antigos. O Painel
  Definitivo não foi alterado nesta etapa.

---

# FILA DE MUDANÇAS FUTURAS (backlog)

> Itens **parqueados** — não executar enquanto o gate da Fase 1 não avançar ou sem decisão
> explícita do usuário. Sair da fila = registrar a decisão aqui e executar em revisão separada.

## P1 — Recalibração do threshold "whale" (classificação · CVD WHALE · whale events)

- **Status: EXECUTADO em 26/08 (autorização do arquiteto — P0-01 do observatório).** Decisão aplicada:
  threshold **absoluto US$ 100.000** (`CONFIG.flow.whaleNotionalUsd`) + **fonte migrada para o
  `@aggTrade` nativo** (endpoint `/market/ws`, auditoria §20/§21) + ids preservados (`events.trade_id` =
  `a`, com `f`/`l` e nº de execuções nos details; schema v3, índice único parcial) + testes (40/40).
  Histórico antigo **intocado** (sem reprocessamento; `trade_id NULL` permanece).

  **Semântica do dataset whale (v1 → v2 → v3) — para a seção separada da Fase 1:**
  | Fase | Fonte | Threshold | Período |
  |---|---|---|---|
  | v1 | `@trade` execuções | relativo (3× média) | 25/08 23:07Z → 26/08 ~12:05Z |
  | v2 | `@trade` + agregação client-side ~100ms | $100k | 26/08 ~12:05Z → ~12:58Z |
  | v3 | **`@aggTrade` nativo** (agregação por ordem taker) | $100k | 26/08 ~12:58Z → atual |

  A agregação client-side (~100ms) foi **removida** após a comparação (60s) demonstrar redundância:
  VWAP/quantidade/notional/lado 100% idênticos ao nativo; eventos LARGE nativos 6/6 casados com par
  client (ratio notional p50 = 113%); o nativo é a agregação autoritativa (mais fina, 878 vs 226 eventos).
- **Achado original (26/08):** `classifyTrade` definia `large`/whale como
  trade > **3× a média móvel dos últimos ~500 trades** (`services/market-ingestion/src/flow/classification.ts`),
  com janela com vazamento (`rollingSum -= rollingAvg` subtrai a média atual, não o valor que sai —
  não é uma janela deslizante real). Threshold **relativo**, não absoluto.
- **Números (SQLite, 26.224 eventos / 132 min — antes da correção):** ticket médio compra **$25,8k** /
  venda **$26,3k** (~**0,33 BTC**); mediana **$16,4k**; 11% ≥ $50k; 2,4% ≥ $100k; 7 ≥ $1M; máx 128,7 BTC.
  Em termos absolutos para BTC, **não era "grande"** → o rótulo "whale" superestimava.
- **Impacto:** whale events (seção separada da Fase 1) e **CVD WHALE** herdam o novo threshold; o daemon
  agora usa **duas conexões WS** (base `/stream` p/ depth+bookTicker; `/market/ws` p/ aggTrade).
- `whalePercentile: 90` no config era **código morto** — removido na correção.
- **Efeito colateral:** formatação `$0.0M` corrigida (fmtUsd adaptativo) em P2-01.

---

# OI SCORE — NÃO IMPLEMENTAR DURANTE A FASE 1 (decisão do arquiteto, 26/08)

**Registro explícito (manter `score.ts` e `openInterestExtreme` INALTERADOS):**

- **Threshold atual incompatível com a escala de 5s:** `features/score.ts` usa `oiChange > 0.005/0.02`
  (0,5%/2%) e `openInterestExtreme` usa `|oi_delta| > 0.005` — aplicados a um `oiChange` calculado entre
  polls de **5s** (valores reais ~0,001–0,34%). Empiricamente (2.560 snapshots): **nenhum dispara**.
- **Componente OI do score NÃO contribui atualmente:** o score jamais recebe ±4/±8 do OI; o score
  persistido (e a feature `scoreMean` da Fase 1) **não refletem OI**.
- **Alterar isso modifica o `score` e quebra a comparabilidade histórica:** qualquer recalibração muda o
  `score` persistido e a feature `scoreMean` da Fase 1 — **NÃO fazer durante a Fase 1**.
- **Qualquer recalibração deverá ocorrer em experimento/versionamento separado** (com decisão registrada
  aqui antes), preservando o histórico atual como baseline.
- **Nenhuma alteração de código** foi feita (score.ts e openInterestExtreme intocados; diff vazio em
  `services/`, `app/`, `lib/`, `scripts/`).

---

## 2026-09-23 — UX: FLUXO NEUTRO + imbalance elevado (achado do Item 5, sem decisão de produto)

### Achado (estudo `scripts/offline-analysis/metric-redundancy.mjs`, somente leitura)

- `NEUTRAL_FLOW` com `|imb| > 70%`: **26,38% dentro de `NEUTRAL_FLOW`** (6.847 de 25.959 snapshots).
- Proporção sobre todos os snapshots analisados: **17,40%** (6.847 de 39.345).
- `NEUTRAL_FLOW` em aproximadamente **66,0% dos snapshots**.
- Aproximadamente 70% desses casos extremos apresentam `cvd_large` com sinal oposto ao imbalance.

### Conclusão sustentada pelos dados

> `FLUXO NEUTRO` e imbalance elevado podem coexistir segundo a lógica atualmente implementada no detector
> (`FlowRegimeDetector`: dominância = contribuição do imbalance + contribuição do whale CVD, limiar ±60,
> confirmação de 5 ticks — `services/market-ingestion/src/engine/flow-regime.ts`).

Não se registra que isso seja erro, contradição do motor ou cancelamento confirmado.

### Ressalvas registradas

- `cvd_large` de sinal oposto é **associação observada, não causalidade comprovada**.
- A dominância utilizada no estudo é uma **aproximação retrospectiva** a partir dos campos persistidos,
  não reprodução do estado interno do detector.
- Snapshots têm resolução de aproximadamente 60 s; o detector opera em aproximadamente 1 s.
- A proporção de 17,40% é uma **proporção de snapshots da amostra** e não uma medição direta da
  exposição da UI em tempo real.
- Não houve concentração relevante do fenômeno nas janelas de transição analisadas
  (taxas 17,1–17,9% contra baseline de 17,40%).

### Status

**Achado documentado / avaliação UX em aberto. Nenhuma decisão de alteração de produto.**

A avaliação de apresentação (alternativas A–E, recomendação) vive em
`reports/offline-analysis/ux-fluxo-neutro-imbalance.md` e não autoriza implementação.

### Adendo 2026-09-23 (contexto sob demanda no Indicador Único — alternativa C)

- **Problema UX:** `FLUXO NEUTRO` ao lado de imbalance extremo (17,40% dos snapshots da amostra)
  sugeria erro ou dado defasado; o caráter de classificação composta do rótulo não estava visível.
- **Alteração apenas contextual/metodológica:** atributo `title` na linha "Regime de fluxo" da célula
  `FLUXO E ESTRUTURA` (`app/IndicadorUnico.tsx`), com microcopy de metodologia geral
  (classificação composta; coexistência possível; negação explícita de "cancelamento").
  Somente Indicador Único; Super Painel e Painel Definitivo intocados.
- **Nenhuma lógica ou métrica modificada:** rótulo, imbalance, cálculos, thresholds, confirmação,
  CVD, score, regime, stream e contratos de dados inalterados; nenhuma nova escala ("Força do fluxo"
  não introduzida); contexto sob demanda (hover), sem poluição da leitura principal.
- **Arquivos:** `app/IndicadorUnico.tsx` (1 atributo) + `tests/ux-fluxo-contexto.test.mjs` (novo).
- **Testes:** `node --test tests/ux-fluxo-contexto.test.mjs` 3/3; `npm test` 65/66 (única falha em
  `tests/fase2-v1.test.mjs`, time-box do pool sintético, sem relação com esta alteração);
  `npx tsc --noEmit` sem erros.
