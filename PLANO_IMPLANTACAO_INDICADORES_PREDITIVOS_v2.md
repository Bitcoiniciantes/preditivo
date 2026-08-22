# PLANO DE IMPLANTAÇÃO — CAMADA DE ESTRUTURA DE MERCADO E SINAIS PREDITIVOS

## 0. Objetivo

Transformar o painel atual em uma plataforma de **análise de estrutura de mercado**, preservando os indicadores existentes e adicionando:

- Open Interest (OI);
- Funding Rate;
- fluxo agressor;
- CVD;
- CVD por faixas de tamanho;
- Order Book;
- detecção de spoofing/persistência de liquidez;
- mapa de liquidez;
- liquidações;
- divergências;
- confluência entre 15m, 1H e 4H;
- histórico de alta frequência;
- backtest e validação estatística.

### Regra fundamental

O sistema não deve chamar um sinal de "preditivo" apenas porque combina vários indicadores.

Primeiro deve coletar dados, construir features, testar hipóteses e medir desempenho fora da amostra.

---

# 1. Decisão arquitetural principal

## NÃO processar o fluxo bruto no navegador

Binance e Bybit podem produzir grande quantidade de eventos de:

- trades;
- aggTrades;
- Order Book L2;
- liquidações;
- atualizações de profundidade.

O navegador não deve manter conexões independentes com todas as fontes nem processar o fluxo bruto continuamente.

### Arquitetura obrigatória

```text
                 BINANCE
                    │
             WebSocket bruto
                    │
                    ▼
          ┌──────────────────┐
          │                  │
          │ INGESTOR BACKEND │
          │                  │
          └────────┬─────────┘
                   │
                 BYBIT
                   │
            WebSocket bruto
                   │
                   ▼
          ┌──────────────────┐
          │                  │
          │ INGESTOR BACKEND │
          │                  │
          └────────┬─────────┘
                   │
                   ▼
          NORMALIZAÇÃO
                   │
                   ▼
       SINCRONIZAÇÃO TEMPORAL
                   │
                   ▼
       CÁLCULO DE FEATURES
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
       CVD         OI       ORDER BOOK
        │          │          │
        └──────────┼──────────┘
                   ▼
        MOTOR DE ESTRUTURA
                   │
                   ▼
        TIME-SERIES DATABASE
                   │
                   ▼
          AGREGADOR / CACHE
                   │
                   ▼
        WEBSOCKET INTERNO
                   │
            2–4 atualizações/s
                   │
                   ▼
              FRONTEND
```

O frontend recebe **estado agregado**, não o fluxo bruto.

---

# 2. Camada de ingestão

Criar um serviço backend dedicado:

```text
services/
  market-ingestion/
    binance/
    bybit/
    normalizer/
    synchronizer/
    orderbook/
    trades/
    liquidations/
```

Responsabilidades:

1. abrir WebSockets das exchanges;
2. manter conexões persistentes;
3. detectar desconexões;
4. reconectar;
5. validar sequência de eventos;
6. normalizar timestamps;
7. normalizar símbolos;
8. alimentar o Order Book local;
9. gerar eventos derivados;
10. enviar dados para o pipeline de processamento.

---

# 3. Não enviar eventos brutos para o frontend

### Errado

```text
Binance
   ↓
WebSocket
   ↓
Browser
   ↓
milhares de eventos/s
```

### Correto

```text
Binance ─┐
         ├─> Backend
Bybit ───┘
            ↓
       processamento
            ↓
       agregação
            ↓
       snapshot
            ↓
       WebSocket
            ↓
        Browser
```

O navegador recebe, por exemplo:

```json
{
  "timestamp": 1750000000000,
  "price": 117500,
  "oi": 1234567890,
  "funding": 0.00007,
  "cvd": 41800000,
  "orderBookImbalance": 0.17,
  "liquidations": {
    "long": 4200000,
    "short": 8100000
  }
}
```

e não milhares de mensagens L2 individuais.

---

# 4. Throttling do frontend

O backend deve calcular continuamente, mas o frontend não precisa receber cada atualização.

Inicialmente:

```text
2–4 snapshots por segundo
```

para o painel.

Configuração sugerida:

```text
MARKET_UPDATE_RATE = 250ms
```

ou:

```text
4 Hz
```

Para elementos menos sensíveis:

```text
OI:       1–2 Hz
Funding:  0,1–1 Hz
CVD:      2–4 Hz
Book:     4 Hz
Score:    1–2 Hz
```

Esses valores são iniciais e devem ser ajustados por profiling.

---

# 5. Dois níveis de dados

Separar claramente:

## Hot path

Dados necessários para operação em tempo real:

```text
Preço
CVD
Delta
Order Book resumido
OI
liquidações recentes
score
```

Mantidos em:

- memória;
- Redis ou cache equivalente;
- estruturas eficientes no backend.

## Cold path

Dados históricos:

```text
trades
snapshots
CVD
Order Book agregado
liquidações
OI
funding
features
scores
```

Armazenados em banco time-series.

---

# 6. Banco de dados

## Não utilizar IndexedDB como banco histórico principal

IndexedDB pode continuar sendo utilizado para:

- preferências;
- cache pequeno;
- último estado;
- dados temporários.

Não utilizar como armazenamento principal de:

- L2 de alta frequência;
- trades;
- snapshots contínuos;
- histórico completo de CVD;
- histórico de Order Book.

---

# 7. Banco time-series

Preferência inicial:

### TimescaleDB

Boa opção quando o projeto já utiliza PostgreSQL.

Estrutura conceitual:

```text
market_trades
orderbook_snapshots
orderbook_features
open_interest
funding
liquidations
cvd
market_features
signals
```

### Alternativa

ClickHouse quando o volume de dados justificar uma arquitetura OLAP orientada a grandes quantidades de eventos.

Não adicionar ClickHouse apenas por complexidade arquitetural.

Escolher:

```text
PostgreSQL + TimescaleDB
```

como primeira opção, caso o projeto não tenha outra infraestrutura.

---

# 8. Retenção de dados

Não guardar tudo na mesma granularidade indefinidamente.

Exemplo:

```text
RAW TRADES
    ↓
retenção curta

L2 EVENTOS
    ↓
retenção curta

SNAPSHOTS 250ms
    ↓
retenção limitada

1s / 5s
    ↓
retenção média

1m
    ↓
retenção longa
```

Criar políticas de retenção e agregação.

O objetivo é preservar informação analítica sem produzir crescimento ilimitado do banco.

---

# 9. Order Book local

O backend deve manter uma representação local do livro.

Fluxo:

```text
snapshot inicial
      ↓
updates incrementais
      ↓
validação de sequência
      ↓
Order Book local
```

Se houver perda de sequência:

```text
detectar gap
    ↓
descartar estado
    ↓
solicitar novo snapshot
    ↓
reconstruir
```

Nunca calcular imbalance a partir de um livro potencialmente desatualizado sem marcar o estado como inválido/stale.

---

# 10. Profundidade do Order Book

Não limitar o modelo estrutural a ±1%.

Criar múltiplas camadas:

```text
SCALPING
±0,25%
±0,50%
±1%

INTRADAY
±2%
±3%
±5%

ESTRUTURAL
±10%
```

O sistema deve analisar a profundidade de acordo com o timeframe.

### 15m

Maior peso:

```text
±0,25%
±0,50%
±1%
```

### 1H

Considerar:

```text
±0,5%
±1%
±2%
±3%
```

### 4H

Considerar:

```text
±1%
±2%
±3%
±5%
±10%
```

Não assumir que liquidez distante influencia diretamente a execução imediata.

---

# 11. Liquidez por distância

Criar features:

```text
bidLiquidity_025
bidLiquidity_050
bidLiquidity_100
bidLiquidity_200
bidLiquidity_300
bidLiquidity_500
bidLiquidity_1000

askLiquidity_025
askLiquidity_050
askLiquidity_100
askLiquidity_200
askLiquidity_300
askLiquidity_500
askLiquidity_1000
```

Além disso:

```text
nearestBidWall
nearestAskWall
distanceToBidWall
distanceToAskWall
```

---

# 12. Não confiar no Order Book instantâneo

O Order Book deve ser tratado como estado potencialmente manipulável.

Não utilizar:

```text
imbalance instantâneo
```

como sinal suficiente.

Criar métricas de persistência.

Exemplo:

```text
wall_detected
wall_age
wall_survival_ratio
wall_cancel_rate
wall_replenishment
wall_consumption
```

---

# 13. Detecção de spoofing / liquidez não persistente

Uma parede de ordens não deve ser considerada liquidez confiável apenas porque apareceu.

Criar conceito de:

```text
PERSISTENT LIQUIDITY
```

Uma ordem/cluster recebe maior relevância quando:

1. permanece no livro por determinado período;
2. sobrevive a atualizações;
3. é parcialmente executada;
4. é reposta;
5. não desaparece repetidamente antes do preço chegar;
6. apresenta histórico de persistência.

---

# 14. Cancelamento relativo

Criar:

```text
cancelRate =
cancelledVolume /
(totalAddedVolume)
```

Também calcular por faixa de preço.

Exemplo:

```text
Ask wall: $25M

Adicionado:  $40M
Cancelado:   $30M
Executado:   $10M

Cancel rate: 75%
```

Uma parede com cancelamento muito elevado deve receber menor confiança.

Não classificar automaticamente como spoofing.

Usar:

```text
POSSÍVEL LIQUIDEZ NÃO PERSISTENTE
```

---

# 15. Imbalance temporal

Além do imbalance instantâneo:

```text
instantImbalance
```

calcular:

```text
imbalance_1s
imbalance_5s
imbalance_15s
imbalance_1m
```

Isso reduz a sensibilidade a oscilações instantâneas.

---

# 16. CVD e sincronização multi-exchange

Não somar Binance e Bybit cegamente.

Cada evento deve preservar:

```text
exchange
eventTime
receiveTime
symbol
tradeId
price
quantity
side
```

Separar:

```text
eventTime
```

de:

```text
receiveTime
```

Isso permite medir latência.

---

# 17. Janela temporal de sincronização

Criar um agregador temporal.

Exemplo:

```text
janela = 100ms
```

Eventos próximos temporalmente são agrupados.

Mas a janela deve ser configurável:

```text
50ms
100ms
250ms
500ms
1s
```

Não presumir que uma única janela funciona para todos os regimes de mercado.

---

# 18. Não tentar deduplicar trades de exchanges

Uma ordem executada na Binance e outra na Bybit são eventos diferentes.

Não tentar eliminar os dois simplesmente porque possuem:

```text
mesmo preço
mesmo tamanho
timestamp próximo
```

Isso poderia destruir informação real.

O problema é:

```text
AGREGAÇÃO
```

e não necessariamente:

```text
DUPLICAÇÃO
```

Manter CVD por exchange e depois construir métricas agregadas.

---

# 19. CVD multi-exchange

Criar:

```text
CVD_BINANCE
CVD_BYBIT
CVD_AGGREGATED
```

E também:

```text
CVD_SPREAD =
CVD_BINANCE - CVD_BYBIT
```

Isso permite detectar divergências entre venues.

Exemplo:

```text
Binance CVD ↑↑
Bybit CVD ↑
```

ou:

```text
Binance CVD ↑↑
Bybit CVD ↓
```

O segundo caso deve gerar:

```text
DIVERGÊNCIA ENTRE EXCHANGES
```

e não um CVD agregado simplificado.

---

# 20. Fluxo agressor

O sistema deve manter:

```text
buyVolume
sellVolume
delta
CVD
```

por exchange e agregado.

Separar:

```text
small
medium
large
```

mas os thresholds devem ser configuráveis.

Preferencialmente utilizar:

- valor em USD;
- percentis históricos;
- z-score;
- distribuição dinâmica.

Evitar thresholds absolutos fixos como única classificação.

---

# 21. Normalização estatística

Para comparar regimes diferentes, criar features normalizadas.

Exemplo:

```text
zScore(value, rollingWindow)
```

Aplicar a:

```text
OI change
CVD delta
liquidation volume
order book imbalance
trade size
funding
```

Isso evita que um valor absoluto seja interpretado da mesma forma em mercados com volumes completamente diferentes.

---

# 22. Liquidações

Não usar apenas:

```text
longLiquidations
shortLiquidations
```

Criar:

```text
liquidationVolume
liquidationCount
liquidationVelocity
liquidationAcceleration
longShortRatio
zScoreLiquidations
```

Exemplo:

```text
Liquidações 1m
Volume: $18M
Média: $2M
Z-score: 4,2
```

Isso é mais informativo do que apenas:

```text
$18M
```

---

# 23. Eventos extremos

Criar um detector de eventos.

Exemplos:

```text
OI spike
CVD spike
liquidation spike
funding extreme
order book withdrawal
order book replenishment
```

Cada evento deve ter:

```text
timestamp
magnitude
direction
source
confidence
```

---

# 24. Substituir score linear fixo

Não utilizar inicialmente:

```text
CVD 25%
OI 20%
Order Book 20%
...
```

como decisão final.

Esses pesos podem existir apenas como:

```text
baseline
```

para comparação.

O motor principal deve ser baseado em **features condicionais e regime de mercado**.

---

# 25. Regime de mercado

Criar classificação:

```text
TRENDING
RANGING
HIGH VOLATILITY
LOW VOLATILITY
LIQUIDATION EVENT
BREAKOUT
ABSORPTION
```

O mesmo indicador pode ter significados diferentes dependendo do regime.

Exemplo:

```text
OI ↑ + preço ↑
```

pode representar:

- tendência saudável;
- entrada excessiva de longs;
- breakout;
- squeeze.

O contexto precisa determinar a interpretação.

---

# 26. Motor de regras

Primeira versão:

```text
features
   ↓
regime
   ↓
rules
   ↓
signals
```

Exemplo:

```text
SE:

CVD z-score > 2
OI z-score > 1
preço acima da estrutura
order book persistente comprador

ENTÃO:

pressão compradora forte
```

Mas:

```text
SE:

CVD positivo
OI positivo
funding extremo
liquidações de longs crescendo

ENTÃO:

pressão compradora com risco de exaustão
```

---

# 27. Score contextual

O score deve depender do regime.

Estrutura:

```text
Score =
f(
  regime,
  OI,
  CVD,
  funding,
  orderBook,
  liquidations,
  priceStructure
)
```

Não:

```text
Score =
0.20*OI +
0.25*CVD +
...
```

como modelo definitivo.

---

# 28. Score de qualidade do sinal

Separar:

```text
DIRECTION SCORE
```

de:

```text
SIGNAL QUALITY
```

Exemplo:

```text
Direção: +72
Qualidade: 81
```

Qualidade considera:

- quantidade de fatores concordantes;
- qualidade dos dados;
- ausência de stale data;
- persistência;
- estabilidade;
- divergências;
- regime.

---

# 29. Dados inválidos

Se uma fonte estiver atrasada:

```text
stale = true
```

O sistema deve reduzir ou eliminar sua contribuição.

Exemplo:

```text
Binance LIVE
Bybit STALE
```

Não tratar os dois como equivalentes.

---

# 30. Frontend

O frontend deve receber apenas estado agregado.

Exemplo de payload:

```json
{
  "timestamp": 1750000000000,
  "symbol": "BTCUSDT",
  "price": 117500,

  "15m": {
    "oiChange": 0.021,
    "cvd": 41800000,
    "bookImbalance": 0.17,
    "score": 68
  },

  "1h": {
    "oiChange": 0.031,
    "cvd": 72100000,
    "bookImbalance": 0.11,
    "score": 74
  },

  "4h": {
    "oiChange": 0.044,
    "cvd": 121000000,
    "bookImbalance": 0.08,
    "score": 81
  },

  "events": [],
  "dataQuality": {
    "binance": "live",
    "bybit": "live"
  }
}
```

---

# 31. Frontend não deve calcular

Evitar no React/Next.js:

```text
CVD de milhões de trades
Order Book completo
agregação L2
normalização de exchanges
detecção de spoofing
backtest
```

O frontend apenas:

```text
recebe
↓
renderiza
↓
interage
```

---

# 32. Backend deve calcular

O backend será responsável por:

```text
WebSockets externos
normalização
Order Book
CVD
OI
Funding
liquidações
features
regime
divergências
score
persistência
```

---

# 33. Cache

Utilizar cache em memória/Redis para:

```text
latestPrice
latestOI
latestFunding
latestCVD
latestBookFeatures
latestLiquidations
latestSignal
```

O frontend não deve consultar o banco a cada atualização.

---

# 34. WebSocket interno

Criar um único canal:

```text
wss://SEU_BACKEND/market
```

O frontend recebe:

```text
snapshot
snapshot
snapshot
snapshot
```

aproximadamente 2–4 vezes por segundo.

Para histórico, usar REST:

```text
GET /market/history
GET /market/cvd
GET /market/oi
GET /market/liquidations
```

---

# 35. Separar realtime de histórico

Arquitetura:

```text
WebSocket
    ↓
tempo real

REST/API
    ↓
histórico

Database
    ↓
persistência

Cache
    ↓
estado atual
```

---

# 36. Performance do frontend

Implementar:

- atualização somente de componentes necessários;
- memoização;
- buffers circulares;
- downsampling;
- limite de pontos nos gráficos;
- virtualização quando necessário;
- evitar re-render global;
- evitar armazenar milhares de eventos no React state.

Não colocar cada trade no estado do React.

---

# 37. Gráficos

O frontend deve receber séries já agregadas.

Exemplo:

```text
CVD 1s
CVD 5s
CVD 1m
```

e não:

```text
500.000 trades
```

Para visualização:

```text
raw → agregação → downsample → gráfico
```

---

# 38. Timeframes

## 15M

Priorizar:

```text
microstructure
CVD
order book próximo
liquidações
OI curto
```

## 1H

Priorizar:

```text
CVD
OI
funding
liquidez intermediária
estrutura
```

## 4H

Priorizar:

```text
estrutura
OI
funding
CVD agregado
liquidez ±5% / ±10%
```

Não usar o mesmo conjunto de features com pesos idênticos nos três timeframes.

---

# 39. Validação estatística

Antes de chamar qualquer configuração de preditiva:

1. coletar histórico;
2. definir evento;
3. definir horizonte;
4. medir retorno;
5. medir hit rate;
6. medir drawdown;
7. medir expectativa;
8. separar treino e teste;
9. testar fora da amostra;
10. evitar look-ahead bias.

---

# 40. Backtest

Exemplo:

```text
SINAL
↓
entrada hipotética
↓
+15m
+30m
+1H
+4H
```

Medir:

```text
mean return
median return
hit rate
max adverse excursion
max favorable excursion
drawdown
profit factor
```

Não avaliar somente taxa de acerto.

---

# 41. Evitar data leakage

Nenhuma feature pode utilizar informação posterior ao timestamp do sinal.

Especial atenção para:

- candles fechados;
- liquidações agregadas;
- CVD;
- Order Book;
- normalização;
- cálculo de thresholds;
- z-score.

O pipeline de backtest deve reproduzir a informação que estaria disponível naquele instante.

---

# 42. Teste por regime

O desempenho deve ser separado:

```text
bull market
bear market
range
high volatility
low volatility
liquidation events
```

Um sinal que funciona apenas em um regime não deve ser tratado como universal.

---

# 43. Alertas

Alertas devem ser derivados de eventos/contexto, não apenas score.

Exemplos:

```text
OI SPIKE
CVD DIVERGENCE
LIQUIDATION EVENT
LIQUIDITY WITHDRAWAL
PERSISTENT BUY WALL
PERSISTENT SELL WALL
MULTI-EXCHANGE CVD DIVERGENCE
```

---

# 44. Estados de confiabilidade

Todo snapshot deve possuir:

```text
LIVE
STALE
DEGRADED
INVALID
```

Exemplo:

```text
BINANCE: LIVE
BYBIT: STALE
ORDER BOOK: LIVE
CVD: DEGRADED
```

O score deve refletir a qualidade dos dados.

---

# 45. Segurança

Dados públicos não devem exigir chaves privadas.

Nunca colocar no frontend:

```text
API_SECRET
PRIVATE_KEY
EXCHANGE_SECRET
```

Se futuramente houver execução de ordens, criar serviço completamente separado.

---

# 46. Observabilidade

Implementar métricas:

```text
websocket_latency
message_rate
processing_latency
database_write_latency
frontend_update_rate
stale_data_rate
dropped_messages
orderbook_resync_count
```

Criar logs para:

- desconexão;
- reconexão;
- gap de sequência;
- dados inválidos;
- latência excessiva;
- falha de persistência.

---

# 47. Limites de segurança operacional

O sistema deve detectar:

```text
message_rate anormal
CPU alta
memória alta
latência alta
database backlog
```

Se necessário:

```text
reduzir frequência de snapshots
reduzir profundidade analítica
priorizar features críticas
```

O sistema deve degradar graciosamente.

---

# 48. Ordem de implementação revisada

## Fase 0 — Auditoria

- [ ] analisar projeto existente;
- [ ] identificar framework;
- [ ] identificar backend;
- [ ] identificar banco;
- [ ] identificar componentes;
- [ ] identificar APIs atuais;
- [ ] identificar fluxo de estado;
- [ ] identificar deployment.

## Fase 1 — Backend de ingestão

- [ ] Binance WebSocket;
- [ ] Bybit WebSocket;
- [ ] reconexão;
- [ ] sequência;
- [ ] timestamps;
- [ ] normalização.

## Fase 2 — Order Book

- [ ] snapshot;
- [ ] incremental updates;
- [ ] resync;
- [ ] book local;
- [ ] múltiplas profundidades;
- [ ] persistência de liquidez.

## Fase 3 — Fluxo

- [ ] trades;
- [ ] delta;
- [ ] CVD;
- [ ] CVD por exchange;
- [ ] CVD agregado;
- [ ] CVD spread;
- [ ] sincronização temporal.

## Fase 4 — Derivativos

- [ ] OI;
- [ ] Funding;
- [ ] liquidações;
- [ ] normalização;
- [ ] z-score.

## Fase 5 — Features

- [ ] imbalance temporal;
- [ ] liquidity distance;
- [ ] wall persistence;
- [ ] cancel rate;
- [ ] replenishment;
- [ ] liquidation velocity;
- [ ] liquidation acceleration.

## Fase 6 — Regime

- [ ] tendência;
- [ ] range;
- [ ] volatilidade;
- [ ] breakout;
- [ ] liquidation event;
- [ ] absorption.

## Fase 7 — Confluência

- [ ] regras contextuais;
- [ ] divergências;
- [ ] signal quality;
- [ ] direction score;
- [ ] 15m;
- [ ] 1H;
- [ ] 4H.

## Fase 8 — Banco

- [ ] TimescaleDB ou banco existente adequado;
- [ ] hypertables;
- [ ] índices;
- [ ] retenção;
- [ ] agregações;
- [ ] compressão;
- [ ] backups.

## Fase 9 — Frontend

- [ ] WebSocket interno;
- [ ] snapshots 2–4 Hz;
- [ ] gráficos agregados;
- [ ] memoização;
- [ ] buffers;
- [ ] tratamento de stale data;
- [ ] mobile.

## Fase 10 — Backtest

- [ ] dataset histórico;
- [ ] definição de eventos;
- [ ] horizontes;
- [ ] métricas;
- [ ] treino/teste;
- [ ] out-of-sample;
- [ ] análise por regime.

---

# 49. Critério de conclusão

A primeira versão não estará pronta apenas porque os indicadores aparecem na tela.

Deve existir:

```text
✓ ingestão backend
✓ Binance
✓ Bybit
✓ normalização
✓ sincronização temporal
✓ Order Book local
✓ resync
✓ CVD
✓ OI
✓ Funding
✓ liquidações
✓ features de liquidez
✓ persistência
✓ banco time-series
✓ cache
✓ WebSocket interno
✓ frontend desacoplado
✓ throttling
✓ detector de divergências
✓ regime
✓ confluência
✓ histórico
✓ backtest
✓ métricas de performance
```

---

# 50. Princípio arquitetural final

A arquitetura correta é:

```text
EXCHANGES
   │
   ▼
INGESTION BACKEND
   │
   ▼
NORMALIZATION
   │
   ▼
TEMPORAL SYNCHRONIZATION
   │
   ├──────────────┐
   ▼              ▼
ORDER BOOK       TRADES
   │              │
   ▼              ▼
LIQUIDITY        CVD
   │              │
   └──────┬───────┘
          ▼
      DERIVATIVES
          │
          ▼
        FEATURES
          │
          ▼
       REGIME
          │
          ▼
      CONFLUENCE
          │
     ┌────┴────┐
     ▼         ▼
DATABASE      CACHE
               │
               ▼
       INTERNAL WEBSOCKET
               │
               ▼
           FRONTEND
```

## Regra de ouro

**O navegador renderiza. O backend processa. O banco histórico armazena. O cache serve o estado atual.**

O frontend nunca deve ser responsável por processar o fluxo bruto de alta frequência.

---

# 51. Próximo passo recomendado para a IA

Antes de implementar qualquer código, executar uma auditoria somente leitura do projeto.

A IA deve retornar:

1. estrutura de diretórios;
2. framework;
3. versão;
4. backend existente;
5. banco existente;
6. APIs existentes;
7. componentes do painel;
8. onde o preço é calculado;
9. onde o fluxo agressor é calculado;
10. sistema de estado;
11. sistema de cache;
12. estratégia de deployment;
13. limitações atuais;
14. quais partes podem ser reutilizadas.

Depois da auditoria, apresentar um **plano de alteração arquivo por arquivo**.

Somente após aprovação iniciar a implementação.

Não reescrever o projeto inteiro.
Não substituir a arquitetura existente sem justificativa.
Não criar serviços redundantes.
Não adicionar infraestrutura paga quando uma solução gratuita existente for suficiente.

# 52. Resultado esperado

O resultado final deverá ser uma arquitetura capaz de processar dados de mercado de alta frequência no backend e apresentar ao usuário apenas informações relevantes e agregadas.

Exemplo:

```text
BTCUSDT

PREÇO
117.500

ESTRUTURA

15M  68/100  COMPRADOR
1H   74/100  COMPRADOR
4H   81/100  COMPRADOR

OI
↑ 2,4%

CVD
↑ +41,7M

FUNDING
+0,007%

ORDER BOOK
+17%

LIQUIDAÇÕES
Long  $4,2M
Short $8,1M

LIQUIDITY
Resistência próxima: +0,6%
Suporte próximo: -0,5%

EVENTOS
• CVD positivo
• OI crescente
• Short liquidations ↑
• Liquidez de venda persistente

QUALIDADE DOS DADOS
Binance  LIVE
Bybit    LIVE
Book     LIVE
CVD      LIVE
```

A plataforma deve apresentar **estrutura, contexto, divergências e qualidade dos dados**, e não uma promessa de previsão.

