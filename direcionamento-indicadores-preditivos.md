# Direcionamento Técnico — Indicadores Preditivos de Mudança Brusca de Mercado

## Contexto

O painel já possui: score de confluência técnico x fluxo, pressão de compra/venda, movimento de grandes players, open interest ("dinheiro no mercado") e funding rate ("custo de manutenção"). O objetivo agora é adicionar uma camada de **detecção de regime** e **absorção de liquidez** que alimente tanto o motor de confluência quanto um novo componente visual de alerta.

Este documento deve ser passado integralmente para a IA que implementa o código no repositório local. Ele está dividido em Backend (Parte 1) e Frontend (Parte 2), nessa ordem — o backend deve ser implementado e validado antes do frontend, pois o frontend depende dos campos gerados pelo backend.

---

## Parte 1 — Backend: Detector de Regime com Normalização Adaptativa e Histerese

### Objetivo
Classificar o mercado em `BULL_TREND`, `BEAR_TREND` ou `RANGE`, de forma resiliente a ruído, spikes de preço e variação de frequência de ingestão.

### Requisitos obrigatórios (correções sobre a versão inicial)

1. **Threshold adaptativo, não fixo.** O limiar de mudança de preço que define tendência deve escalar com a volatilidade atual da janela, não ser um valor fixo em percentual. Um mercado calmo e um mercado agitado não podem usar o mesmo corte.

2. **Volatilidade robusta a outliers.** Não usar `(max - min) / min` puro para medir o spread da janela — um único wick de 1 tick distorce a leitura. Usar desvio padrão dos retornos, ou um range por percentil (ex: p95 - p5) em vez de max/min absolutos.

3. **Histerese entre estados.** O regime não pode trocar a cada nova amostra só por cruzar o threshold uma vez. Exigir N leituras consecutivas na nova direção (ex: 3 a 5 amostras) antes de confirmar a troca de regime. Isso evita que o widget "pisque" entre estados quando o preço oscila perto da linha de corte.

4. **Janela por tempo, não por contagem de amostras.** Se a frequência de ingestão variar (reconexões, gaps de rede, throttling da exchange), uma janela de "60 amostras" deixa de representar 60 segundos reais. A janela deve ser filtrada por timestamp (`now - windowSeconds`), não por `array.length`.

5. **Payload padronizado.** O retorno deve incluir score, label, timestamp e um campo de confiança/força do sinal — não só o enum de regime — para que o frontend e o motor de confluência consumam sem precisar recalcular nada.

### Especificação para a IA implementar

Arquivo: `services/market-ingestion/src/engine/regime.ts`

Pedir à IA que implemente uma classe `RegimeDetector` com:

- Buffer de `{ price: number, timestamp: number }[]`, filtrado por janela de tempo configurável (ex: `windowSeconds = 60`), removendo entradas mais antigas que a janela a cada nova amostra.
- Cálculo de volatilidade via desvio padrão dos retornos percentuais entre amostras consecutivas dentro da janela (não max/min bruto).
- Threshold de variação líquida (`netChange`) calculado como `max(baseThreshold, volatility * fator)`, onde `baseThreshold` é um piso mínimo (ex: 0.05%) para evitar reagir a ruído em mercados extremamente parados.
- Máquina de estados com histerese: manter um contador de leituras consecutivas na direção candidata; só confirmar troca de regime após atingir `confirmationThreshold` (ex: 3). Se a direção candidata mudar antes de confirmar, resetar o contador.
- Método `evaluate(currentPrice: number, timestamp: number)` retornando:
  ```typescript
  {
    regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGE',
    volatility: number,       // desvio padrão dos retornos, em %
    confidence: number,       // 0-100, baseado em quão longe do threshold está o netChange
    candidateRegime: string,  // regime detectado mas ainda não confirmado (útil para debug)
    timestamp: number
  }
  ```
- Tratar explicitamente o caso de buffer insuficiente (menos de ~10 amostras válidas na janela): retornar `RANGE` com `confidence: 0` em vez de calcular sobre dados insuficientes.

Integrar essa classe no loop principal de ingestão, junto com o módulo de absorção de liquidez (CVD, order book imbalance — já discutidos anteriormente), e propagar `regime`, `volatility` e `confidence` dentro do `MarketSnapshot` que já alimenta o painel.

### Ordem de implementação sugerida (passar em etapas separadas para a IA)

1. Implementar `RegimeDetector` isolado, com testes unitários simulando: mercado parado, tendência clara, mercado oscilando perto do threshold (para validar a histerese), e gap de ingestão (para validar a janela por tempo).
2. Só depois integrar ao `MarketSnapshot` e ao motor de confluência.
3. Só depois conectar ao frontend (Parte 2).

---

## Parte 2 — Frontend: Componente de Alerta Estrutural

### Objetivo
Componente visual que reage a mudanças de absorção de liquidez e regime, sem replicar lógica de negócio que já deveria vir pronta do backend.

### Requisitos obrigatórios (correções sobre a versão inicial)

1. **Threshold de intensidade não deve ser hardcoded no componente.** A classificação de intensidade (ex: `LOW` / `MEDIUM` / `HIGH`, ou "relevante" vs "não relevante") deve vir pronta do backend como parte do payload. Se o critério mudar, muda em um lugar só.

2. **Debounce/cooldown visual.** Se `absorptionState` ou `regime` oscilarem rapidamente entre valores, o alerta não pode piscar ligado/desligado a cada segundo. Aplicar um debounce de 2–3 segundos antes de trocar o estado visual exibido — mesmo que o dado subjacente já tenha o suporte da histerese do backend, o frontend deve ter sua própria proteção contra flicker de renderização.

### Especificação para a IA implementar

Arquivo: `components/StructuralAlert.tsx`

Pedir à IA que implemente:

- Props recebendo o payload já classificado do backend:
  ```typescript
  interface StructuralAlertProps {
    absorptionState: 'NONE' | 'BULL_ABSORPTION' | 'BEAR_ABSORPTION';
    absorptionLevel: 'LOW' | 'MEDIUM' | 'HIGH'; // classificado no backend, não no componente
    absorptionIntensity: number; // valor bruto, só para exibição
    regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGE';
    confidence: number; // vindo do RegimeDetector
  }
  ```
- Um hook interno (`useDebouncedValue` ou equivalente) que só atualiza o estado visual exibido após o novo valor persistir por 2–3 segundos, evitando flicker.
- Estilo condicional baseado em `absorptionLevel` (não recalculando o threshold de 30% localmente) e em `regime`.
- Exibir também o `confidence` do regime de forma discreta (ex: badge pequeno), para dar transparência de quão forte é o sinal — importante para o usuário não confiar cegamente em uma leitura de baixa confiança logo após um gap de dados.

---

## Resumo do que priorizar, em ordem

1. `RegimeDetector` com normalização adaptativa, histerese e janela por tempo (com testes unitários dos cenários de ruído).
2. Integração ao `MarketSnapshot` e ao motor de confluência.
3. Backend passa a retornar `absorptionLevel` já classificado (não só o valor bruto de intensidade).
4. `StructuralAlert.tsx` no frontend, consumindo os campos já prontos, com debounce próprio.

O critério de sucesso não é só "o widget acende quando esperado" — é **não gerar falsos alertas** quando o mercado está picotado ou passando por um gap de ingestão, já que esse é justamente o cenário em que decisões erradas custam mais caro.

---

## Parte 3 — Ajustes pós-validação em produção (Etapa 2)

Após rodar a Parte 1 e 2 ao vivo, foi observado um snapshot real com o seguinte padrão:

- `regime: RANGE` (variação de preço dentro do threshold)
- Dominância de fluxo em 80.5% comprador
- Pressão de compra/venda fortemente positiva
- Movimento dos grandes players fortemente comprador

Ou seja: o **regime de preço** dizia "sem tendência" enquanto o **fluxo** já estava fortemente direcional. Isso pode ser comportamento correto (regime de preço e regime de fluxo são métricas diferentes por natureza) ou pode indicar lag do threshold do `RegimeDetector`. Os itens abaixo tratam os dois casos.

### 3.1 — Expor `confidence` e `absorptionLevel` na UI

Esses campos já estão especificados no payload do backend (Parte 1) mas ainda não aparecem no frontend. Pedir à IA:

- Adicionar um badge discreto no card "Como o mercado está" exibindo o `confidence` do regime atual (ex: `Confiança: 62%`), para o usuário calibrar quanto peso dar à leitura de RANGE/TREND naquele momento.
- Confirmar que `absorptionLevel` (`LOW/MEDIUM/HIGH`) está sendo calculado e propagado do backend; se ainda não estiver, implementar antes de expor no `StructuralAlert.tsx`.

### 3.2 — Tratar divergência entre regime de preço e regime de fluxo como sinal explícito

Em vez de tratar essa divergência como inconsistência a esconder, transformá-la em informação:

- No backend, calcular um `flowRegime` separado do `regime` de preço — usando a mesma lógica de dominância de fluxo (`pressão de compra/venda` + `movimento dos grandes`) já existente no snapshot, normalizado num range comparável (-100 a +100, ou enum `BULL_FLOW/BEAR_FLOW/NEUTRAL_FLOW`).
- Comparar `regime` (preço) com `flowRegime`. Quando houver divergência forte e sustentada (ex: `regime = RANGE` mas `flowRegime` fortemente direcional por N leituras consecutivas — reaproveitar a mesma lógica de histerese do `RegimeDetector`), emitir um novo estado: `DIVERGENCE_BULL` ou `DIVERGENCE_BEAR`.
- Esse estado é candidato natural a virar o principal insumo do indicador de "mudança brusca iminente" que motivou este documento — fluxo forte pressionando um preço ainda contido é um padrão clássico de pré-rompimento.
- No frontend, adicionar um badge tipo "⚡ Fluxo antecede preço" quando `DIVERGENCE_BULL/BEAR` estiver ativo, distinto visualmente do alerta de absorção já existente (cor/ícone diferente, para não confundir os dois sinais).

### 3.3 — Auditar a escala do score consolidado (topo do painel)

Foi observado que o score técnico x fluxo do card superior (ex: `+4 / +8`, rotulado "sem alinhamento claro") pode divergir visualmente da leitura bruta do card de fluxo abaixo (ex: 80.5% comprador, ambos os sub-indicadores fortemente positivos). Antes de mexer em mais indicadores, pedir à IA para:

- Documentar explicitamente a fórmula de normalização/suavização usada no score do topo (é EMA? é um cap arbitrário? é uma média ponderada com o técnico?).
- Confirmar se a suavização é intencional (score consolidado deve reagir mais devagar que o fluxo bruto, por design) ou se é um bug de escala entre os dois módulos.
- Caso seja intencional, documentar isso no próprio código com um comentário curto, para não ser reinterpretado como bug numa futura revisão.

### 3.4 — Reset de divergência ao sair de RANGE (implementado após validação em produção)

**Status:** logging de transições de estado já implementado e validado (`regime_change`, `flow_change`, `divergence` — console + tabela SQLite `regime_events`). Este item resolve o comportamento pendente: o campo `divergence` precisa ser resetado quando o `regime` de preço deixa de ser `RANGE`, pois a divergência só faz sentido enquanto o preço ainda não confirmou a direção que o fluxo já sinalizava.

**Lógica esperada:**

- `divergence` só pode estar em `DIVERGENCE_BULL` ou `DIVERGENCE_BEAR` enquanto `regime === 'RANGE'`.
- No momento em que `regime` transiciona de `RANGE` para `BULL_TREND` ou `BEAR_TREND` (via a própria histerese do `RegimeDetector`), resetar `divergence` para `NONE` imediatamente — independentemente do estado do `flowRegime` naquele instante.
- Esse reset conta como um evento de transição e deve gerar sua própria linha em `regime_events`, para permitir medir depois quanto tempo em média uma divergência leva até o regime confirmar (essa é a métrica-chave pra validar se o indicador tem valor preditivo real). Sugestão de `event_type`: `divergence_resolved`, com campos extras `resolved_into` (`BULL_TREND`/`BEAR_TREND`) e `duration_ms` (tempo desde o disparo original da divergência até a resolução).
- Caso o regime saia de `RANGE` na direção **oposta** à divergência ativa (ex: `DIVERGENCE_BULL` ativa mas o regime confirma `BEAR_TREND`), registrar isso como `divergence_failed` em vez de `divergence_resolved` — essa distinção é o que separa "o indicador acertou" de "o indicador errou" no backtest.

**Query de validação, uma vez implementado:**
```sql
SELECT event_type, resolved_into, duration_ms, COUNT(*) 
FROM regime_events 
WHERE event_type IN ('divergence_resolved', 'divergence_failed')
GROUP BY event_type, resolved_into;
```
Essa query dá a taxa bruta de acerto do sinal de divergência assim que houver volume de dados suficiente (recomenda-se aguardar pelo menos algumas dezenas de eventos antes de tirar qualquer conclusão).

### 3.5 — Pendente: teste de histerese sob ruído

Ainda não validado. Simular (localmente, sem depender do mercado real) uma série de preços oscilando repetidamente ao redor do threshold de troca de regime, e confirmar que:
- O contador de confirmação da histerese reseta corretamente quando a direção candidata muda antes de atingir `confirmationThreshold`.
- Nenhum falso `regime_change` é logado nesse cenário de oscilação.
- O mesmo teste deve ser replicado para o `flowRegime`, já que ele reaproveita lógica similar.

### 3.6 — Gate de confiança mínima para confirmação de divergência (bug encontrado em produção)

**Sintoma observado:** logs mostrando `[Regime] Divergence triggered: DIVERGENCE_BULL @ $77,571.35 (confidence: 0%)`, ou seja, a divergência confirmando com confiança zero do regime de preço.

**Diagnóstico:** o reset da 3.4 (clear incondicional ao sair de RANGE) foi implementado corretamente e não é a causa. O `divergenceCount` também conta as 5 confirmações corretamente pela leitura do código. O bug real é conceitual: `confidence: 0` no `RegimeDetector` é o valor retornado quando o **buffer tem amostras insuficientes** (menos de ~10 leituras na janela — ver Parte 1, item de tratamento de buffer insuficiente), e nesse caso o `regime` é setado como `RANGE` só como default, não porque o mercado esteja de fato em range. O `detectDivergence` não distingue esse "RANGE por falta de dado" de um "RANGE real" — e passou a contar confirmações de divergência durante essa janela de baixa confiança, tipicamente logo após o startup do daemon ou logo após um reconnect da Binance WS.

**Correção especificada:**

- Propagar o `confidence` do `RegimeDetector` como parâmetro de `evaluate()` / `detectDivergence()` no `FlowRegimeDetector` (hoje ele só recebe `priceRegime`, não `confidence`).
- Adicionar um gate mínimo de confiança antes de permitir que `detectDivergence` compute `isPriceRanging` como `true`:
  ```typescript
  const isPriceRanging = priceRegime === 'RANGE' && confidence >= MIN_CONFIDENCE_FOR_DIVERGENCE;
  ```
- `MIN_CONFIDENCE_FOR_DIVERGENCE` deve ser configurável (começar em ~30-40, ajustável depois com dado real de produção via a query de 3.4).
- Quando o gate bloquear (`confidence` baixo), o candidato de divergência deve ser tratado como `'NONE'` — ou seja, não conta como confirmação nem quebra a sequência de confirmação de um candidato anterior válido; simplesmente não avança o contador naquele tick. (Definir explicitamente esse comportamento para a IA, para evitar que ela reinterprete "bloqueado" como "reset do contador", o que teria efeito colateral diferente.)

### 3.7 — Rename de label (só texto, zero risco)

**Confirmado que não é bug** — são três métricas de fontes diferentes por design: `imb` (order book imbalance, liquidez passiva), `cvd` (volume agressor total via trades), `cvd_whale` (mesmo CVD, filtrado para trades >3x a média móvel de 500 trades). A divergência de sinal entre elas é um padrão real de mercado (absorção: vendedores ofertando passivamente enquanto compradores consomem agressivamente essa oferta).

**Mudança:** renomear o label "QUEM ESTÁ DOMINANDO" para "LIQUIDEZ NO BOOK" (ou "OFERTAS PASSIVAS"), só no texto exibido no frontend — nenhum cálculo muda. Confirmar com a IA que essa é uma alteração isolada de string/label, sem tocar em `imb`, `cvd`, `cvd_whale` ou qualquer lógica de regime/divergência já validada em produção.

### 3.8 — Formalizar detecção de absorção (usando dados já existentes)

Este item estava especificado desde o início do projeto (ver introdução: "volume grande sendo negociado sem movimento de preço proporcional") mas nunca foi implementado como campo próprio — só apareceu como leitura manual no card. Agora que `imb`, `cvd` e `cvd_whale` já estão rodando e validados em produção, dá pra formalizar sem precisar de nenhuma fonte de dado nova.

**Regra proposta:**
- `BULL_ABSORPTION`: `imb` fortemente negativo (vendedores ofertando) **e** `cvd`/`cvd_whale` fortemente positivo (compradores consumindo agressivamente), sustentado por N leituras consecutivas — reaproveitar a mesma lógica de histerese/`confirmationThreshold` já usada em `RegimeDetector` e `FlowRegimeDetector`.
- `BEAR_ABSORPTION`: o inverso (`imb` positivo, `cvd`/`cvd_whale` negativo).
- Retornar também uma `absorptionIntensity` (ex: baseada em quão grande é a divergência entre `imb` e `cvd` normalizados), no mesmo padrão de metadata já usado (score, label, confidence, timestamp).

**IMPORTANTE — regra de implementação para a IA (prioridade sobre o resto):**
Este é um cálculo **novo e aditivo**, que só lê `imb`, `cvd`, `cvd_whale`, `regime` e `flowRegime` já existentes — ele não deve alterar nenhuma lógica, assinatura de função, ou payload de campo que já está em produção e funcionando (`regime`, `flowRegime`, `divergence`, `confidence`, `flowStrength`, o parse do `useMarketStream.ts`, etc.). Pedir explicitamente:

> Implemente `absorptionState` e `absorptionIntensity` como um módulo/campo **novo e isolado**, sem modificar nenhuma função, arquivo ou payload já existente que já está funcionando em produção (regime, flowRegime, divergence, confidence, useMarketStream). Apenas adicione o novo campo ao objeto de snapshot já existente, sem remover ou renomear nenhum campo atual. Depois de implementar, rode `npx tsc --noEmit` e confirme 0 erros, e confirme visualmente no painel que os cards de regime/divergência/fluxo que já funcionavam continuam exibindo os mesmos valores de antes — só com o novo card de absorção a mais.

Só aplicar 3.7 e 3.8 depois de confirmar (visualmente, no painel rodando) que nada do que já está funcionando quebrou.

### Status desta etapa (atualizado — Parte 3 completa)

1. ✅ Auditoria da escala do score (3.3).
2. ✅ `flowRegime` + detecção de divergência no backend (3.2).
3. ✅ Exposição de `confidence`, badge de divergência no frontend (3.1 + 3.2).
4. ✅ Logging de transições em console + SQLite `regime_events` (3.4 prep).
5. ✅ Reset de divergência ao sair de RANGE, com `divergence_resolved`/`divergence_failed` (3.4).
6. ✅ Gate de confiança mínima para confirmação de divergência (3.6) — validado: bloqueado com `confidence=0`, ativou com `confidence=50` após 4 confirmações.
7. ✅ Teste de histerese sob ruído (3.5) — 8 cenários passaram: `RegimeDetector` (0 false changes em oscilação, 1 change correto em tendência clara), `FlowRegimeDetector` (0 false changes em oscilação, 1 change correto em fluxo sustentado), gate de divergência confirmado nos dois extremos de confidence.
8. ✅ Bug crítico corrigido: `useMarketStream.ts` não parseava payload nem chamava `setData()`. Corrigido e confirmado via painel populado.
9. ⏳ Rename de label "QUEM ESTÁ DOMINANDO" → "LIQUIDEZ NO BOOK" (3.7) — só texto, baixo risco, ainda pendente.
10. ⏳ **CORRIGIDO:** `absorptionState`/`absorptionIntensity` (3.8) — **NÃO implementado ainda**, ao contrário do que este documento registrou anteriormente. O que apareceu nos prints como "ABSORÇÃO INSTITUCIONAL / BULL TRAP" vem de um módulo diferente (`lib/cross-validation.ts`), que compara `techScore` (indicadores técnicos de candles 1H/4H) × `flowScore` × `cvdWhale` — não é a divergência `imb` (order book) × `cvd`/`cvd_whale` (fluxo agressor) que a 3.8 original especificava. `StructuralAlert.tsx` só define as props `absorptionState`/`absorptionLevel`/`absorptionIntensity`, mas nada no backend calcula ou envia esses campos, e `MarketPanel.tsx` nunca os propaga. A 3.8 real ainda precisa ser implementada do zero.

### Nota — dois módulos de alerta distintos, não confundir

- **`cross-validation.ts` (já em produção, gera o card "Bull Trap"):** compara `techScore` (candles, timeframe maior) × `flowScore` × `cvdWhale` (fluxo real-time). Detecta defasagem entre o que os indicadores técnicos tradicionais mostram e o que o fluxo agressor já está sinalizando. Label pendente de ajuste (ver 3.7-bis abaixo).
- **3.8 (ainda não implementada):** compara `imb` (order book imbalance, liquidez passiva) × `cvd`/`cvd_whale` (fluxo agressor). Detecta quando ofertas passivas estão sendo absorvidas por execuções agressivas — o padrão "book resiste, fluxo consome" descrito desde a primeira mensagem deste projeto. Continua útil e distinto do `cross-validation.ts`; não é redundante.

### 3.7-bis — Rename adicional no `cross-validation.ts` (identificado em revisão)

O label atual "ABSORÇÃO INSTITUCIONAL / BULL TRAP" (em `lib/cross-validation.ts:73-82`) empresta o termo "absorção", que remete ao padrão book×CVD da 3.8 — mas essa condição não olha `imb` em nenhum momento. Trocar apenas o texto (sem alterar a lógica `techScore > 20 && flowScore < -20 && cvdWhale < 0` nem os thresholds) para algo como **"DIVERGÊNCIA TÉCNICO × FLUXO / BULL TRAP"** (e o equivalente espelhado para o cenário Bear Trap, se existir). Fazer junto com 3.7.

### Ordem de implementação combinada (3.7 + 3.8 real + Parte 4)

1. **3.7 + 3.7-bis** (rename de labels — "QUEM ESTÁ DOMINANDO" → "LIQUIDEZ NO BOOK", e "ABSORÇÃO INSTITUCIONAL" → "DIVERGÊNCIA TÉCNICO × FLUXO" em `cross-validation.ts`). Trivial, isolado, fazer primeiro.
2. **3.8 real:** implementar `absorptionState`/`absorptionIntensity` no backend a partir de `imb` × `cvd`/`cvd_whale` (não confundir com `cross-validation.ts`), propagar até `MarketPanel.tsx` → `StructuralAlert.tsx`, reaproveitando o padrão de histerese/`confirmationThreshold` já validado em `RegimeDetector`/`FlowRegimeDetector`.
3. **Validar a 3.8 ao vivo por um tempo** antes de logar — não faz sentido logar para backtest um cálculo ainda não confirmado como correto visualmente.
4. **Parte 4** (logging de absorção para backtest) — só depois da 3.8 validada, e só com autorização explícita do usuário (ver aviso no início da Parte 4). Valores acordados como ponto de partida: **X = 0.3% de movimento de preço, Y = 30 minutos de janela**, implementados como constantes nomeadas e documentadas (não hardcoded de forma invisível), já que é provável que precisem de ajuste depois dos primeiros resultados reais — especialmente considerando a volatilidade de curto prazo observada nos logs de `regime_change` (trocas de regime a cada poucos minutos).

**Parte 3 concluída.** Próximos passos em aberto: 3.7 (rename, trivial) e Parte 4 abaixo (logging de absorção para backtest).

---

## Parte 4 — Logging de absorção para backtest (⚠️ NÃO IMPLEMENTAR SEM AUTORIZAÇÃO EXPLÍCITA DO USUÁRIO)

> **Instrução para a IA: leia esta especificação, entenda o plano, mas NÃO escreva ou modifique nenhum código desta seção até o usuário dizer explicitamente "pode implementar a Parte 4" (ou equivalente). Se o usuário pedir algo relacionado mas não disser isso claramente, pergunte antes de aplicar qualquer mudança.**

### Objetivo

Reaproveitar o padrão já validado em produção para `divergence` (Parte 3.4) e aplicar o mesmo tipo de log ao novo indicador de absorção (`absorptionState`/`absorptionIntensity`, Parte 3.8) — permitindo medir, com dado real, se os alertas do tipo "Bull Trap" / "Não Comprar" de fato antecedem o movimento de preço esperado, e com que taxa de acerto.

### Por que isso importa (contexto para quem for revisar depois)

Um card visualmente coerente ("Indicadores técnicos apontam alta, mas o fluxo agressor e as baleias estão vendendo pesadamente") não é o mesmo que um indicador com valor preditivo comprovado. Sem histórico estruturado, a avaliação de qualidade do alerta fica sujeita a viés de confirmação (lembrar dos acertos marcantes, esquecer os erros). O log resolve isso transformando cada alerta em um dado auditável.

### Especificação técnica

Seguir exatamente o mesmo padrão de `regime_events` / `divergence_resolved` / `divergence_failed` já implementado:

1. **Evento de disparo (`absorption_triggered`):** registrado no momento em que `absorptionState` transiciona de `NONE` para `BULL_ABSORPTION` ou `BEAR_ABSORPTION` (após a histerese/confirmação já existente na 3.8). Campos: `timestamp`, `price`, `absorptionState`, `absorptionIntensity`, `regime` e `flowRegime` vigentes no momento do disparo (contexto útil para análise posterior).

2. **Evento de resolução (`absorption_resolved` / `absorption_failed`):** análogo ao que já existe para divergência. **Decidido:** considerar resolvido quando o preço se move **0.3%** na direção **prevista pelo alerta** dentro de uma janela de **30 minutos**; considerar falho se o preço se mover 0.3% na direção **oposta** primeiro, ou se `absorptionState` voltar a `NONE` sem o movimento esperado ter ocorrido dentro da janela.
   - Ex: `BULL_ABSORPTION` prevê reversão pra cima apesar do fluxo vendedor — "resolvido" seria o preço subir 0.3% dentro de 30 minutos após o disparo.
   - Implementar como constantes nomeadas e documentadas (`ABSORPTION_RESOLUTION_THRESHOLD_PCT = 0.3`, `ABSORPTION_RESOLUTION_WINDOW_MINUTES = 30`), não hardcoded de forma invisível — provável necessidade de recalibração após os primeiros resultados reais, especialmente dada a volatilidade de curto prazo já observada nos logs de `regime_change`.

3. **Tabela:** pode reaproveitar `regime_events` (adicionando `absorption_triggered`/`absorption_resolved`/`absorption_failed` como novos valores de `event_type`) em vez de criar tabela nova, mantendo tudo consultável com uma query só.

4. **Query de validação, uma vez implementado e com volume de dados:**
   ```sql
   SELECT event_type, COUNT(*) 
   FROM regime_events 
   WHERE event_type IN ('absorption_resolved', 'absorption_failed')
   GROUP BY event_type;
   ```

### Regra de segurança (reforçando)

Igual à 3.8: implementação aditiva apenas. Não modificar nenhuma lógica de `regime`, `flowRegime`, `divergence`, `absorptionState`/`absorptionIntensity` já funcionando — só adicionar o logging por cima. Validar com `npx tsc --noEmit` e conferência visual do painel antes/depois.

**Lembrete final: aguardar autorização explícita do usuário antes de implementar qualquer parte desta seção.**

### Status: ✅ IMPLEMENTADA (autorizada e validada)

- Constantes nomeadas em `index.ts:19-21`: `ABSORPTION_RESOLUTION_THRESHOLD_PCT = 0.3`, `ABSORPTION_RESOLUTION_WINDOW_MINUTES = 30`.
- Novos `event_type` em `regime_events` (tabela reaproveitada, sem nova tabela): `absorption_triggered` (NONE → BEAR/BULL, após as 5 confirmações de entrada), `absorption_resolved` (saída com Δpreço ≥ 0.3%), `absorption_failed` (saída com Δpreço < 0.3% ou janela > 30min).
- `npx tsc --noEmit`: zero erros. Daemon validado rodando ao vivo, aguardando o próximo disparo real de absorção para gerar o primeiro ciclo completo triggered → resolved/failed.
- Confirmado: nenhum sistema anterior (regime, flowRegime, divergence, histerese assimétrica da 3.8) foi alterado.

### Query para acompanhar a taxa de acerto (rodar após acumular volume de eventos)

```sql
SELECT event_type, COUNT(*) 
FROM regime_events 
WHERE event_type IN ('absorption_resolved', 'absorption_failed')
GROUP BY event_type;
```

---

## Estado geral do projeto (checkpoint)

Todas as partes planejadas neste documento estão implementadas e validadas:

- **Parte 1** — `RegimeDetector` com threshold adaptativo, volatilidade robusta, histerese, janela por tempo. ✅
- **Parte 2** — `StructuralAlert.tsx` com debounce e thresholds vindos do backend. ✅
- **Parte 3** — `flowRegime`, detecção de divergência, gate de confiança mínima (3.6), teste de histerese sob ruído (3.5, 8/8 cenários), logging de transições em `regime_events`, correção do bug crítico em `useMarketStream.ts` (payload não estava sendo parseado), renames de label (3.7 e 3.7-bis). ✅
- **Parte 3.8** — `AbsorptionDetector` (`imb` × `cvdWhale`, book vs. fluxo agressor), histerese assimétrica (5 ticks para entrar, 2 para sair), validado com 5/5 testes unitários isolados e comportamento ao vivo condizente. ✅
- **Parte 4** — Logging de `absorption_triggered`/`resolved`/`failed` para backtest, com critério de resolução configurável (0.3%/30min) como constantes nomeadas. ✅

### Próximo passo natural (não implementar ainda, só observação)

Deixar o daemon rodando por um período (dias, idealmente) para acumular volume suficiente de eventos de divergência e absorção em `regime_events`, e então rodar as queries de contagem (`divergence_resolved` vs `divergence_failed`, `absorption_resolved` vs `absorption_failed`) para obter a taxa de acerto real de cada indicador. Só depois disso faz sentido considerar recalibrar thresholds (`confirmationThreshold`, `MIN_CONFIDENCE_FOR_DIVERGENCE`, `ABSORPTION_RESOLUTION_THRESHOLD_PCT`/`_WINDOW_MINUTES`) com base em dado real em vez de ajuste por intuição.

---

## Parte 4.1 — Recalibração dos parâmetros de resolução de absorção (v1 → v2, baseada em dado real)

**Contexto:** primeira leitura de dados reais da Parte 4 mostrou que os valores iniciais (`ABSORPTION_RESOLUTION_THRESHOLD_PCT = 0.3`, `ABSORPTION_RESOLUTION_WINDOW_MINUTES = 30`) foram um chute educado desproporcional à realidade observada:

- Todas as absorções registradas até então duraram **6–12 segundos** (0.0–0.2 minutos), não minutos.
- O `Δ%` máximo de preço observado durante essas absorções foi **0.0327%** — quase 10x abaixo do threshold de 0.3%.
- Resultado: **100% `absorption_failed`, zero `absorption_resolved`** — não porque o sinal não tenha valor, mas porque o critério de resolução media numa escala de tempo (30min) ~300x maior que a duração real do próprio evento (6-12s).

**Diagnóstico:** o problema não estava no `AbsorptionDetector` (3.8) nem na histerese assimétrica (5 ticks entrada / 2 ticks saída) — essas partes já estavam validadas e corretas. O problema era exclusivamente nos parâmetros de resolução da Parte 4, que nunca haviam sido calibrados com dado real (eram apenas a estimativa inicial documentada como "provável necessidade de recalibração").

**Decisão:** não mexer no `exitConfirmationThreshold` do detector (isso pertence à detecção do sinal, já validada — usá-lo para "esticar" artificialmente a vida da absorção distorceria o sinal original). Em vez disso, recalibrar apenas os parâmetros de resolução, para uma escala compatível com a duração real observada:

- `ABSORPTION_RESOLUTION_THRESHOLD_PCT`: `0.3` → **`0.05`**
- `ABSORPTION_RESOLUTION_WINDOW_MINUTES`: `30` → **`5`**

Isso ainda dá margem de tempo real para o preço reagir após o evento (não exige resolução instantânea), mas numa escala proporcional aos 6-12s observados, em vez de ~300x maior.

**Ação:** aplicar os novos valores como "v2" das constantes (manter o histórico do valor v1 documentado em comentário, para rastreabilidade), deixar rodando novamente, e reavaliar a distribuição `resolved`/`failed` com os novos parâmetros.

### Lição para o processo (documentar como precedente)

Este é o primeiro ciclo completo do propósito original da Parte 4: os primeiros valores foram estimativa, dado real revelou desproporção, parâmetros foram recalibrados. O mesmo processo deve ser repetido para outros parâmetros ainda não validados com volume real (ex: `confirmationThreshold` de regime/flow, `MIN_CONFIDENCE_FOR_DIVERGENCE`) conforme mais dado for acumulado — nenhum threshold deste projeto deve ser considerado "final" até ser confrontado com a distribuição real de eventos em `regime_events`.

## Parte 4.2 — Separação de `absorption_interrupted` como event_type próprio

**Contexto:** com o v2 calibrado (0.05%/5min), `absorption_resolved` passou a aparecer de fato (2 ocorrências na primeira validação, resolvendo em 0.2-0.6min). Mas surgiu um caso não previsto na especificação original: quando um novo `absorption_triggered` acontece **antes** da janela de resolução do evento anterior terminar, a implementação (adicionada pela IA como "pending window pós-trigger") corta a resolução pendente e a marca como falha.

**Problema identificado:** inicialmente esses casos cortados eram logados como `absorption_failed` comum, com a distinção apenas em uma string livre no campo `extra` (`reason:interrupted` vs `reason:window_expired`). Isso exigiria parsing de string nas queries de backtest — frágil e propenso a erro, além de **distorcer a taxa de acerto**: um evento "cortado por sobreposição" não é o mesmo tipo de falha que "não teve movimento suficiente", e misturar os dois no mesmo `event_type` infla artificialmente a contagem de falhas reais do sinal.

**Correção aplicada:** separado em `event_type` próprio — `absorption_interrupted` — sem mudança de schema (reaproveita a mesma tabela `regime_events`). Agora existem 4 `event_type` para absorção:
- `absorption_triggered`
- `absorption_resolved`
- `absorption_failed` (não teve movimento suficiente dentro da janela)
- `absorption_interrupted` (cortado por sobreposição de um novo trigger antes da janela terminar)

**Query de taxa de acerto corrigida** (`interrupted` fica de fora do cálculo, pois não representa falha do sinal em si):
```sql
SELECT event_type, COUNT(*) 
FROM regime_events 
WHERE event_type LIKE 'absorption_%'
GROUP BY event_type;
```
Taxa de acerto real = `resolved / (resolved + failed)`, excluindo `triggered` e `interrupted` do denominador.

**Validado:** `npx tsc --noEmit` sem erros, daemon reiniciado e rodando (PID 20372), `[Daemon] Ready.` confirmado.
