# AUDITORIA DIAGNÓSTICA — PAINEL DE ANÁLISE PREDITIVA (Fase 1)

**Data:** 26/08/2026 · **Tipo:** diagnóstico somente-leitura (nenhuma alteração de código, banco,
thresholds, coleta, targets ou máquina de estados). P0-01 (`@aggTrade`) **congelado e fora do escopo**.
Fonte de verdade: `scripts/fase1-experimento-minimo.mjs` (congelado), `app/PredictiveStatusCard.tsx`,
SQLite e simulações analíticas read-only.

---

## 1. TARGETS — ROLLING vs TUMBLING

**Código:** `buildObservations(h)` (fase1-experimento-minimo.mjs, linhas 141-199):
- **stride = h**: `if (t - lastAnchor < h * 60_000) continue;` + `lastAnchor = t` (linhas 146, 180) →
  as origens são espaçadas de **h minutos** (5/15/30). Janela de features `[t-15m, t]` (lookback fixo de
  15 min, ≥10 snaps, sem gap > 3 min).
- **Target**: `fwdRet = outcome.p / l.p - 1` — retorno à frente até o snapshot mais próximo de `t+h`
  (tolerância ±2,5 min, no mesmo segmento).

**Como é calculado:** cada observação = (features da janela 15m em t) → target = retorno de t até t+h.

**Rolling ou tumbling:** **TUMBLING por design** (outcomes sem sobreposição, stride = horizonte).

**Espaçamento entre origens:** h minutos (5/15/30).

**Por que N ≈ 419 / 138 / 64** (atual: 425 / 138 / 65): o stride tumbling espaça as origens em h minutos;
somam-se as rejeições de integridade (janela: 209; outcome: 53/190/355). Não é escassez de dados.

**Simulação analítica da alternativa rolling (origem a cada 1 min, MESMAS regras de janela/outcome, sem
modificar o dataset):**

| Horizonte | Tumbling (stride=h) — atual | **Rolling (stride=1 min)** | Ganho |
|---|---|---|---|
| 5m | 425 | **1.947** | ×4,6 |
| 15m | 138 | **1.810** | ×13 |
| 30m | 65 | **1.645** | ×25 |

**Classificação: CONFIRMADO** — o N baixo é consequência do **stride tumbling** (não sobreposição de
outcomes), não da escassez de dados. A alternativa rolling daria ~4-25× mais amostras sem tocar no
dataset, mas com outcomes **sobrepostos** (pseudorreplicação/autocorrelação) — o tradeoff que o desenho
atual resolve com stride=h.

**Impacto na validade:** o N tumbling é o mais conservador/independente; a potência estatística é
limitada pelo N pequeno (teste 5m = 121; 15m = 40; 30m = 19). A ausência de evidência pode refletir
poder baixo.

**Recomendação (NÃO implementada):** se quiser mais potência, avaliar **origens rolling com purging +
embargo recalibrado** (ou um híbrido). Custo de comparabilidade: **ALTO** (muda a definição de amostra).

---

## 2. INTEGRIDADE TEMPORAL / SEGMENTOS

**Segmentos (25, não ~24):** 22 segmentos com 1-715 snapshots; 3 singletons (1 snap); maior segmento
831 min; gaps entre segmentos = horas (daemon offline). Intra-segmento: cadência 60-120s (máx 165s).

**Features / lookback:** o walk-back em `buildObservations` para quando `snaps[j].t < t - 15min` **OU**
`gap > 180s` (linhas 150-153, `ok=false`). Janelas curtas (<10 snaps) e que cruzam gap são rejeitadas.
→ **Features NÃO atravessam gaps.**

**Targets / lookahead:** o walk-forward para em `gap > 180s` (linha 160); sem outcome → rejeitado.
→ **Targets NÃO atravessam gaps** (todo outcome está no mesmo segmento da origem).

**Bordas:** observações perto do início/fim de segmento são descartadas corretamente (janela curta /
outcome ausente). Rejeições registradas: janela 209, outcome 53/190/355.

**Amostras inválidas no N apresentado:** **NÃO** — toda observação tem janela íntegra + outcome no
mesmo segmento, sem usar dados inexistentes através de gap.

**Classificação: REFUTADO** — o problema "janela usa dados inexistentes através de gap" **não existe**.
A integridade temporal está correta.

**Impacto:** nenhum na validade. O N tumbling já está livre de contaminação entre segmentos.

---

## 3. GATE OOS E MÁQUINA DE ESTADOS

**Código:** `PredictiveStatusCard.tsx` (linhas 54-97). O gate tem **DOIS eixos ortogonais**:

- **A. Suficiência amostral (OOS por classe):** `gateOosMet(h)` exige OOS total ≥ 90 **E** UP ≥ 30 **E**
  RANGE ≥ 30 **E** DOWN ≥ 30 (linhas 62-73). 5m = **ATENDIDO** (121 = UP 33 / RANGE 53 / DOWN 35).
- **B. Significância/desempenho estatístico:** `reportPass(h)` = evidência fora da amostra no relatório
  ≠ "nenhuma" (linhas 54-57). 5m = **NÃO** (relatório: nenhuma evidência).
- **C. Estado operacional:** `signalReady = PREDICTIVE_GATE && anyPass && anyGateMet` (linha 77).
  `PREDICTIVE_GATE=false` (revisão não liberada). → **PREDICTIVE SIGNAL LOCKED**.

**A coexistência "OOS por classe ATENDIDO + SEM EVIDÊNCIA + HIPÓTESE: NÃO SUPORTADA" é COMPORTAMENTO
INTENCIONAL** (gate de 2 eixos), **documentado no DECISOES** ("OOS ≥ 30 por classe E o teste OOS passar
os critérios estatísticos E revisão registrada"). O 5m atende o eixo amostral mas **falha o eixo de
evidência**; o badge correto é `VALIDAÇÃO EXECUTADA · OOS: NENHUMA EVIDÊNCIA · PREDIÇÃO: BLOQUEADA`
(linhas 89-91), e o headline `HIPÓTESE: NÃO SUPORTADA` (linhas 79-85) reflete o veredito do relatório.

**Classificação: CONFIRMADO** — não é inconsistência, nem bloqueio administrativo; é o segundo critério
do gate não atendido (evidência OOS), operado pela máquina de estados projetada.

**Impacto:** nenhum (estado correto). **Recomendação:** não alterar a máquina de estados.

---

## 4. HORIZONTE 1m

**Frequência real dos snapshots:** 1 linha/min; intervalo p50=60s, p90=93s; **não há série persistida
de 1s** (o stream ao vivo é 1s, mas não é gravado).

**Resolução temporal das features:** snapshots de 1/min; janela de features fixa de 15 min.

**Dados/eventos subminuto disponíveis:** whale events com timestamps em ms (1.517 com `trade_id`,
117k+ totais) — mas só a partir da ativação do saveEvent (25/08 23:07Z) e esparsos (≥ $100k).

**Frequência efetivamente usada pelo modelo:** 1/min (snapshots), tanto nas features quanto no target.

**Como o target de 1m seria construído:** fwdRet de t a t+1min via snapshot mais próximo (±2,5 min),
com janela de features de 15 min (hipótese fixa). **Simulação: N=2000, outcomeFail=0 → é CONSTRUÍVEL
com os snapshots atuais.**

**Distinção (sem usar Nyquist):**
- **Impossível?** NÃO. Um target de 1m é construível com os dados atuais (~2.000 amostras).
- **Inadequado com os dados atuais?** PARCIAL — a cadência ~60-93s faz o "1m" real ser ~1-1,5 min
  (blur do horizonte), e não há série 1s histórica para um 1m exato.
- **Possível, porém limitado?** SIM — possível com snapshots 1/min (limitado por blur de cadência);
  um 1m EXATO (60s) exigiria persistência subminuto.

**A frase do painel "1m — aguardando validação — exige dados subminuto" é uma SIMPLIFICAÇÃO imprecisa:**
o 1m não é impossível nem estritamente "exige" dados subminuto; é possível (limitado) com snapshots
1/min. Além disso, **1m NÃO é um horizonte do experimento congelado** (HORIZONS = [5,15,30]) — a linha
"1m" no painel é um placeholder de exibição.

**Classificação: CONFIRMADO (a frase é imprecisa); o 1m é possível, porém limitado.**

**Impacto na validade:** nenhum (1m não entra no experimento). **Recomendação (P2, display):** corrigir
a redação da linha 1m para "possível com snapshots 1/min (limitado) ou exige persistência 1s para 1m
exato" / ou indicar que 1m não está no experimento atual.

---

## 5. UP / DOWN / RANGE

**Definição exata:** `trainClassBoundaries(train)` + `labelClasses` (fase1-experimento-minimo.mjs, linhas
211-215): **tercis do retorno à frente, fronteiras calculadas SÓ no treino**; DOWN se `fwdRet < b1`,
RANGE se `b1 ≤ fwdRet ≤ b2`, UP se `fwdRet > b2`.

**Thresholds por horizonte (fronteiras do treino):**
| H | DOWN < | RANGE ≤ | < UP |
|---|---|---|---|
| 5m | -0,045% | 0,036% | — |
| 15m | -0,096% | 0,062% | — |
| 30m | -0,173% | 0,030% | — |

**Distribuição das classes (OOS):**
| H | OOS | UP | RANGE | DOWN | majoritária (baseline) |
|---|---|---|---|---|---|
| 5m | 121 | 33 (27,3%) | **53 (43,8%)** | 35 (28,9%) | RANGE 43,8% |
| 15m | 40 | 8 (20%) | **20 (50,0%)** | 12 (30%) | RANGE 50,0% |
| 30m | 19 | 6 (31,6%) | **10 (52,6%)** | 3 (15,8%) | RANGE 52,6% |

Treino: ~33/33/33 (por construção — tercis). OOS: RANGE sobre-representado (44-53%).

**A predominância de RANGE é CONSEQUÊNCIA LEGÍTIMA da definição** (fronteiras congeladas no treino +
deslocamento da distribuição dos retornos do OOS para o meio), **não um problema estatístico por si**.
Um baseline "sempre RANGE" daria 43,8-52,6% (acurácia = maioria, sem informação preditiva).

**Balanced accuracy:** **N/A** — o experimento mínimo **não constrói classificador** (são testes de
associação χ²/permutação por feature, não um modelo UP/RANGE/DOWN). Se um classificador for construído
em fases futuras, a acurácia balanceada será obrigatória para não ser dominado pela classe RANGE.

**Classificação: CONFIRMADO** (RANGE predominante = consequência da definição do target; não é bug).

**Impacto:** a classe RANGE ampla reduz o poder de separação; não invalida os testes de associação.

---

## 6. REGRA DE EVIDÊNCIA (por hipótese)

| # | HIPÓTESE | CÓDIGO/DADO QUE TESTA | RESULTADO | CLASSIFICAÇÃO |
|---|---|---|---|---|
| 1 | N baixo = escassez de dados (não tumbling) | stride=h em buildObservations + simulação rolling | rolling daria 1.947/1.810/1.645 | **CONFIRMADO (tumbling)** |
| 2 | Janelas atravessam gaps → amostra inválida | walk-back/forward param em gap > 180s | 0 amostra atravessa gap | **REFUTADO** |
| 3 | OOS ATENDIDO + SEM EVIDÊNCIA é inconsistência | gate de 2 eixos em PredictiveStatusCard | comportamento intencional documentado | **CONFIRMADO (intencional)** |
| 4 | 1m "exige dados subminuto" | simulação 1m com snapshots 1/min | N=2000, construível | **CONFIRMADO (frase imprecisa)** |
| 5 | RANGE predominante é problema estatístico | definição por tercis do treino + OOS | consequência legítima | **CONFIRMADO (não é bug)** |

---

## 7. SAÍDA FINAL — MATRIZ, IMPACTO, CORREÇÕES E COMPARABILIDADE

**Matriz dos cinco problemas:**

| ID | Problema | Classificação | Impacto na validade | Prioridade | Quebra comparabilidade? |
|---|---|---|---|---|---|
| T | N baixo (stride tumbling) | CONFIRMADO (design) | limita potência; não invalida | P1 (avaliar rolling p/ mais N) | **ALTO** |
| S | Amostras inválidas via gaps | **REFUTADO** (não há) | nenhum | — | — |
| G | OOS ATENDIDO + SEM EVIDÊNCIA | CONFIRMADO (intencional) | nenhum (estado correto) | — | — |
| 1m | "exige dados subminuto" | CONFIRMADO (frase imprecisa) | nenhum (display; 1m fora do experimento) | P2 (redação) | nenhum |
| C | RANGE predominante | CONFIRMADO (consequência da definição) | reduz poder de separação | P1 (documentar baseline p/ fases futuras) | nenhum (se só documentar) |

**Recomendações (NÃO implementadas — aguardando autorização):**
1. **P1 — Potência amostral:** avaliar origens **rolling** (ou híbrido) com purging + embargo recalibrado
   para aumentar N (1.947/1.810/1.645 vs 425/138/65). **Quebra comparabilidade** (muda a definição de
   amostra) → exige registro no DECISOES e reexecução do baseline.
2. **P2 — Redação do 1m no painel:** substituir "exige dados subminuto" por uma afirmação correta
   (possível com 1/min, porém limitado; 1m exato exige persistência 1s). **Não quebra comparabilidade.**
3. **P2 — Transparência:** expor no painel o N rolling disponível e o motivo do stride tumbling
   (independência dos outcomes), para que o N baixo não seja lido como escassez de dados.
4. **P1 (futuro, só documentado agora):** registrar que qualquer métrica de acurácia futura deve usar
   **balanced accuracy** e comparar contra o baseline da classe majoritária (RANGE 43,8-52,6%).

**Alterações que comprometeriam a comparabilidade do experimento atual (NÃO fazer agora):**
- mudar stride tumbling → rolling (altera a definição de amostra e os N);
- mudar a definição das classes (tercis → ATR/vol-normalizado/novos thresholds);
- mudar a janela de features (15m), os horizontes (5/15/30), o split/purging/embargo;
- reclassificar/reprocessar o histórico v1/v2/v3.

**Conclusão:** o painel ANÁLISE PREDITIVA está **estatisticamente correto e íntegro**: sem amostras
inválidas, com gate de dois eixos operado corretamente (suficiência × evidência), e sem problemas de
contaminação temporal. Os únicos pontos de atenção são (a) a potência amostral limitada pelo stride
tumbling e (b) a redação imprecisa do horizonte 1m — ambos **sem comprometer a validade** do que o
painel declara hoje. Nenhuma alteração de produção foi feita. **Parado aguardando autorização.**
