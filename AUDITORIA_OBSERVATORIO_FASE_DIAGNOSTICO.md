# AUDITORIA TÉCNICA — OBSERVATÓRIO
## Fase de Diagnóstico antes de qualquer correção

**Data:** 26/08/2026  
**Status:** DIAGNÓSTICO OBRIGATÓRIO — NÃO IMPLEMENTAR CORREÇÕES AINDA

---

## 1. OBJETIVO

Auditar a implementação atual do painel **OBSERVATÓRIO** e verificar, diretamente no código-fonte, nos dados persistidos e nos fluxos de ingestão, se os problemas apontados na análise do painel são realmente existentes.

Esta fase NÃO é uma fase de implementação.

A IA deverá:

1. localizar a origem de cada métrica;
2. rastrear o dado desde a fonte até o painel;
3. verificar a lógica matemática;
4. confrontar a lógica com os dados reais;
5. identificar a causa raiz;
6. quantificar o impacto;
7. propor uma correção;
8. NÃO aplicar a correção antes da aprovação.

---

# 2. REGRA PRINCIPAL

> **NÃO ALTERAR CÓDIGO, BANCO, SCHEMA, CONFIGURAÇÃO OU COMPORTAMENTO DO PAINEL DURANTE ESTA FASE.**

Não implementar soluções apenas porque parecem teoricamente corretas.

As hipóteses abaixo são pontos de investigação. Cada uma deve ser classificada com evidência objetiva.

Classificação obrigatória:

- `CONFIRMADO`
- `PARCIALMENTE CONFIRMADO`
- `NÃO CONFIRMADO`
- `FALSO POSITIVO`
- `INCONCLUSIVO`

---

# 3. CONTEXTO OBSERVADO

O painel apresentou aproximadamente:

- BTC: `$78.654,95`
- CVD Δ 15m: `+$13,07M`
- CVD WHALE Δ 15m: `+$9,66M`
- OI: `105.393`
- ΔOI: `-0,001%`
- BOOK IMBALANCE: `-93,5%`
- REGIME: `RANGE`
- FLOW: `BEAR_FLOW`
- ABSORÇÃO: `NONE`
- DIVERGÊNCIA: `DIVERGENCE_BEAR`
- Whale buys: `32.907`
- Whale sells: `36.025`
- Compras: `$984,3M`
- Vendas: `$1.011,4M`
- Histórico: `35,6h efetivas`
- Snapshots: `2.134`
- Whale events: `110.079`
- Churn: `4.319 transições`
- Churn horário: `452,0/h`
- DB: `21 gaps / 22 segmentos`

Também foi observada uma sequência temporal contendo vários eventos no mesmo segundo.

---

# 4. P0 — INTEGRIDADE DOS DADOS

## 4.1 Fragmentação dos Whale Events

### Hipótese

A sequência temporal pode estar mostrando **fills individuais do WebSocket** em vez de agressões/takers agregados.

Isso poderia inflar artificialmente a contagem de `WHALE EVENTS`.

### Investigar

Localizar:

- parser do WebSocket;
- estrutura recebida da exchange;
- identificadores disponíveis no trade;
- identificação de `trade_id`;
- identificação de `order_id`, caso exista;
- timestamp;
- side/aggressor;
- preço;
- quantidade;
- lógica que classifica um trade como `WHALE`;
- função responsável por `saveEvent`;
- função que alimenta a sequência temporal;
- função que calcula os totais da sessão.

### IMPORTANTE

Não assumir que `trade_id` representa uma ordem taker.

Verificar a semântica real do identificador fornecido pela exchange.

Determinar se múltiplos fills pertencem:

- ao mesmo trade;
- à mesma ordem;
- à mesma execução;
- ou simplesmente a operações independentes ocorridas no mesmo instante.

### Teste obrigatório

Selecionar uma amostra dos eventos que aparecem no mesmo segundo e reconstruir sua origem.

Comparar:

```text
eventos brutos
↓
trades
↓
fills
↓
whale events
↓
eventos persistidos
↓
eventos exibidos
```

### Resultado esperado

Determinar se a contagem está realmente inflada.

---

# 5. P0 — OPEN INTEREST

## 5.1 ΔOI aparentemente congelado

O painel mostra:

```text
OI = 105.393
ΔOI = -0,001%
```

### Hipótese

Pode existir:

- erro na coleta;
- campo incorreto;
- cálculo incorreto;
- comparação entre timestamps errados;
- unidade errada;
- divisão por denominador incorreto;
- arredondamento excessivo;
- atualização com baixa frequência;
- valor stale;
- ou simplesmente uma variação realmente pequena.

### Investigar

Localizar:

- endpoint de OI;
- parser;
- normalização;
- armazenamento;
- cálculo de ΔOI;
- janela temporal;
- formatação do painel.

### Teste

Extrair uma sequência real de valores:

```text
timestamp | OI | OI anterior | delta absoluto | delta %
```

Verificar se o valor muda ao longo de:

- 1 minuto;
- 5 minutos;
- 15 minutos;
- 1 hora.

### Regra

Não concluir que existe erro apenas porque `-0,001%` parece pequeno.

Provar através dos dados.

---

# 6. P0 — PERSISTÊNCIA / SQLITE

## 6.1 Gaps

O painel apresenta:

```text
DB: 21 gaps / 22 segmentos
```

### Hipótese

A persistência pode estar sofrendo interrupções relevantes.

### Investigar

Localizar:

- worker de persistência;
- scheduler;
- intervalo de snapshots;
- transações SQLite;
- WAL;
- retry;
- timeout;
- tratamento de exceções;
- escrita concorrente;
- fechamento/reabertura da conexão;
- possíveis reinicializações do processo.

### Teste

Reconstruir a sequência temporal dos snapshots.

Produzir:

```text
segmento
início
fim
quantidade de snapshots
intervalo esperado
maior gap
duração do gap
causa conhecida
```

### IMPORTANTE

Diferenciar:

1. gap real de coleta;
2. gap de persistência;
3. gap causado por reinício;
4. gap causado por ausência legítima de dados;
5. gap causado pelo cálculo incorreto da métrica.

### Resultado

Determinar se o histórico é realmente inadequado para backtesting.

---

# 7. P0 — CVD

## 7.1 CVD Δ 15m

O painel apresenta valores como:

```text
CVD Δ 15m = +$13,07M
```

### Hipótese

O CVD pode estar:

- correto;
- subestimado;
- usando janela incorreta;
- filtrando trades;
- usando apenas eventos whale;
- perdendo trades;
- resetando incorretamente;
- ou calculando o delta sobre uma série incompleta.

### Investigar

Localizar:

- origem dos trades;
- classificação buy/sell;
- cálculo do CVD;
- janela de 15 minutos;
- mecanismo de rolling window;
- reset;
- tratamento de gaps;
- relação entre CVD geral e CVD whale.

### Teste independente

Calcular manualmente, a partir dos dados brutos disponíveis:

```text
CVD = Σ(volume agressor comprador)
    - Σ(volume agressor vendedor)
```

para a mesma janela temporal.

Comparar:

```text
CVD calculado pelo motor
vs
CVD reconstruído dos dados
```

### Resultado

Quantificar o erro, se houver.

---

# 8. P1 — MOTOR DE ESTADOS / CHURN

## 8.1 Número excessivo de transições

Observado:

```text
4.319 transições
452/h
```

### Hipótese

O motor está reagindo a microvariações sem histerese ou dwell time.

### IMPORTANTE

Não assumir que toda transição é necessariamente errada.

Primeiro identificar:

- quais estados estão sendo contabilizados;
- se a métrica soma todos os componentes;
- se uma atualização interna conta como transição;
- se mudanças temporárias são registradas;
- se REGIME, FLOW, ABSORÇÃO e DIVERGÊNCIA possuem contadores separados.

### Investigar

Localizar:

- state machine;
- regras de classificação;
- threshold;
- debounce;
- hysteresis;
- minimum dwell time;
- persistência do estado;
- contador de transições.

### Teste

Construir sequência:

```text
timestamp | estado anterior | estado novo | motivo | score
```

Identificar:

- transições reais;
- oscilações;
- transições consecutivas;
- duração média;
- mediana;
- percentis;
- número de estados com duração < 5s;
- < 10s;
- < 30s;
- < 60s.

### Resultado

Somente depois disso propor hysteresis/dwell time.

---

# 9. P1 — SEMÂNTICA DO FLOW

## 9.1 Possível conflito entre FLOW e outras métricas

Exemplo observado:

```text
FLOW = BEAR_FLOW
DIVERGENCE = DIVERGENCE_BEAR
BOOK = fortemente negativo
CVD = positivo
```

### Hipótese

A classificação de FLOW pode não representar adequadamente a combinação das métricas.

### Não assumir

`DIVERGENCE_BEAR` não significa automaticamente `BEAR_FLOW`.

São conceitos diferentes e devem ser analisados separadamente.

### Investigar

Encontrar a árvore/regra responsável por:

```text
FLOW
```

Identificar:

- inputs;
- thresholds;
- pesos;
- precedência;
- condições mutuamente exclusivas;
- tratamento de divergência;
- tratamento de book imbalance;
- tratamento de CVD;
- tratamento de preço.

### Pergunta central

O estado atual é semanticamente coerente com os inputs que o motor recebeu?

### Resultado

Determinar se:

- a regra está correta;
- a regra é incompleta;
- existe conflito semântico;
- ou a interpretação visual do painel está equivocada.

---

# 10. P2 — APRESENTAÇÃO E FORMATAÇÃO

Auditar:

- precisão de OI;
- precisão de ΔOI;
- arredondamento de CVD;
- timestamps;
- unidade dos volumes;
- valores `$0,0M`;
- conversão de BTC → USD;
- labels;
- atualização do tempo "há X";
- contadores da sessão.

### Especial atenção

Eventos exibidos como:

```text
WHALE COMPRA $0.0M
```

podem estar sendo arredondados de maneira que informações relevantes desapareçam.

Determinar se o problema é:

- dado real muito pequeno;
- unidade incorreta;
- cálculo incorreto;
- ou apenas formatação.

---

# 11. AUDITORIA DO PIPELINE COMPLETO

Mapear o fluxo real:

```text
BINANCE
   ↓
WEBSOCKET
   ↓
PARSER
   ↓
NORMALIZAÇÃO
   ↓
AGREGAÇÃO
   ↓
MÉTRICAS
   ├── CVD
   ├── CVD WHALE
   ├── OI
   ├── BOOK IMBALANCE
   ├── WHALE EVENTS
   └── PRICE
   ↓
STATE ENGINE
   ├── REGIME
   ├── FLOW
   ├── ABSORPTION
   └── DIVERGENCE
   ↓
PERSISTÊNCIA
   ↓
WEBSOCKET SERVER
   ↓
PAINEL
```

Para cada etapa, documentar:

```text
input
transformação
output
frequência
timestamp
unidade
persistência
tratamento de erro
```

---

# 12. MATRIZ DE DIAGNÓSTICO

Preencher obrigatoriamente:

| ID | Problema | Status | Arquivo | Função | Evidência | Causa raiz | Impacto |
|---|---|---|---|---|---|---|---|
| P0-01 | Whale Events | **CONFIRMADO (parcial)** | exchanges/binance/websocket.ts, parser.ts, flow/classification.ts, storage/sqlite.ts | handleEvent, parseAggTrade, classifyTrade, saveEvent | stream `@trade` (execuções individuais); 115.036 eventos/54.026 ms; máx 47 no mesmo ms; ticket médio 0,33 BTC; threshold relativo 3× média | stream não-agregado + threshold relativo | contagem em nível de execução; rótulo "whale" superestimado; sem id p/ dedupe |
| P0-02 | OI | **NÃO CONFIRMADO** | derivatives/oi.ts, exchanges/binance/rest.ts | pollOi, fetchOpenInterest | Δ/min real (-0,0029% a +0,0188%); Δ 5/15/60min = -0,0175/+0,0086/+0,0506%; daemon == API ao vivo (105.372); markPrice real | — (valor pequeno é real) | apenas falta rótulo de unidade no painel (P2) |
| P0-03 | DB gaps | **CONFIRMADO (gaps reais)** / NÃO CONFIRMADO (erro de persistência) | index.ts, storage/sqlite.ts | persistSnapshot, getDbStats | 22 segmentos; 21 gaps > 3min = daemon offline; intra-segmento 60–120s (máx 165s) | disponibilidade do daemon local | histórico útil ≈ 36h; experimento já lida via integridade de janela |
| P0-04 | CVD | **NÃO CONFIRMADO** | flow/cvd.ts, app/MarketObservatory.tsx | processTradeForCvd, cvdBuf delta | deltas 15m reais -35,7M a +18,3M; observado +13,07M ≈ snapshot 11:25 (+12,87M) | — | nenhum (Δ15m protegido por guarda de reset) |
| P1-01 | Churn | **CONFIRMADO (churn real do motor)** | engine/flow-regime.ts, engine/regime.ts, engine/absorption.ts, app/MarketObservatory.tsx | confirmation thresholds, contador de transições | DB ~440/h (408–449 nas últimas 5h) ≈ painel 452/h | desenho sem minimum dwell (só confirmação 3–5 ticks) | oscilação legítima; não é bug do contador |
| P1-02 | FLOW | **FALSO POSITIVO** | engine/flow-regime.ts | computeDominance, classifyFlow | instante observado: cvd_large ≈ -128M → dominance ≈ -96,75 → BEAR_FLOW correto; DIVERGENCE_BEAR e ABS NONE corretos | confusão Δ15m (painel) vs nível da sessão (motor) | nenhum |
| P2-01 | Formatação | **CONFIRMADO (exibição)** | app/MarketObservatory.tsx | (magnitude/1e6).toFixed(1) | p50 do ticket = $16k → maioria mostra "$0.0M" | formatação com 1 casa decimal em M | perda visual de informação; dado íntegro no banco |

---

# 13. PLANO DE CORREÇÃO — SOMENTE APÓS DIAGNÓSTICO

Para cada problema confirmado, apresentar:

```text
PROBLEMA:
CAUSA RAIZ:
CORREÇÃO:
ARQUIVOS ENVOLVIDOS:
ALTERAÇÕES NECESSÁRIAS:
RISCO:
IMPACTO NO HISTÓRICO:
IMPACTO NO REAL-TIME:
NECESSITA MIGRAÇÃO DE DB:
NECESSITA BACKFILL:
NECESSITA NOVOS TESTES:
```

Não implementar nesta fase.

---

# 14. TESTES OBRIGATÓRIOS FUTUROS

Depois da aprovação do plano, as correções deverão incluir testes para:

### WebSocket

- múltiplos fills;
- trades simultâneos;
- timestamps iguais;
- eventos whale;
- duplicação;
- perda de eventos.

### CVD

- janela de 15m;
- rolling window;
- buy/sell;
- gaps;
- reinicialização.

### OI

- atualização;
- delta absoluto;
- delta percentual;
- baixa variação;
- dados stale.

### Estados

- oscilação rápida;
- thresholds;
- hysteresis;
- minimum dwell;
- recuperação após mudança real.

### Persistência

- queda do worker;
- reconexão;
- SQLite ocupado;
- retry;
- transação interrompida;
- continuidade temporal.

---

# 15. CRITÉRIO DE SAÍDA DA FASE

A fase de diagnóstico estará concluída somente quando a IA entregar:

1. código/arquivo responsável por cada métrica;
2. fluxo completo do dado;
3. evidência quantitativa;
4. causa raiz;
5. classificação do problema;
6. impacto;
7. proposta de correção;
8. riscos;
9. testes necessários.

### NÃO fazer

- Não alterar código.
- Não alterar schema.
- Não adicionar hysteresis.
- Não alterar thresholds.
- Não modificar o cálculo de CVD.
- Não modificar o agregador de whale.
- Não mudar o painel.
- Não apagar dados.
- Não fazer migration.
- Não fazer "quick fix".

---

# 16. ORDEM DE EXECUÇÃO

A IA deverá trabalhar nesta ordem:

```text
1. INSPECIONAR REPOSITÓRIO
        ↓
2. MAPEAR PIPELINE
        ↓
3. LOCALIZAR IMPLEMENTAÇÃO DE CADA MÉTRICA
        ↓
4. INSPECIONAR SQLITE / DADOS REAIS
        ↓
5. RECONSTRUIR MÉTRICAS INDEPENDENTEMENTE
        ↓
6. COMPARAR MOTOR × DADOS
        ↓
7. CLASSIFICAR OS 6 PROBLEMAS
        ↓
8. IDENTIFICAR CAUSA RAIZ
        ↓
9. PROPOR CORREÇÕES
        ↓
10. PARAR E AGUARDAR APROVAÇÃO
```

---

# 17. COMANDO FINAL PARA A IA

> Execute agora somente a **FASE DE AUDITORIA**.
>
> Não corrija nada ainda.
>
> Não presuma que as análises externas estão corretas.
>
> Use o código e os dados reais como fonte de verdade.
>
> Para cada hipótese, encontre a origem do valor, reconstrua o cálculo quando possível e apresente evidência objetiva.
>
> Ao terminar, entregue o relatório completo de diagnóstico e aguarde autorização para implementar as correções.

---

# 18. DIAGNÓSTICO EXECUTADO — 26/08/2026 (~12:00Z)

> Fonte de verdade: código-fonte + SQLite + endpoints ao vivo. Nenhuma correção aplicada.
> Scripts congelados e daemon: **intocados** (git diff vazio).

## 18.1 Método

Para cada hipótese: localizada a origem no código → rastreado o dado da fonte até o painel →
reconstruída a métrica a partir do SQLite / endpoint ao vivo → comparado motor × dados →
classificado com evidência objetiva.

## 18.2 P0-01 — Whale Events → CONFIRMADO (parcial)

**Pipeline:** Binance WS `btcusdt@trade` (websocket.ts, `CONFIG.streams.trade`) → `handleEvent` (case `'trade'`) →
`parseAggTrade` (parser.ts: lê `p`, `q`, `T`, `m`) → `handleTrade` → `classifyTrade` (classification.ts) →
`pushTradeEvent` → `saveEvent` (sqlite.ts).

**Semântica do stream:** `@trade` (não `@aggTrade`) emite **execuções individuais** (fills). Cada mensagem =
1 execução. `@aggTrade` seria o agregado por ordem taker (janela ~100 ms). **O parser descarta os ids
(`a`/`t`)** — impossível reagrupar por ordem a posteriori e sem dedupe.

**Evidência (SQLite, 115.036 eventos):**
- 54.026 ms distintos → ~2,1 eventos por ms ocupado; p50 = 2/s, p90 = 10/s, p99 = 40/s, máx = 331/s;
- **47 eventos no mesmo milissegundo** (10:26:31.986) — múltiplos fills simultâneos;
- ticket médio 0,33 BTC (~$26k); mediana $16,4k → threshold relativo (`> 3× média dos últimos 500`,
  janela com vazamento) captura fluxo de varejo, não "baleia" absoluta (já registrado como P1 na fila).

**Causa raiz:** escolha do stream `@trade` (execuções) + threshold relativo.

**Impacto:** contagem em nível de execução (não ordem/agregação) e rótulo "whale" superestimado; afeta
whale events e CVD WHALE.

**Proposta (NÃO implementada):** usar `@aggTrade`; persistir id (`a`/`t`) para dedupe; recalibrar o
threshold (P1 da fila). Distinguir histórico v1 vs v2.

## 18.3 P0-02 — OI → NÃO CONFIRMADO (não está congelado; pipeline fiel à API)

**Pipeline:** `pollOi` a cada 5s (oi.ts) → `fetchOpenInterest` (rest.ts, `/fapi/v1/openInterest`) →
`oiChange = (atual − anterior)/anterior` entre polls consecutivos.

**Evidência (snapshots + endpoint ao vivo):**
- sequência real de OI: 105.137–108.949; Δ/min real entre -0,0029% e +0,0188%;
- ΔOI 5/15/60 min: **-0,0175% / +0,0086% / +0,0506%** — varia e não está congelado;
- endpoint ao vivo agora: **105.372,474** com **markPrice 78.523,20** (dado real de mainnet) —
  snapshot 11:55 = 105.382 → **daemon == API**;
- observado no painel: OI 105.393 e ΔOI -0,001% → bate com o snapshot 11:25 (105.393,003);
  o ΔOI pequeno é a variação real de 5s.

**Escala:** 105k com markPrice $78.523 → **~105k BTC ≈ $8,3B** (unidade base, não contratos de 0,001 —
senão seria 105 BTC, 3 ordens abaixo do plausível). Pipeline correto; **falta rótulo de unidade no painel**.

## 18.4 P0-03 — DB gaps → CONFIRMADO (gaps reais) / NÃO CONFIRMADO (erro de persistência)

**Evidência (reconstrução dos 22 segmentos):**
- 21 gaps > 3 min = **daemon offline** (ex.: 08-24T03:54→11:31; 08-25T02:27→18:55 [988 min]) —
  máquina local parada, não falha de escrita;
- intra-segmento: cadência **60–120s** (máx gap 165s) — jitter de timer/event loop; WAL ok;
- histórico útil ≈ 36h em segmentos; o experimento Fase 1 já lida via integridade de janela
  (janela curta 127, segmento quebrado 193 no H=30m, etc.).

**Causa raiz:** disponibilidade do daemon (coleta local), não persistência.

## 18.5 P0-04 — CVD → NÃO CONFIRMADO (valores consistentes com os dados)

**Pipeline:** `processTradeForCvd` (cvd.ts): CVD = Σ(agressor compra) − Σ(agressor venda) por execução;
`side` correto (`isBuyerMaker ? SELL : BUY`); reseta no disconnect (`resetCvd`). Painel: Δ15m client-side
sobre o buffer do stream, com guarda de reset (>50% de queda → null).

**Evidência:** deltas de 15m reconstruídos dos snapshots na última hora: **-35,7M a +18,3M**;
observado no painel +13,07M / +9,66M ≈ snapshot 11:25 (+12,87M / +9,50M). **Consistente.**
Nota: níveis de CVD são por sessão (resetam) — o Δ15m do painel está protegido pela guarda.

## 18.6 P1-01 — Churn → CONFIRMADO (churn real do motor)

**Evidência:** DB `regime_events` ≈ **440/h** nas últimas 5h (408–449) vs painel 452/h na sessão → **batem**.
Motores usam confirmação (3–5 ticks) mas **sem minimum dwell** (flow/absorption oscilam de forma legítima).
**Não é bug do contador** — é desenho. Proposta (futura, modelo congelado): hysteresis/dwell, somente
após aprovação e registro no DECISOES.

## 18.7 P1-02 — FLOW → FALSO POSITIVO (combinação observada é consistente)

**Regra:** `dominance = clamp(imb)*50 + clamp(whaleCvd/500k)*50`; BEAR_FLOW se < −60 (confirmação 5s).
**No instante observado** (OI 105.393 ≈ 11:25; cvd_large nível ≈ **−128M**):
- dominance ≈ (−0,935×50) + (−1×50) = **−96,75** → **BEAR_FLOW correto**;
- absorção: imb < −0,15 ✓ mas cvd_large < +100k → **NONE correto**;
- divergência: RANGE + confiança ≥ 35 + BEAR_FLOW → **DIVERGENCE_BEAR correto**.

O "conflito" (CVD Δ15m positivo + BEAR_FLOW) é **métrica diferente**: o painel mostra o DELTA de 15m;
o motor usa o NÍVEL da sessão (negativo). Sem conflito semântico.

## 18.8 P2-01 — Formatação → CONFIRMADO (apenas exibição)

- `$0.0M`: `(magnitude/1e6).toFixed(1)` → eventos < $50k mostram $0.0M (p50 = $16k → maioria). Dado
  íntegro no banco; é formatação.
- OI sem unidade (base BTC); ΔOI 3 casas; timestamps HH:MM:SS; "há X" atualiza a cada 1s — verificados.

## 18.9 Plano de correção — PROPOSTAS (aguardando aprovação; NADA implementado)

**P0-01:** stream `@aggTrade` + persistir id (`a`/`t`) + recalibrar threshold (P1 da fila).
- Arquivos: websocket.ts (stream), parser.ts (campos), types, sqlite.ts (coluna id opcional).
- Risco: muda a semântica do dataset whale → distinguir histórico v1 vs v2; impacta CVD WHALE (mesma fonte).
- Migração/backfill: não; novos eventos apenas. Testes: dedupe, agregados, timestamps iguais.

**P0-03:** sem correção de código (disponibilidade do daemon). Opcional futuro: alerta de gap de coleta.

**P1-01:** hysteresis/minimum dwell — **bloqueado pelo congelamento** (altera estados que alimentam o
experimento). Só após gate da Fase 1 ou aprovação explícita com registro no DECISOES.

**P2-01:** exibir magnitude com 2 casas (ex.: $0,02M) ou em k; rotular unidade do OI. Mudança de painel
(somente com aprovação).

## 18.10 Critério de saída da fase de diagnóstico

1. origem de cada métrica: localizada (matriz acima); 2. fluxo do dado: documentado; 3. evidência
quantitativa: reconstruída; 4. causa raiz: identificada; 5. classificação: matriz preenchida;
6. impacto: quantificado; 7. proposta de correção: apresentada; 8. riscos: descritos; 9. testes:
relacionados; 10. **nada foi alterado** (git diff vazio nos congelados; único arquivo modificado: este
documento). **Aguardando autorização para implementar as correções.**

---

# 19. IMPLEMENTAÇÃO AUTORIZADA — RELATÓRIO (26/08 ~12:20Z)

Autorização do arquiteto: `AUTORIZAÇÃO DE IMPLEMENTAÇÃO — OBSERVATÓRIO` (P0-01 → testar → P2-01 → testar → rebuild → validação → relatório → parar). OI, CVD, DB gaps e FLOW **não foram tocados** (cálculos validados). Churn/hysteresis/dwell → **segunda fase** (não implementado, preserva comparabilidade).

## 19.1 P0-01 — Whale Events (implementado)

**Investigação de `@aggTrade` (verificado ao vivo em 26/08):**
- `fstream.binance.com` (`btcusdt@aggTrade`): **0 mensagens** em 8s/15s — o futures **NÃO possui** stream `@aggTrade`;
- spot `stream.binance.com` (`btcusdt@aggTrade`): 88 msgs/8s — funciona no spot;
- futures `@trade`: 143 msgs/8s — execuções individuais com id `t` (formato `{e:'trade', t, p, q, X, m, st}`).

**Correção aplicada (futures não tem aggTrade → agregação client-side):**
1. **Stream**: mantido `@trade` (execuções com id `t`).
2. **IDs preservados**: `NormalizedTrade.id` = `t` (futures) ou `a` (spot, robustez); persistido em `events.trade_id` (schema v3) + índice único parcial (`idx_events_trade_id`, dedupe de replay).
3. **Agregação**: `flow/aggregator.ts` — agrupa execuções da mesma direção agressora em janela de ~100ms (semântica do `@aggTrade` do spot); VWAP, quantidade somada, `executions`/`firstId` preservados nos details.
4. **Threshold absoluto**: `CONFIG.flow.whaleNotionalUsd = 100_000` (calibrado nos dados da auditoria: ticket médio antigo 0,33 BTC ≈ $26k era varejo; $100k ≈ 1,27 BTC). `whalePercentile: 90` (morto) removido; média móvel vazada removida.

**Testes (52/52 passando):** `events-persistence` (22 — schema v3, trade_id, migração idempotente), `whale-classification` (14 — threshold + parser `t`/`a`), `trade-aggregator` (16 — janela, lado, VWAP, reset).

**Validação ao vivo (daemon tsx watch recarregado):**
- trades fluindo (CVD -7,1M → -3,5M em 45s);
- whale events: **$100k–$2,35M**, média $346k; ex.: 81 execuções → $350k, 36 execuções → $773k (ordens picadas agora agregadas);
- taxa ~15-20/min (antes ~144/min de varejo);
- `trade_id` populado; schema v3 + índice único no lugar; **histórico antigo (116k eventos) intocado, sem reprocessamento** (trade_id NULL permanece).

**Impacto conhecido:** a partir de agora, whale events e CVD WHALE refletem trades agregados ≥ $100k (semântica v2). O dataset whale da Fase 1 (seção separada) passa a acumular com a nova regra — distinguir v1 (histórico) de v2 (novo).

## 19.2 P2-01 — Exibição (implementado, somente apresentação)

- **Fim do "$0.0M"**: formatação adaptativa `fmtUsd` ($K / $M / $): `$35.2K`, `$1.24M`, `$820` — aplicada à sequência temporal do OBSERVATÓRIO.
- **Unidade do OI**: rótulos `OPEN INTEREST (BTC)` (MarketPanel) e `OI (BTC) / ΔOI` (Observatório). Nenhum dado alterado.

## 19.3 Rebuild e validação

- Serviço: `tsc --noEmit` + `tsc` (build) + 52 testes OK.
- App: `tsc --noEmit` OK. Build completo do Next fica com o CI no push (sandbox local bloqueia o passo "Running TypeScript" do `next build`).
- Daemon: reload ao vivo verificado (trades, agregados, ids).

## 19.4 Não mexido (conforme decisão do arquiteto)

OI (cálculo validado), CVD (validado), gaps (coleta real), FLOW (lógica validada), scripts congelados da Fase 1 (`fase1-experimento-minimo.mjs`, `fase1-amostra-diagnostico.mjs`), Absorption (não promovido), churn/hysteresis (segunda fase).
