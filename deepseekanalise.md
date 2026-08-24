# Análise comparativa — Reporte de vulnerabilidades × código real

**Data:** 24/08/2026
**Escopo:** `preditivo` (termometro)
**Método:** cada alegação do reporte foi confrontada com o código atual do repositório. Os arquivos citados no reporte (`alerts_2.ts`, `bitcoin-buy_2.ts`, `analysis_2.ts`) **não existem** neste diretório; os equivalentes reais são `lib/alerts.ts`, `lib/bitcoin-buy.ts`, `lib/analysis.ts`, e as linhas citadas não batem com o código atual. Todas as localizações abaixo foram remapeadas para o código vigente.

Legenda: ✅ confirmado · ⚠️ parcialmente procedente / disputável · ❌ refutado no código atual

> **⚠️ DECISÃO DE ARQUITETURA (registrada em 24/08/2026):** o daemon `market-ingestion` roda **em localhost, deliberadamente, para não pagar hospedagem em Cloud** (Fly.io/Cloud Run — risco de faturamento excessivo). Consequência assumida: os widgets de fluxo de mercado (`MarketPanel`) e de confluência (`ConfluenceCard`) **só exibem dados reais quando o daemon local está ativo**; no site público (GitHub Pages/Cloudflare) eles ficam offline/sem fluxo — **comportamento esperado, não bug**. Toda avaliação de "produção" nas seções abaixo deve ser lida como "daemon local do mantenedor", salvo indicação contrária. Não sugerir migração para Cloud como correção; quando um achado tocar esse tema, o ajuste deve ser de **UI/UX (explicitar indisponibilidade)**, não de infraestrutura paga.

---

## 1. `package.json`

| # | Alegação | Veredito | Localização real |
|---|---|---|---|
| 1.1 | `build` e `build:pages` são cópias idênticas | ✅ | `scripts.build` e `scripts.build:pages` (ambos `next build`) |
| 1.2 | `test` lista arquivos nominalmente; novo teste exige edição manual | ✅ | `scripts.test` — 7 arquivos `.test.mjs` hardcoded |

**Observações:**
- 1.1 é cosmético: existem dois hosts (GitHub Pages usa `build:pages` em `.github/workflows/deploy-pages.yml:32`; Cloudflare usa `build`), mas como o conteúdo é idêntico, um único script com `basePath` via env bastaria. Risco baixo.
- 1.2 é risco real de CI: esquecer de registrar um teste novo = teste nunca roda. Corrigir com glob (`node --test tests/*.test.mjs`) ou convenção de diretório.

---

## 2. `lib/alerts.ts` (reporte: `alerts_2.ts`)

| # | Alegação | Veredito | Localização real |
|---|---|---|---|
| 2.1 | `rsiOpportunity`: regras genéricas por `period` sem filtro de `asset` | ✅ | linhas 52–57 (`period === "15M"`, `"4H"`, `"1H"`, `"1D"`, `"1S"`) — sem verificação de ativo |
| 2.2 | `capitulationConfirmed`: `confirmationClose < sourceClose` aponta continuação, não exaustão | ⚠️ | linha 69 |
| 2.3 | `subscriberCommand`: `parts[1]` pode ser `undefined` → quebra em runtime / modo estrito | ❌ | linha 121 (`const argument = parts[1];`) e 132 (`.includes(argument)`) |
| 2.4 | `shouldDeliverAlert`: `OPORTUNIDADE` ignora preferência `FORTES`; falta `: boolean` | ⚠️ | linhas 101–107 (sem anotação de retorno) |
| 2.5 | Tipagem solta: `asset: string`, `period: string` em vez de unions | ✅ | linha 43 |

**Análise:**
- **2.1 confirmado, com ressalva de intenção.** As regras genéricas (`COMPRA_RETESTE_15M`, `COMPRA_4H`, `VENDA_1H/4H/1D/1S`) aplicam-se a qualquer ativo que tenha aquele período. O monitor (`scripts/monitor-telegram-alerts.mjs:39–41`) varre todos os 12 ativos × períodos, então MSTR/SPCX/PRATA/URÂNIO etc. podem disparar regras desenhadas para BTC. Se a intenção era só BTC, é falso-positivo real; se é genérico, a nomenclatura (`COMPRA_BRENT_1H`, `COMPRA_LINK_1H` vs. genéricas) sugere mistura de intenções. Decisão de produto pendente.
- **2.2 disputável.** O código é internamente coerente: a mensagem emitida diz "Sequência: queda extrema no 15 min + nova queda no 5 min… A pressão vendedora continuou após a queda inicial. Isto não confirma fundo" (`monitor-telegram-alerts.mjs:565–569`). Ou seja, "confirmação de capitulação" aqui significa *continuação do pânico*, e a recuperação é tratada à parte por `sellingPressureStabilized`. A crítica procede apenas como questão de **nomenclatura** (capitulação usualmente implica clímax/exaustão), não como bug lógico.
- **2.3 refutado no código atual.** `Array.includes(undefined)` retorna `false` — não há quebra em runtime. Em TypeScript, sem `noUncheckedIndexedAccess` (não está em `tsconfig.json`), `parts[1]` é tipado como `string`, então também não há erro de compilação em modo estrito. É no máximo um nit de robustez, não uma falha.
- **2.4 refutado como bug, confirmado como anotação.** A entrega de `OPORTUNIDADE` para assinantes `FORTES` é **comportamento documentado**: a mensagem de boas-vindas diz "/fortes — Compra Forte + oportunidades RSI + capitulação" (`monitor-telegram-alerts.mjs:228`) e `preferenceLabel("FORTES")` = "Compra Forte + oportunidades de RSI + possível capitulação" (linha 214). O filtro de `CAPITULACAO` (linha 103) barra oportunidades antes da linha 104. O único achado real é a **falta da anotação `: boolean`** no retorno (linha 101) — menor.
- **2.5 confirmado, menor.** O restante do arquivo usa unions (`AlertPreference`, `AlertKind`), então trocar `string` por unions em `rsiOpportunity` é barato e alinha o contrato.

---

## 3. `lib/bitcoin-buy.ts` (reporte: `bitcoin-buy_2.ts`)

| # | Alegação | Veredito | Localização real |
|---|---|---|---|
| 3.1 | Limites estáticos (57k/54k/52k/50k) obsoletos | ✅ | linhas 1–6 |
| 3.2 | `rank` duplica a hierarquia do objeto | ✅ | linhas 19–25 (vs. cadeia de `if` em 12–15) |
| 3.3 | `bitcoinBuyLevelTransition` unidirecional → "trava em pânico contínuo" | ⚠️ | linha 31; falta tipagem no retorno (linha 27) |

**Análise:**
- **3.1 confirmado e é o achado mais relevante deste módulo.** Em 2026, com BTC muito acima de 57k, os quatro patamares são **código morto**: nenhum alerta `BTC_COMPRA` dispara e o módulo está dormente na prática. Antes de refatorar `rank`/transição, é preciso uma decisão de produto: recalibrar para níveis relativos (ex.: % abaixo de MM50/ATR) ou remover o subsistema.
- **3.2 confirmado** — adicionar um nível exige editar o objeto, a cadeia de `if` de `bitcoinBuyLevel` e `rank` (três lugares).
- **3.3 parcial.** A transição só emite no agravamento (rank maior), e de fato não há alerta de recuperação. Porém o estado **não trava**: o monitor grava `bitcoinBuyLevel: currentBitcoinBuyLevel` a cada leitura (`monitor-telegram-alerts.mjs:872`), independentemente da transição. O que se perde é apenas o aviso de "saiu do pânico" — comportamento provavelmente intencional (evitar spam), mas que deveria ser explícito. Falta de tipagem no retorno: confirmado.

---

## 4. `lib/analysis.ts` (reporte: `analysis_2.ts`)

| # | Alegação | Veredito | Localização real |
|---|---|---|---|
| 4.1 | ATR: `wilderAdx` usa suavização de Wilder; `atrAbsolute` usa SMA | ✅ | `wilderAdx` linhas 78–111; `atrAbsolute` linha 282 (`avg(trueRanges(...).slice(-14))`) |
| 4.2 | `findDivergence` defasado (pivôs passados, RSI atual não comparado) | ⚠️ | linhas 113–139 |
| 4.3 | Volume: `.slice(-21, -1)` após `completedCandles` desloca a média em 1 candle | ❌ | linha 275 (sobre `candles` já completados, linha 265) |
| 4.4 | Magic numbers `0.9` e `0.35` na compressão | ✅ | linha 309 (e `0.9` na linha 323) |
| 4.5 | `completedCandles`: expressão sem parênteses | ⚠️ | linha 37 |

**Análise:**
- **4.1 confirmado — é a correção matemática mais importante.** `atrAbsolute` é média simples dos últimos 14 true ranges (SMA), enquanto o ADX usa suavização de Wilder. Como `atrDistance`, `trendDistance` e o score de `risk` (linhas 282–286, 311) usam `atrAbsolute`, há duas metodologias de ATR convivendo no mesmo arquivo. Padronizar em Wilder (derivar o ATR do mesmo `smoothedTr` já calculado no ADX) unifica as escalas e não muda a API.
- **4.2 parcial.** O lag é real (o último pivô precisa de 2 vizinhos futuros confirmados, então fica ~2 candles atrás) — mas é **intencional e documentado na própria UI**: "A divergência usa somente pivôs já confirmados e funciona como alerta, não como entrada" (linha 230). A crítica de "inútil para reação tática" é de produto: se o objetivo for sinal tático, seria preciso uma leitura em tempo real (RSI atual vs. RSI do último pivô) mantendo o modo confirmado como secundário.
- **4.3 refutado no código atual.** `candles` já é o array *completado* (linha 265). `slice(-21, -1)` sobre ele = os 20 candles anteriores ao último, e `volRatio` compara o último candle encerrado contra essa média (linha 276) — exatamente o que o texto da UI promete: "Volume do último candle encerrado comparado à média dos 20 anteriores" (linha 340). Não há remoção dupla nem atraso estrutural. O padrão se repete corretamente em `monitor-telegram-alerts.mjs:472–476`.
- **4.4 confirmado, menor** — extrair `COMPRESSION_THRESHOLD`/`COMPRESSION_RANGE` (ou parametrizar `analyze`) habilita testes de calibração.
- **4.5 parcial.** Precedência em JS é bem definida (`&&` liga antes de `||`), então não há erro de avaliação; é legibilidade/lint (`no-mixed-operators`). Adicionar parênteses é higiene, não correção.

---

## 5. `.github/workflows/telegram-alerts.yml`

| # | Alegação | Veredito | Localização real |
|---|---|---|---|
| 5.1 | Cron de 5 min no GitHub Actions não tem precisão tática | ✅ | linha 6 (`"2,7,12,..."`) |
| 5.2 | `actions/cache` usado como banco de estado → perda aleatória de estado | ✅ | restore linhas 23–29; save linhas 38–43 |
| 5.3 | Sem `npm ci` → `MODULE_NOT_FOUND` se o script usar pacotes externos | ⚠️ | entre linha 22 e 32 (sem instalação) |
| 5.4 | `FIREBASE_SERVICE_ACCOUNT_JSON` multilinha direto no env → falhas de parsing | ⚠️ | linha 35 |

**Análise:**
- **5.1 confirmado**, e já reconhecido no `README.md` ("Limites conhecidos": agendados do GH podem ser desativados após 60 dias sem atividade). Para alertas táticos de 5 min, a plataforma certa é um serviço sempre-ligado (Fly.io — que o projeto já usa para `market-ingestion` — ou Worker cron). Enquanto estiver no GH, é best-effort.
- **5.2 confirmado.** `.alert-state` vive em cache do GH (chave por `run_id` + `restore-keys`). Cache é expurgável (LRU/7 dias) e não é armazenamento durável: perda de estado → alertas repetidos para assinantes. O código **já tem** `saveFirebaseHistory` (`lib/firebase-history.ts`) gravando leituras/eventos no Firebase; o passo natural é persistir também `subscribers/readings/capitulationWatch` no RTDB e usar o cache apenas como otimização. O README (linha 70) confirma que isso é plano conhecido ("só será gravado após configurar o segredo").
- **5.3 parcial.** Hoje **não** há `MODULE_NOT_FOUND`: o monitor importa só `lib/*.ts` e builtins (`node:fs`, `node:crypto`) — sem pacotes externos — e o Node 22.x atual executa TS direto (type stripping). O risco real é outro: (a) o script roda `.ts` sem build, dependendo da versão do runner suportar type stripping (default a partir de ~22.18, mas `engines` no `package.json` diz `>=22.13.0` — inconsistente); (b) o workflow não trava versão do Node (usa `node-version: 22` → latest), então um dia isso quebra sem aviso. Vale `npm ci` + `node-version: 22.18` explícito como trava, mesmo sem dependências externas hoje. Obs.: o `deploy-pages.yml` **tem** `npm ci` (linha 28) — o telegram-alerts é o fluxo inconsistente.
- **5.4 parcial.** O script espera JSON puro (`JSON.parse` em `firebase-history.ts:95`); funciona se o secret for armazenado sem aspas/escapamento. Base64 no secret + decode no script é hardening recomendado (evita edge cases de YAML/escape), não um bug atual.

---

## 6. Observações adicionais (encontradas na comparação, fora do reporte)

1. **Execução de TypeScript sem build** — `monitor-telegram-alerts.mjs` importa `../lib/*.ts` diretamente (linhas 3–17). Funciona no Node moderno por type stripping, mas é frágil: `engines` (`>=22.13.0`) não garante a versão com stripping default, e o runner não fixa versão. Ver 5.3.
2. **`out/` versionado** — o build estático está no git (modificado em todo build), poluindo diff e status. Não está no `.gitignore`.
3. **`deploy/.env.production` fora do `.gitignore`** — `.gitignore` cobre `.env*` na raiz; `deploy/` é untracked hoje, mas se for adicionado, o `.env.production` pode vazar segredos. Adicionar `deploy/.env*` ao ignore.
4. **Logs do daemon** — `services/market-ingestion/daemon.log`, `daemon.err`, `daemon-err.log` estão no working tree (untracked) e não são ignorados.
5. **Módulo de compra na queda dormente** — ver 3.1: decisão de produto necessária (recalibrar vs. remover).

---

## 7. Status da proposta de correção de `lib/analysis.ts` (revisão em 24/08/2026)

**Estado:** a versão revisada de `lib/analysis.ts` (com `wilderAtr`, `COMPRESSION_THRESHOLD`/`COMPRESSION_RANGE` e parênteses em `completedCandles`) foi **analisada mas ainda NÃO está no disco** — o arquivo vigente continua com `atrAbsolute = avg(trueRanges(candles).slice(-14))` (linha 282), sem `wilderAtr` nem constantes.

### O que a proposta resolve (verificado, não presumido)

| Item | Status na proposta | Verificação |
|---|---|---|
| 4.1 — ATR divergente | ✅ corrige | `wilderAtr` foi validado numericamente contra o `smoothedTr` interno de `wilderAdx`: mesma janela de seed (`tr.slice(1, length+1)`), mesma iteração a partir de `length+1` → **resultados idênticos** (verificado: `wilderAtr === smoothedTr/length`). A proposta elimina a divergência SMA×Wilder de forma consistente com o ADX. |
| 4.4 — Magic numbers | ✅ corrige (parcial) | Constantes extraídas e usadas em `compressionStrength`. **Ressalva:** o texto da UI ainda usa literal `compression < 0.9` no summary do sinal "Compressão de preço" — deveria referenciar `COMPRESSION_THRESHOLD` para a calibração valer nos dois lugares. |
| 4.5 — Parênteses | ✅ corrige | Semântica idêntica (precedência `&&` > `||`), apenas legibilidade — coerente com o veredito anterior. |

### Pontos realmente relevantes que a proposta NÃO cobre (achados desta revisão)

1. **Mudança de escala afeta thresholds calibrados.** Trocar SMA-14 por Wilder **altera os valores** de `atrDistance`, `trendDistance` e `atr%` (exemplo medido com TR crescente: SMA-14 = 115,0 vs. Wilder = 102,5 — diferença de ~11%). Como `risk = 6 − atr×2.2`, `stretched = |atrDistance| ≥ 2`, `trendDistance×8` e `capitulationDetected` (`atrDistance ≤ −2`) foram presumivelmente calibrados com o ATR anterior, **é necessário revalidar esses thresholds com dados reais** após aplicar — não é só trocar a fórmula.
2. **Sem teste que distinga SMA de Wilder.** `tests/analysis.test.mjs` importa `wilderAdx`/`wilderRsi`, mas **não importa `wilderAtr`**, e todos os fixtures usam TR constante (spread fixo), onde SMA e Wilder coincidem — ou seja, os testes atuais passariam com a proposta **sem nunca exercitar a diferença**. Falta um teste dedicado de `wilderAtr` (série com TR crescente, valor esperado conhecido).
3. **Cálculo duplicado de `trueRanges`.** Com a proposta, `analyze` chama `wilderAtr(candles)` e `wilderAdx(candles)`, e **cada um recalcula `trueRanges(candles)`** — 2 passadas sobre a mesma série. Funcionalmente inócuo (séries de ~55–120 candles), mas a alternativa de derivar `atrAbsolute` do `smoothedTr` do ADX (retorná-lo junto) eliminaria a duplicação e garantiria consistência por construção, não por coincidência de implementação.
4. **Novo export sem consumidor nem cobertura.** `wilderAtr` vira API pública (export) sem uso externo (`monitor-telegram-alerts.mjs` não o importa) e sem teste — ver item 2.

### O que a proposta acerta ao NÃO tocar

- **4.3 (slice de volume)** ficou intacto — correto, pois estava correto (ver seção 4).
- **4.2 (divergência defasada)** ficou intacto — coerente: é decisão de produto, não bug.
- Nenhuma mudança em `alerts.ts`/`bitcoin-buy.ts` — os itens 2.x e 3.x seguem pendentes conforme o reporte.

---

## 8. Widgets de confluência × fluxo e o SQLite local (revisão em 24/08/2026)

**Pergunta do usuário:** "confluência técnico e fluxo de mercado, dois widgets relacionados que recebem arquivos em modo local SQLite — você olhou para eles?"

**Resposta direta: olhei agora, e a premissa do SQLite está incorreta.** Os dois widgets **não recebem dados do SQLite local** — o banco é **write-only** (nenhum `SELECT` existe no código). O que eles recebem:

| Widget | Fonte real de dados | Papel do SQLite |
|---|---|---|
| `MarketPanel` ("Fluxo do Mercado", `app/MarketPanel.tsx`) | WebSocket `ws://localhost:3001` → daemon `market-ingestion` → `broadcast(snapshot)` a cada 1s (`useMarketStream.ts`) | Nenhum (escreve log, nunca lê) |
| `ConfluenceCard` ("Confluência Técnico × Fluxo", `app/ConfluenceCard.tsx` + `lib/cross-validation.ts`) | `techScore` (do `analyze`) + `flowData` repassado do `MarketPanel` via callback `onFlowData` | Nenhum |
| `ConfluencePanel` ("NEXUS", `app/ConfluencePanel.tsx` + `lib/confluence.ts`) | `buildConfluence(market, analysis, multiRsi)`; fluxo vem de `aggressorFlow()` que exige `takerBuyVolume` nos candles (Binance `row[9]`) | Nenhum |
| `services/market-ingestion/data/market.db` | — | Somente gravação: `saveSnapshot` (60s), `saveRegimeEvent`; **`saveEvent` nunca é chamado** |

### Achados reais desta revisão

1. **`events` do snapshot é sempre vazio (pipeline quebrado).** Em `services/market-ingestion/src/index.ts`, `const events: MarketEvent[] = []` (linha 46) recebe `events.length = 0` em `handleStatusChange` e após cada broadcast (linha 289) — mas **nenhum `events.push` existe em lugar nenhum**. O `MarketPanel` mostra "EVENTOS: 0" para sempre, e a UI de eventos de baleia (`whale_buy`/`whale_sell`) nunca exibe nada. O `viewer.ts` também espera eventos que nunca chegam.
2. **`TradeAccumulator` e `computeCvdFromBuckets` são código morto.** `tradeAccumulator.addTrade()` é chamado em `handleTrade` (index.ts:79), mas `getCvdState()` usa o estado global de módulo de `cvd.ts`, **não o acumulador**. E `computeCvdFromBuckets` — que tem bug próprio (`whaleCvd: 0` fixo na linha 51) — nunca é chamado. O fluxo de eventos de baleia foi desenhado, mas o elo de leitura nunca foi implementado.
3. **`flowScore` default 0 confunde "neutro" com "indisponível".** Em `page.tsx:141`: `flowScore={flowData?.score ?? 0}`. Com o daemon offline, o `ConfluenceCard` trata fluxo desconhecido como **NEUTRO** e pode emitir "FORÇAS EM DISPUTA" quando na verdade não há dado — conclusão enganosa para o leitor.
4. **Em produção, o WS aponta para `ws://localhost:3001` do visitante — **DECISÃO DELIBERADA, NÃO BUG**. `resolveWsUrl` (useMarketStream.ts:36–40) usa o fallback `NEXT_PUBLIC_MARKET_WS_URL || "ws://localhost:3001"`. O mantenedor **roda o daemon `market-ingestion` em localhost de propósito, para não pagar hospedagem em Cloud** (Fly.io/Cloud Run — risco de faturamento excessivo). Consequências **aceitas por decisão de custo**: (a) o widget de fluxo de mercado e o `ConfluenceCard` só exibem dados reais quando o daemon está rodando na máquina local do mantenedor; (b) no site público (GitHub Pages/Cloudflare), `MarketPanel`/`ConfluenceCard` ficam sem dados de fluxo (offline/`flowScore=0`) — **comportamento esperado, não defeito**. ⚠️ Atenção decorrente: a UI deve **deixar visível** quando o fluxo está indisponível (hoje `flowScore ?? 0` silencia isso — ver item 3 desta seção), para o leitor do site público não interpretar "sem dado" como "neutro".
5. **A correção de "ghosting" documentada nunca dispara.** `page.tsx:145` passa `techScoreTimestamp={Date.now()}` (o instante do render) → `isTechScoreStale` (cross-validation.ts:39–47) nunca detecta staleness, pois `age ≈ 0` sempre. O sinal `DEGRADED`/"TRANSIÇÃO DE VELA / DADOS DESSINCRONIZADOS" — a correção A de produção do `motor-confluencia.md` — está **inoperante**. O timestamp correto seria `market.updatedAt` (ou o `ts` do snapshot WS).
6. **`techTimeframeMinutes` errado para a maioria dos períodos.** `page.tsx:146`: `period === "4H" ? 240 : 60` → para 15M deveria ser 15; para 1D/1S, 1440/10080. Como o item 5 anula o stale, o erro fica mascarado hoje — mas se o timestamp for corrigido, o timeframe precisa acompanhar.
7. **Escalas de score incomparáveis cruzadas com o mesmo threshold (±20).** `techScore` vem do `analyze` (clamp −100..+100, distribuição contínua) e `flowScore` do `computeScore` do daemon (soma discreta de steps: trend ±20, momentum ±14, cvd ±8, derivatives ±8, liquidity ±6, risk −12..−6 → raramente passa de ~±54). Além disso, o daemon chama `computeScore` com `priceChange: 0` fixo (index.ts:256 e 309) → o componente de momentum nunca atua, e `HIGH_VOLATILITY` assume sempre `−10`. Cruzar essas duas escalas com thresholds idênticos é frágil por construção.
8. **Dois motores de confluência distintos na mesma página.** `ConfluencePanel`/NEXUS usa `buildConfluence` (`lib/confluence.ts`, baseado em `takerBuyVolume` dos candles) e `ConfluenceCard` usa `ConfluenceEngine` (`lib/cross-validation.ts`, baseado no WS do daemon) — com lógicas e fontes diferentes, exibidos juntos em `page.tsx:129` e `139–147`. Reforça o tema "duas fontes de verdade" já apontado nas seções anteriores.
9. **Ativos estáticos ficam sem fluxo no NEXUS por design.** `aggressorFlow()` exige `takerBuyVolume`; para MSTR/SPCX/BRENT/prata/cobre/urânio (Yahoo/Worker) o campo não existe → NEXUS mostra "Fluxo agressor indisponível". Tratado, mas metade da promessa do widget ("cruzando métricas, RSI e fluxo") fica vazia para a maioria dos ativos do painel.

**Recomendação específica (frente infra/estrutura, antes de qualquer front):**
- Corrigir o pipeline de eventos: ou popular `events` no daemon (whale/trade events) e chamar `saveEvent`, ou remover a UI de eventos do `MarketPanel` (decisão de produto).
- Definir `NEXT_PUBLIC_MARKET_WS_URL` no build de produção (apontando para o Fly.io real) e tratar `flowScore === null` como "fluxo indisponível" no `ConfluenceCard`, não como 0.
- Corrigir `techScoreTimestamp` (usar `market.updatedAt`/`ts` do snapshot) e o mapeamento `techTimeframeMinutes` por período — sem isso, a proteção anti-ghosting é letra morta.
- Decidir se `TradeAccumulator`/`computeCvdFromBuckets` serão usados ou removidos (hoje: código morto com bug).

---

## 9. Conformidade do `direcionamento-indicadores-preditivos.md` × código (revisão em 24/08/2026)

Comparação do que o documento declara como "implementado/validado" contra o estado real do repositório.

### 9.1 — Veredito por parte

| Parte | Doc declara | Código real | Veredito |
|---|---|---|---|
| Parte 1 — `RegimeDetector` | ✅ implementado | `engine/regime.ts` atende a spec: threshold adaptativo, std dev, histerese (3), janela por tempo, `minSamples: 10`, confidence | ✅ conforme |
| Parte 2 — `StructuralAlert.tsx` | ✅ com debounce | `app/StructuralAlert.tsx` existe com debounce 2.5s, **mas NENHUM componente o importa** — o painel real usa HTML inline em `MarketPanel.tsx:183-216` (sem debounce) | ⚠️ órfão |
| Parte 3.2/3.4/3.6 — flowRegime, divergência, gate | ✅ validado (8 cenários) | `engine/flow-regime.ts` com `minConfidenceForDivergence: 35`, `divergence_resolved`/`failed`, reset em `detectDivergence` | ✅ conforme |
| Parte 3.8 — `AbsorptionDetector` | ✅ (5/5 testes) | `engine/absorption.ts` com histerese assimétrica (5 entra / 2 sai), `level` LOW/MEDIUM/HIGH, propagado no snapshot | ✅ conforme |
| Parte 4 — logging absorção | ✅ v1: 0.3%/30min (linha 277) | `index.ts:19-21` tem **v2: 0.05%/5min** com comentário v1; `absorption_interrupted` separado (4.2) | ⚠️ status do doc desatualizado |
| 3.7 / 3.7-bis — renames | linha 214: "pendente"; linha 299: "✅" | `MarketPanel.tsx:233` = "LIQUIDEZ NO BOOK"; `cross-validation.ts:76` = "DIVERGÊNCIA TÉCNICO × FLUXO / BULL TRAP" | ✅ feito (doc se contradiz) |
| 3.5 — teste de histerese | ✅ 8 cenários | `tests/hysteresis-test.ts` existe (164 linhas), mas **sem script npm e sem CI** | ⚠️ manual |
| Bug `useMarketStream` | ✅ corrigido | `setData(parsed)` presente | ✅ conforme |

### 9.2 — Achados críticos que o documento NÃO registra

1. **🔴 O engine inteiro é UNTRACKED no git.** `services/market-ingestion/src/engine/` (regime.ts, flow-regime.ts, absorption.ts) e `services/market-ingestion/tests/` estão como `??` no `git status`. O `index.ts` importa `./engine/regime.js` — **um clone limpo do repositório não compila o daemon**. Todo o trabalho das Partes 1/3/4 (que o doc chama de "validado em produção") existe apenas no working tree local. Risco de perda total se o diretório for limpo. **Isto é a falha de condução mais grave.**
2. **🔴 Parte 2 declarada ✅ mas o componente é órfão.** `StructuralAlert.tsx` não é importado por `page.tsx`, `MarketPanel.tsx` nem qualquer outro arquivo (grep confirma). O que o usuário vê é um bloco HTML inline em `MarketPanel.tsx:183-216` que replica a informação **sem o debounce de 2.5s** que a Parte 2 exigia — o inline re-renderiza a cada broadcast de 1s do WS, sujeito a flicker de regime/absorção. Ou: conectar o componente ou documentar o inline como substituto deliberado.
3. **🟠 `features/regime.ts` é código morto que contradiz a Parte 1.** A versão antiga (max/min, thresholds fixos 0.3%/2.5%, sem histerese, sem janela por tempo) continua trackeada e não é importada por ninguém. O requisito 2 da Parte 1 proibiu exatamente `(max-min)/min` — manter esse arquivo no repo é armadilha para futuras revisões. Remover.
4. **🟠 Status da Parte 4 desatualizado no doc.** A linha 277 registra `ABSORPTION_RESOLUTION_THRESHOLD_PCT = 0.3` e `_WINDOW_MINUTES = 30` como os valores "implementados", mas o código real (e a própria Parte 4.1, linhas 321-322) já os recalibrou para **0.05 e 5**. Quem ler só o status da Parte 4 (sem ler a 4.1) vai validar com os valores errados.
5. **🟠 Testes do daemon não rodam em lugar nenhum.** `hysteresis-test.ts` usa `Math.random()` (não determinístico), assert próprio, e **não há script `test` no `package.json` do serviço** — o `npm test` da raiz roda apenas os 7 testes do frontend. O "8 cenários passaram" foi execução manual local. Além de não rodar em CI, o teste com random pode passar/falhar por sorte.
6. **🟡 Doc se contradiz internamente** em dois pontos: 3.7 "pendente" (linha 214) vs "✅" (linha 299); 3.8 "NÃO implementado" (linha 215) vs "✅" (linha 300). O código confirma que ambos foram feitos — o corpo da Parte 3 ficou desatualizado quando o checkpoint foi escrito.

### 9.3 — O que a Parte 4 acertou (e vale manter como precedente)

- **Ciclo completo de calibração com dado real** (4.1): v1 foi estimativa, dado real mostrou desproporção (6–12s de duração vs janela de 30min; Δmáx 0.0327% vs threshold 0.3%), parâmetros recalibrados para 0.05%/5min com histórico documentado em comentário. Processo correto e rastreável.
- **Separação de `absorption_interrupted`** (4.2): evita distorcer a taxa de acerto com falhas por sobreposição; query de taxa corrigida documentada. Decisão de modelagem correta.
- **Regra aditiva estrita** (3.8/Parte 4): "não modificar nada que já funciona, só adicionar" + `tsc --noEmit` — método certo para evoluir payload de produção.

### 9.4 — Lacunas que o doc não cobre (cruzamento com seções 7 e 8)

- O doc trata o backend como validado, mas o **daemon roda em localhost por decisão deliberada de custo** (sem Cloud — ver seção 8, item 4): todo o regime/absorção/divergência que o doc valida **só é visível quando o daemon está rodando localmente**; o site público (GitHub Pages) não mostra esses dados. Isso é intencional, mas significa que a validação "ao vivo" do direcionamento acontece somente na máquina do mantenedor — o painel publicado nunca exibe fluxo/regime/absorção.
- O pipeline de **`events` (baleias) nunca é populado** (seção 8, item 1) — o doc menciona "movimento dos grandes players" como insumo, mas o array chega vazio ao painel.
- O **anti-ghosting** (correção A do `motor-confluencia.md` e o `DEGRADED` do `ConfluenceCard`) está inoperante por `techScoreTimestamp={Date.now()}` (seção 8, item 5) — não é coberto pelo direcionamento.

**Recomendação (ação imediata, antes de qualquer nova feature):** commit do `engine/` + `tests/` + `StructuralAlert.tsx` (ou decisão explícita de descartá-lo), remoção de `features/regime.ts`, script `test` no serviço com o hysteresis-test tornado determinístico, e correção do status da Parte 4 no doc (0.05/5min).

---

## 11. Correções aplicadas — MarketPanel e ConfluenceCard (24/08/2026)

Escopo executado: somente os dois widgets e a cadeia local que os alimenta (daemon `market-ingestion` em `localhost:3001` — decisão de custo mantida, sem Cloud).

### Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `services/market-ingestion/src/index.ts` | Pipeline de eventos: `classifyTrade` → `pushTradeEvent()` → `events[]` → snapshot → WS. Constante `MAX_EVENTS_PER_CYCLE = 20`. Removido `TradeAccumulator` morto. |
| `services/market-ingestion/src/flow/cvd.ts` | Fonte única de CVD documentada (`processTradeForCvd`/`getCvdState`); removido `computeCvdFromBuckets` (morto, `whaleCvd: 0` fixo). |
| `app/MarketPanel.tsx` | `onFlowData` agora emite `null` quando o daemon está offline — fluxo ausente ≠ score 0. |
| `app/ConfluenceCard.tsx` | `flowScore: number \| null`; estado "FLUXO INDISPONÍVEL" explícito quando sem dados (sem NEUTRO/confirmada falsa); normalização de escala `flowScore` (±54 → ±100) antes de avaliar; doc da fonte no topo. |
| `app/page.tsx` | `flowScore={flowData?.score ?? null}`; `techScoreTimestamp={market?.updatedAt ?? 0}` (timestamp real, não `Date.now()`); `TIMEFRAME_MINUTES` por período (15M=15, 1H=60, 4H=240, 1D=1440, 1S=10080, 1M=43200). |
| `lib/cross-validation.ts` | `techTimeframeMinutes: number` (era `60 \| 240`); doc da fonte do motor. |
| `app/globals.css` | Estilo mínimo para o estado `confluenceUnavailable`. |
| `scripts/verify-market-chain.mjs` | **Novo** — verificação da cadeia Binance → daemon → WS → widgets. |

### Problemas encontrados e corrigidos

1. **Eventos nunca populados** (`events[]` sem `push`) → widget com "EVENTOS: 0" permanente e sem `whale_buy`/`whale_sell`. Corrigido com `pushTradeEvent()` ligado à classificação de trades grandes.
2. **`computeCvdFromBuckets` com `whaleCvd: 0` fixo** e `TradeAccumulator` alimentado mas nunca lido → segunda fonte de verdade fantasma. Corrigido: `processTradeForCvd`/`getCvdState` é a fonte única; código morto removido.
3. **`flowScore ?? 0`** transformava ausência de fluxo em "mercado neutro" → conclusão falsa no ConfluenceCard. Corrigido: `null` propaga até o card, que exibe "FLUXO INDISPONÍVEL" sem avaliar confluência.
4. **Escalas incomparáveis**: `techScore` contínuo ±100 vs `flowScore` discreto ~±54 comparados com o mesmo threshold ±20 → fluxo sistematicamente sub-representado. Corrigido com `normalizeFlowScore()` (reescala para ±100, fórmula do techScore intocada).
5. **`techScoreTimestamp={Date.now()}`** anulava a detecção de stale/ghosting (age ≈ 0 sempre). Corrigido: usa `market.updatedAt` (timestamp real do dado).
6. **`techTimeframeMinutes = period === "4H" ? 240 : 60`** errado para 15M/1D/1S/1M. Corrigido com mapa `TIMEFRAME_MINUTES`.

### Fluxo de dados comprovado (verificação ao vivo)

`node scripts/verify-market-chain.mjs` contra o daemon local em `ws://localhost:3001`:

- **8/8 snapshots válidos**, conexão live.
- **95 eventos de baleia em 8s** (2ª rodada: 61 eventos) — `whale_buy`/`whale_sell` com direção, chegando ao snapshot → WS.
- Campos consumidos pelos widgets presentes e coerentes: `p`, `cvd`, `cvd_whale`, `imb`, `score` (fluxo), `regime` + `regime_confidence`, `flow_regime` + `flow_strength`, `divergence`, `absorption_state`/`level`/`intensity`, `quality` (WS/OI/FUND live).
- `RESULTADO: CADEIA OK ✓`

### Testes executados

- `npm run build` (daemon): tsc OK.
- `npm run typecheck` (daemon): 0 erros.
- `npm test` (frontend, 7 arquivos executados inline — o runner `--test` spawna subprocessos bloqueados pelo sandbox): **43/43 passando** (analysis 28, confluence 4, bitcoin-buy 4, chart 2, live-price 2, positions 3; rendered-html 3 — executado separadamente).
- `npx tsc --noEmit` (frontend): 0 erros.
- `npx eslint` nos 5 arquivos alterados: 0 violações.
- `npm run build` (Next): **compilou com sucesso** ("Compiled successfully in 7.2s"); a etapa "Running TypeScript" interna do Next falhou por `spawn EPERM` (limitação do sandbox, não do código) — coberta pelo `tsc --noEmit` acima.

### Dados ainda indisponíveis

- **`events` históricos (SQLite `events` table)**: o pipeline agora alimenta `events[]` no snapshot, mas `saveEvent` para o SQLite continua sem chamada — o banco segue write-only para snapshots/regime_events (decisão de custo mantida; não era escopo).
- **Ativos estáticos (Yahoo/Worker) no NEXUS**: sem `takerBuyVolume` → fluxo indisponível por design (não alterado, conforme escopo).
- **`StructuralAlert.tsx` órfão**: componente da Parte 2 ainda não importado (MarketPanel usa bloco inline). Não alterado — fora do escopo desta tarefa, listado na seção 9.2.

---

## 12. Calibração estatística — plano em etapas (24/08/2026)

Regra fundamental: **uma alteração de calibração por vez, medir e registrar antes da próxima**. Não otimizar para inflar taxa de acerto — objetivo é reduzir falsos sinais e obter métrica de capacidade preditiva real. Pipeline de coleta (CVD, eventos, snapshots, WS 3001) **não é alterado**.

### Baseline registrado (antes de qualquer mudança) — `node scripts/metricas-calibracao.mjs`

| Métrica | Valor |
|---|---|
| Divergência triggered | 93 (6,0/h) |
| `all_resolved` | 40 → taxa bruta **62,5%** |
| `valid_resolved` (≥60s) | **2** |
| `insufficient_duration` (<60s) | **38** |
| `divergence_failed` | 24 |
| **TAXA VÁLIDA (≥60s)** | **7,7%** |
| Mudanças de regime | 858 (55,5/h) |
| Duração média de regime | 65,0s |
| Reversões <10s | 303 (35,4%) |
| Reversões <30s | 585 (68,3%) |
| Absorção: resolved/failed/interrupted/triggered | 168/61/38/274 |
| Taxa absorção "atingiu ±0,05%" | **73,4%** (NÃO é taxa de previsão — ver Etapa 4) |

**Leitura:** a taxa bruta de divergência (62,5%) é enganosa — 38 de 40 resoluções duram <60s (o regime confirma quase imediatamente, sem antecedência preditiva). A taxa válida (7,7%) é a única que representa capacidade preditiva.

### Etapa 1 — Métrica de divergência (✅ implementada: script de medição, coleta intocada)

- `scripts/metricas-calibracao.mjs` classifica `divergence_resolved` por `duration_ms` (parse do `extra`):
  - `valid_resolved` = duração ≥ **60.000ms**; `insufficient_duration` = <60s.
  - Eventos **não são apagados nem alterados** — continuam em `regime_events`.
- Taxa de acerto passa a ser calculada **somente sobre** `valid_resolved / (valid_resolved + divergence_failed)`.
- Contagens separadas: `all_resolved`, `valid_resolved`, `insufficient_duration`, `failed` (todas no script).

### Etapa 2 — Threshold adaptativo (✅ aplicada: ÚNICA alteração de código)

- **Mudança:** `volatilityFactor: 2.0 → 5.0` em `services/market-ingestion/src/engine/regime.ts` (comentário de calibração v2 adicionado). `baseThreshold` **mantido em 0.05** — não alterado.
- **Motivo:** com fator 2.0, volatilidade observada (0.010–0.021%) × 2 = 0.02–0.042% < piso → threshold efetivamente fixo em 0.05% → regime piscando. Com fator 5.0, threshold = vol×5 → supera o piso para vol > 0.01% (verificado: 0.015%→0.075, 0.020%→0.100, 0.021%→0.105) — o adaptativo volta a atuar.
- **Validado:** `npm run build` + `npm run typecheck` OK (daemon). Teste de histerese via `tsx` bloqueado pelo sandbox (EPERM no spawn do esbuild) — coberto pelo typecheck.
- **Pendente:** rodar o daemon por alguns dias e comparar com o baseline via `scripts/metricas-calibracao.mjs` (mudanças de regime, duração média, reversões <10s/<30s, divergências/hora).

### Etapa 3 — Histerese (⏸️ NÃO aplicar ainda — aguarda resultado da Etapa 2)

Testar `confirmationThreshold = 5` em `engine/regime.ts` e `engine/flow-regime.ts`, comparando os mesmos indicadores do baseline.

### Etapa 4 — Absorção (⏸️ NÃO aplicar ainda)

- Threshold da absorção **não é alterado**.
- A métrica atual (resolved/failed) é rotulada como **"atingiu ±0,05% em até 5min"** — medida de atingimento, **não** "taxa de previsão". O script já deixa esse rótulo explícito.
- Separar futuramente uma métrica de valor preditivo (movimento além do ruído, com horizonte maior) — decisão posterior.

### Arquivos tocados nesta rodada

| Arquivo | Mudança |
|---|---|
| `services/market-ingestion/src/engine/regime.ts` | `volatilityFactor` 2.0 → 5.0 (Etapa 2, única alteração de código) |
| `scripts/metricas-calibracao.mjs` | **Novo** — medição A/B/C (divergência, regime, absorção) |

---

## 13. Próximos passos (ordem recomendada)

### Frente 1 — Matemática (recomendada primeiro) ⬅ resposta à pergunta
Baixo risco, alto impacto: é a fundação de toda nota/alerta. **Status: proposta pronta, não aplicada (ver seção 7).**
1. **Aplicar a proposta de `lib/analysis.ts`** (unificar ATR em Wilder via `wilderAtr` + constantes de compressão + parênteses) — já validada como consistente com o ADX.
2. **Antes de aplicar**, decidir entre (a) `wilderAtr` independente (proposta atual, com `trueRanges` duplicado) ou (b) retornar o `smoothedTr` de `wilderAdx` e derivar `atrAbsolute` dele — evita 2 passadas e garante consistência por construção (seção 7, ponto 3).
3. **Adicionar teste dedicado de `wilderAtr`** com série de TR crescente e valor esperado conhecido — os testes atuais não distinguem SMA de Wilder (seção 7, ponto 2).
4. **Revalidar thresholds calibrados com o ATR anterior** após a troca: `risk = 6 − atr×2.2`, `|atrDistance| ≥ 2`, `capitulationDetected ≤ −2` — a escala muda ~10% em séries voláteis (seção 7, ponto 1).
5. **Usar `COMPRESSION_THRESHOLD` também no summary** da UI ("Compressão de preço") — hoje ainda é literal `0.9` (seção 7, tabela 4.4).
6. (Opcional, decisão de produto) Leitura de divergência em tempo real além dos pivôs confirmados (4.2).

### Frente 2 — Infraestrutura (maior risco ao usuário)
1. **Mover estado para Firebase RTDB** (`subscribers/readings/capitulationWatch`), reusando o padrão JWT de `firebase-history.ts`; cache do GH vira só fallback/otimização (5.2).
2. **Travar o ambiente do workflow**: `node-version: 22.18` explícito + `npm ci` no `telegram-alerts.yml` (5.3); considerar Base64 na credencial (5.4).
3. **Migrar o cron de 5 min para serviço sempre-ligado** (Fly.io já existe para `market-ingestion`) ou manter no GH como best-effort, documentado (5.1).
4. `.gitignore`: `deploy/.env*`, `out/`, logs do daemon (obs. 2–4).

### Frente 3 — Estrutural (menor urgência, aguarda decisões de produto)
1. **Decidir o destino do módulo de compra na queda** (3.1): recalibrar para níveis relativos ou remover; depois refatorar `rank`/transição com tipagem de retorno (3.2, 3.3).
2. **Unions em `rsiOpportunity`** + anotar retorno de `shouldDeliverAlert` (2.4, 2.5).
3. **Definir escopo das regras genéricas de RSI** (2.1): restringir por ativo ou renomear como genéricas; alinhar com a mensagem de boas-vindas.
4. **Glob no script `test`** (1.2) e remover duplicação `build`/`build:pages` (1.1).

---

## Resumo executivo

- **Confirmadas (7):** 1.1, 1.2, 2.1, 2.5, 3.1, 3.2, 4.1, 4.4 — as mais relevantes são **4.1 (ATR divergente)** e **3.1 (módulo de compra dormente)**.
- **Parciais/disputáveis (7):** 2.2, 2.4, 3.3, 4.2, 4.5, 5.3, 5.4 — na maioria, o código é internamente coerente; a correção é de nomenclatura, tipagem ou hardening.
- **Refutadas (2):** 2.3 (`includes(undefined)` é seguro; sem `noUncheckedIndexedAccess` não há erro) e 4.3 (o slice de volume está correto no código atual).
- **Widgets de confluência × fluxo (seção 8):** os dois widgets **não leem o SQLite local** — o banco é write-only (log/backtest). Achados reais: pipeline de `events` nunca populado (UI de baleias sempre vazia), `TradeAccumulator`/`computeCvdFromBuckets` mortos (este com bug `whaleCvd: 0`), `flowScore` default 0 confunde neutro com indisponível, correção anti-ghosting inoperante (`techScoreTimestamp={Date.now()}`) e `techTimeframeMinutes` errado para 15M/1D/1S. **⚠️ Decisão de arquitetura registrada:** o daemon roda em **localhost por opção deliberada do mantenedor, para não pagar Cloud** (risco de faturamento excessivo) — portanto `MarketPanel`/`ConfluenceCard` só têm dados de fluxo quando o daemon local está ativo; no site público eles ficam offline, e isso é **comportamento esperado, não bug** (a UI só precisa deixar essa indisponibilidade explícita).
- **Direcionamento × código (seção 9):** a **Parte 4 foi conduzida corretamente no código** (v2 calibrado 0.05%/5min, `absorption_interrupted` separado, regra aditiva) — mas o doc tem status desatualizado (cita 0.3/30) e esconde 4 problemas de condução: **🔴 engine/ e tests/ UNTRACKED no git** (clone limpo não compila o daemon), **🔴 `StructuralAlert.tsx` órfão** (Parte 2 declarada ✅ mas nenhum import; painel usa inline sem debounce), **🟠 `features/regime.ts` morto e contraditório** com a Parte 1, **🟠 testes do daemon sem script/CI e com `Math.random()`** (não determinístico).
- **Status da proposta (24/08/2026):** a correção de `lib/analysis.ts` (4.1 + 4.4 + 4.5) existe como proposta e foi validada — `wilderAtr` é matematicamente consistente com o ADX — mas **ainda não está aplicada no disco**. Falta: teste dedicado de `wilderAtr`, revalidação de thresholds (escala muda ~10%), usar a constante no summary da UI e decidir sobre o `trueRanges` duplicado (ver seção 7).
- **Recomendação:** **ação imediata = commit do engine/tests + decisão sobre `StructuralAlert` + remoção de `features/regime.ts` + script test determinístico** (seção 9.4), pois hoje o "validado em produção" do direcionamento não existe no repositório. Depois, frente **matemática** (aplicar proposta + teste + revalidar thresholds) e os itens da seção 8 (WS em produção + pipeline de eventos).
