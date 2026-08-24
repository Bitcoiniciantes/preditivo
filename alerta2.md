# Especificação Técnica: Motor Global de Alertas de Suporte e Resistência (`alerta2.md`)

## 1. Visão Arquitetural e Objetivo

Isolar o motor de monitoramento de preços do componente visual de gráficos (`PriceStructureChart.tsx`). A arquitetura garante que os alertas de múltiplos ativos (como BTC, ETH, SOL) funcionem de forma assíncrona, contínua e independente do ativo selecionado ou renderizado no momento.

```text
WebSocket / Market Ingestion
          │
          ▼
   Preços Globais (livePrices)
          │
          ▼
   Global Alert Engine (React Context)
          │
     ┌────┴─────────────┬─────────────┐
     ▼                  ▼             ▼
  BTC/USDT           ETH/USDT      SOL/USDT ...
     │                  │             │
     ├─ Suporte         ├─ Suporte    ├─ Suporte
     └─ Resistência     └─ Resistência└─ Resistência
          │
          ▼
   Detecção de Cruzamento (Crossover)
          │
          ▼
   UI Global de Alertas (SupportResistanceAlert)
```

## 2. Tipos e Estruturas de Dados

Separação estrita entre a configuração do alerta (estado gerenciado pelo usuário) e o alerta disparado (evento temporário na interface).

```typescript
export type AlertLevelSource = "GRAPH" | "PREDEFINED";

export type AssetAlertConfig = {
  symbol: string;
  support: number;
  resistance: number;
  enabled: boolean;
  source: AlertLevelSource;
};

export type TriggeredAlert = {
  id: string;
  symbol: string;
  type: "SUPPORT" | "RESISTANCE";
  price: number;
  timestamp: number;
};
```

## 3. Motor de Disparo e Detecção de Cruzamento (Crossover)

Para evitar avalanches de notificações ou disparos repetitivos enquanto o preço permanecer acima da resistência ou abaixo do suporte, o motor rastreia o estado anterior do preço (`prevPricesRef`) e detecta a transição real de cruzamento:

- **Resistência:** Dispara apenas se `previousPrice < resistance` e `currentPrice >= resistance`.
- **Suporte:** Dispara apenas se `previousPrice > support` e `currentPrice <= support`.

**Regra importante:** `prevPricesRef` é atualizado percorrendo **`livePrices`** (não `configs`), para **todos** os ativos presentes no feed — inclusive um ativo que ainda não tem alerta cadastrado (ex.: `XRPUSDT` chegou no feed mas ainda não foi cadastrado em `PREDEFINED_ALERTS` nem ativado no gráfico). Isso garante que, quando esse ativo for cadastrado e o alerta ativado depois, o motor já "conheça" o preço anterior e não dispare de forma espúria só por desconhecer o lado em que o preço já estava. Só a checagem de crossover (e o disparo) é condicionada a `configs[symbol]?.enabled`.

A validação de preço usa `currentPrice == null || !Number.isFinite(currentPrice)` em vez de `!currentPrice`, para não descartar incorretamente preços válidos porém "falsy" em JS (como `0`, embora improvável em cripto, é uma checagem mais correta para dados de mercado).

**Comportamento após o disparo (dismiss e re-crossing):** `activeAlerts` controla apenas os eventos *atualmente exibidos* na UI. O estado de crossover em si é determinado inteiramente por `prevPricesRef`. Isso significa que fechar/dispensar um popup de alerta **não** reativa a detecção nem provoca um novo disparo enquanto o preço permanecer do mesmo lado do nível — o motor só volta a poder disparar quando o preço cruzar para o lado oposto e depois cruzar de novo (re-crossing). Por exemplo: BTC cruza resistência e dispara; usuário fecha o popup; BTC continua subindo — nenhum novo alerta é disparado. Só se BTC cair abaixo da resistência e subir de novo é que um novo alerta é gerado.

**Regra de ativação/desativação:** ao **ativar** um alerta, os níveis atuais fornecidos pelo gráfico são capturados e congelados. Ao **desativar**, os níveis congelados permanecem inalterados — a desativação não deve gravar `support`/`resistance` recalculados nesse momento. Ao **reativar**, os níveis atuais do gráfico são capturados novamente, substituindo os níveis anteriormente congelados. Essa regra é implementada em `toggleAlert` (seção 4), que trata explicitamente os três casos (primeiro acionamento, desativar, reativar) em vez de um simples `!existing.enabled` que gravaria níveis novos também na desativação.

## 4. Implementação do Contexto Global (`GlobalAlertContext.tsx`)

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type AlertLevelSource = "GRAPH" | "PREDEFINED";

export type AssetAlertConfig = {
  symbol: string;
  support: number;
  resistance: number;
  enabled: boolean;
  source: AlertLevelSource;
};

export type TriggeredAlert = {
  id: string;
  symbol: string;
  type: "SUPPORT" | "RESISTANCE";
  price: number;
  timestamp: number;
};

type GlobalAlertState = {
  configs: Record<string, AssetAlertConfig>;
  activeAlerts: TriggeredAlert[];
  toggleAlert: (symbol: string, support: number, resistance: number, source?: AlertLevelSource) => void;
  removeActiveAlert: (id: string) => void;
  updateConfigLevels: (symbol: string, support: number, resistance: number, source?: AlertLevelSource) => void;
};

const AlertContext = createContext<GlobalAlertState | null>(null);

const STORAGE_KEY = "global-alert-configs";

// Ativos pré-cadastrados: fonte separada do motor, facilita adicionar
// novos ativos sem mexer na lógica do provider.
const PREDEFINED_ALERTS: Record<string, AssetAlertConfig> = {
  BTCUSDT: { symbol: "BTCUSDT", support: 110000, resistance: 115000, enabled: false, source: "PREDEFINED" },
  ETHUSDT: { symbol: "ETHUSDT", support: 4400, resistance: 4800, enabled: false, source: "PREDEFINED" },
  SOLUSDT: { symbol: "SOLUSDT", support: 220, resistance: 250, enabled: false, source: "PREDEFINED" },
};

function loadPersistedConfigs(): Record<string, AssetAlertConfig> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, AssetAlertConfig>;
    // Mescla o que foi persistido com os pré-cadastrados (caso novos ativos
    // tenham sido adicionados ao PREDEFINED_ALERTS desde o último save).
    return { ...PREDEFINED_ALERTS, ...parsed };
  } catch {
    return null;
  }
}

export function GlobalAlertProvider({
  children,
  livePrices,
}: {
  children: React.ReactNode;
  livePrices: Record<string, number>;
}) {
  // Inicializa sempre com PREDEFINED_ALERTS (idêntico no server e no client)
  // e só troca para o valor persistido dentro de um useEffect, depois da
  // hidratação. Fazer isso via lazy initializer no useState pode gerar
  // mismatch de hidratação em Next.js (server não tem window/localStorage).
  const [configs, setConfigs] = useState<Record<string, AssetAlertConfig>>(PREDEFINED_ALERTS);

  const [activeAlerts, setActiveAlerts] = useState<TriggeredAlert[]>([]);
  const prevPricesRef = useRef<Record<string, number>>({});

  // Hidrata o estado a partir do localStorage após o mount no client.
  useEffect(() => {
    const persisted = loadPersistedConfigs();
    if (persisted) setConfigs(persisted);
  }, []);

  // Persistência: salva apenas QUAIS alertas estão ativos e seus níveis.
  // O preço em si continua vindo sempre do WebSocket/livePrices — a
  // persistência não substitui o motor global, só evita perder o estado
  // de "o que está ativo" ao dar F5.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    } catch {
      // ignore write errors (ex.: storage cheio ou indisponível)
    }
  }, [configs]);

  const triggerAlert = useCallback(
    (symbol: string, type: "SUPPORT" | "RESISTANCE", price: number) => {
      setActiveAlerts((prev) => {
        if (prev.some((a) => a.symbol === symbol && a.type === type)) return prev;
        return [
          ...prev,
          { id: `${symbol}-${type}-${Date.now()}`, symbol, type, price, timestamp: Date.now() },
        ];
      });
    },
    []
  );

  useEffect(() => {
    // IMPORTANTE: o loop percorre livePrices (não configs). Isso garante que
    // prevPricesRef seja atualizado para TODOS os ativos que chegam no feed —
    // inclusive um ativo que ainda não tem entrada em configs (ex.: XRPUSDT
    // chegou no livePrices mas ainda não foi cadastrado nem no gráfico nem
    // em PREDEFINED_ALERTS). Assim, no momento em que esse ativo for
    // cadastrado e o alerta ativado, o motor já conhece o preço anterior e
    // não dispara de forma espúria.
    Object.entries(livePrices).forEach(([symbol, currentPrice]) => {
      if (currentPrice == null || !Number.isFinite(currentPrice)) {
        return;
      }

      const previousPrice = prevPricesRef.current[symbol];
      prevPricesRef.current[symbol] = currentPrice;

      const config = configs[symbol];

      if (!config?.enabled || previousPrice === undefined) {
        return;
      }

      if (previousPrice < config.resistance && currentPrice >= config.resistance) {
        triggerAlert(symbol, "RESISTANCE", currentPrice);
      }

      if (previousPrice > config.support && currentPrice <= config.support) {
        triggerAlert(symbol, "SUPPORT", currentPrice);
      }
    });
  }, [livePrices, configs, triggerAlert]);

  const toggleAlert = useCallback(
    (symbol: string, support: number, resistance: number, source: AlertLevelSource = "GRAPH") => {
      setConfigs((prev) => {
        const existing = prev[symbol];

        // Primeiro acionamento (ativo ainda não registrado): cria e ativa
        // já capturando os níveis atuais do gráfico.
        if (!existing) {
          return {
            ...prev,
            [symbol]: { symbol, support, resistance, enabled: true, source },
          };
        }

        // Alerta ATIVO -> desativa SEM alterar os níveis congelados. A
        // desativação não deve "atualizar silenciosamente" os níveis, mesmo
        // que o gráfico já tenha recalculado support/resistance nesse meio-tempo.
        if (existing.enabled) {
          return {
            ...prev,
            [symbol]: { ...existing, enabled: false },
          };
        }

        // Alerta DESATIVADO -> reativa capturando os níveis atuais do
        // gráfico, substituindo os níveis anteriormente congelados.
        return {
          ...prev,
          [symbol]: { ...existing, support, resistance, source, enabled: true },
        };
      });
    },
    []
  );
```

**Fluxo de estados de `toggleAlert`:**

```text
ALERTA DESATIVADO
       │
       │ clicar
       ▼
ATIVA COM NÍVEIS ATUAIS DO GRÁFICO
       │
       ▼
NÍVEIS CONGELADOS
       │
       │ gráfico recalcula (updateConfigLevels é chamado, mas ignorado)
       ▼
NÍVEIS DO ALERTA NÃO MUDAM
       │
       │ clicar (desativar)
       ▼
DESATIVA — níveis congelados permanecem intactos
       │
       │ gráfico pode continuar recalculando livremente
       ▼
NÍVEIS ANTIGOS CONTINUAM ARMAZENADOS
       │
       │ clicar novamente (reativar)
       ▼
ATIVA COM OS NÍVEIS ATUAIS DO GRÁFICO (substitui os congelados anteriores)
```

*(continuação do mesmo `GlobalAlertContext.tsx`, dentro de `GlobalAlertProvider`)*

```tsx
  const updateConfigLevels = useCallback(
    (symbol: string, support: number, resistance: number, source: AlertLevelSource = "GRAPH") => {
      setConfigs((prev) => {
        const existing = prev[symbol];

        if (!existing) {
          // Ativo ainda não registrado (ex.: primeira vez que o gráfico calcula
          // níveis para ele): cria como desabilitado, pronto para ser ativado.
          return { ...prev, [symbol]: { symbol, support, resistance, enabled: false, source } };
        }

        // Congelamento: enquanto o alerta estiver ATIVO, não sobrescrevemos
        // support/resistance silenciosamente com valores recalculados pelo
        // gráfico. O usuário ativou o alerta com um nível específico; ele deve
        // desativar e reativar (ou usar uma ação explícita) para atualizar.
        if (existing.enabled) return prev;

        if (existing.support === support && existing.resistance === resistance) return prev;

        return {
          ...prev,
          [symbol]: { ...existing, support, resistance, source },
        };
      });
    },
    []
  );

  const removeActiveAlert = useCallback((id: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <AlertContext.Provider
      value={{ configs, activeAlerts, toggleAlert, removeActiveAlert, updateConfigLevels }}
    >
      {children}
    </AlertContext.Provider>
  );
}

export const useGlobalAlerts = () => {
  const context = useContext(AlertContext);
  if (!context) throw new Error("useGlobalAlerts must be used within GlobalAlertProvider");
  return context;
};
```

## 5. Renderização Global (`GlobalAlertRenderer.tsx`)

Posicionar este componente na raiz/layout principal da aplicação para exibir os alertas disparados independentemente da página ou ativo aberto:

```tsx
"use client";

import { useGlobalAlerts } from "./GlobalAlertContext";
import { SupportResistanceAlert } from "./SupportResistanceAlert";

export function GlobalAlertRenderer({ currency }: { currency: string }) {
  const { activeAlerts, removeActiveAlert } = useGlobalAlerts();

  if (activeAlerts.length === 0) return null;

  return (
    <div
      className="globalAlertContainer"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {activeAlerts.map((alert) => (
        <SupportResistanceAlert
          key={alert.id}
          asset={alert.symbol}
          type={alert.type}
          price={alert.price}
          timestamp={alert.timestamp}
          currency={currency}
          isVisible={true}
          onDismiss={() => removeActiveAlert(alert.id)}
        />
      ))}
    </div>
  );
}
```

## 6. Integração com o Gráfico (`PriceStructureChart.tsx`)

Remoção do gancho local obsoleto e adaptação para acionar o contexto global:

```tsx
import { useGlobalAlerts } from "./GlobalAlertContext";

// Dentro do componente PriceStructureChart:
const { configs, toggleAlert, updateConfigLevels } = useGlobalAlerts();
const isAlertEnabled = configs[asset]?.enabled ?? false;

useEffect(() => {
  if (support > 0 && resistance > 0) {
    // source "GRAPH": indica que esses níveis vêm do cálculo dinâmico do
    // gráfico. Enquanto o alerta estiver ativo, updateConfigLevels não vai
    // sobrescrever os níveis silenciosamente (ver seção 5, congelamento).
    updateConfigLevels(asset, support, resistance, "GRAPH");
  }
}, [asset, support, resistance, updateConfigLevels]);

// Botão no cabeçalho do gráfico:
<button
  type="button"
  onClick={() => toggleAlert(asset, support, resistance, "GRAPH")}
  className={`alertToggleBtn ${isAlertEnabled ? "active" : ""}`}
  aria-pressed={isAlertEnabled}
>
  {isAlertEnabled ? "🔔 Alertas Ativos" : "🔕 Ativar Alertas"}
</button>
```

## 7. Pré-requisito Crítico: Cobertura de `livePrices`

A arquitetura só funciona se `livePrices` contiver **todos** os ativos que podem ter alertas, e não apenas o ativo selecionado no gráfico no momento. Por exemplo:

```json
{
  "BTCUSDT": 109850,
  "ETHUSDT": 4512,
  "SOLUSDT": 241
}
```

Se o WebSocket/market-ingestion atual só emite o preço do ativo aberto no gráfico (ex.: `{ "BTCUSDT": 109850 }`), simplesmente cadastrar ETH e SOL no `GlobalAlertContext` **não resolve nada** — o motor nunca vai receber preço para eles e o alerta nunca dispara.

### 🔒 Barreira de implementação — LIVE PRICES AUDIT

**Este checklist deve ser respondido antes de começar a criar o `GlobalAlertContext`.** Não é uma sugestão: é o único ponto capaz de tornar toda a arquitetura inútil se ignorado.

- [ ] Onde `livePrices` é criado? (qual arquivo)
- [ ] Qual hook expõe `livePrices` para os componentes?
- [ ] Qual conexão WebSocket alimenta esse hook?
- [ ] Quais símbolos chegam simultaneamente no feed hoje?
- [ ] `BTCUSDT` está presente mesmo quando o gráfico mostra outro ativo?
- [ ] `ETHUSDT` está presente mesmo quando o gráfico mostra outro ativo?
- [ ] `SOLUSDT` está presente mesmo quando o gráfico mostra outro ativo?
- [ ] O objeto `livePrices` é persistente entre atualizações (mantém os símbolos anteriores) ou é substituído a cada tick só com o ativo ativo?

Se qualquer resposta indicar que o feed só cobre o ativo selecionado, **o primeiro passo é corrigir o feed** — antes de tocar em `GlobalAlertContext`, `PriceStructureChart` ou qualquer outro arquivo deste documento.

Além do audit de `livePrices`, também verificar no projeto:

- [ ] Onde `support`/`resistance` são calculados atualmente.
- [ ] Se esses níveis são calculados **somente** para o ativo selecionado no gráfico.
- [ ] Qual é a assinatura atual (props) de `SupportResistanceAlert`.

## 8. Decisão Arquitetural: Origem de Suporte/Resistência

Há duas fontes possíveis para os níveis de suporte/resistência, e isso muda a arquitetura:

**A. Ativo atualmente no gráfico** — níveis calculados dinamicamente pelo `PriceStructureChart` em tempo real, a partir da estrutura de preço visível.

**B. Ativos pré-cadastrados (não abertos no gráfico)** — por exemplo, ETH e SOL com suporte/resistência fixos, definidos manualmente (como no `useState` inicial do `GlobalAlertProvider` acima).

Se **B** for suficiente (níveis fixos, cadastrados manualmente, sem recalcular), a arquitetura deste documento já resolve o problema.

Mas se o objetivo é que ETH/SOL tenham as mesmas linhas de suporte/resistência **calculadas automaticamente** pelo mesmo algoritmo do gráfico — mesmo sem estarem abertos —, então o cálculo de suporte/resistência precisa sair do `PriceStructureChart` e virar um serviço independente:

```text
             Market Ingestion
                    │
                    ▼
              Dados de mercado
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
    Price Structure       Live Prices
       Engine                  │
          │                    │
          │                    ▼
          │             Global Alert Engine
          │                    │
          ▼              ┌─────┼─────┐
      BTC levels          BTC   ETH   SOL
      ETH levels           │     │     │
      SOL levels           ▼     ▼     ▼
                       Alertas globais
```

Nesse desenho, o `PriceStructureChart` vira apenas **consumidor** dos níveis (calculados centralmente), em vez de ser a fonte deles — o que é mais robusto e evita duplicar lógica de cálculo por ativo.

## 9. Observações de Implementação

- `GlobalAlertProvider` deve envolver a aplicação em um nível alto do layout (ex.: `app/layout.tsx`), recebendo `livePrices` de onde quer que o WebSocket/ingestão de mercado seja centralizado — e essa fonte precisa cobrir todos os ativos com alerta possível (ver seção 7).
- `GlobalAlertRenderer` deve ficar dentro do `GlobalAlertProvider`, mas pode ser renderizado uma única vez no layout raiz — não precisa estar em cada página.
- O componente `SupportResistanceAlert` precisa aceitar as props `asset`, `type`, `price`, `timestamp`, `currency`, `isVisible` e `onDismiss` — ajuste a assinatura desse componente se ela for diferente da atual.
- `toggleAlert`, `updateConfigLevels` e `removeActiveAlert` são as funções expostas pelo contexto e estabilizadas com `useCallback`. `triggerAlert` **não é exposta** pelo contexto — permanece privada ao provider (usada só internamente no `useEffect` de crossover) e também usa `useCallback` para poder entrar como dependência estável desse efeito.
- `configs` não fica mais hardcoded no `useState` do provider: os ativos pré-cadastrados vivem em `PREDEFINED_ALERTS`, um objeto separado — adicionar um novo ativo (ex.: XRP) não exige tocar na lógica do motor. Note que `enabled: false` em todos os itens de `PREDEFINED_ALERTS`: eles são **pré-configurados**, não **pré-ativados** — o usuário vê ETH/SOL já cadastrados com níveis, mas precisa ligar o alerta manualmente (via `toggleAlert`) para começar a monitorar.
- **Congelamento de níveis:** enquanto um alerta está `enabled`, `updateConfigLevels` ignora atualizações de `support`/`resistance` vindas do gráfico. Isso evita que um alerta ativado em "BTC resistência 115.000" passe a monitorar silenciosamente "113.800" só porque o algoritmo recalculou os níveis. Para atualizar os níveis de um alerta ativo, o usuário precisa desativar e reativar (ou seria necessária uma ação explícita adicional, como um botão "atualizar níveis", que este documento não cobre).
- `source: "GRAPH" | "PREDEFINED"` registra a origem dos níveis de cada config — útil tanto para exibir isso na UI ("estes níveis vêm do gráfico" vs. "níveis fixos") quanto para decisões futuras (ex.: só permitir edição manual de níveis com `source: "PREDEFINED"`).
- **Persistência:** `configs` é salvo em `localStorage` a cada mudança e recarregado na inicialização do provider (mesclado com `PREDEFINED_ALERTS`, para o caso de novos ativos terem sido adicionados ao código desde o último save). Importante: a persistência salva apenas *quais alertas estão ativos e seus níveis* — o preço continua vindo sempre do `livePrices`/WebSocket; a persistência não substitui o motor global.

## 10. Diagrama Consolidado do Motor

```text
                 MARKET INGESTION
                       │
                       ▼
               ┌───────────────┐
               │  livePrices   │
               │ BTC ETH SOL...│
               └───────┬───────┘
                       │
             ┌─────────▼─────────┐
             │  GLOBAL ALERT     │
             │      ENGINE       │
             └─────────┬─────────┘
                       │
             ┌─────────┴─────────┐
             │                   │
       Configurações        Preços anteriores
       por ativo            prevPricesRef
             │                   │
             └─────────┬─────────┘
                       ▼
                 CROSSOVER
                 ┌─────┴─────┐
                 ▼           ▼
              SUPORTE    RESISTÊNCIA
                 │           │
                 └─────┬─────┘
                       ▼
                TRIGGERED ALERT
                       │
                       ▼
             GLOBAL ALERT RENDERER
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
         BTC          ETH          SOL
```

O `PriceStructureChart` deixa de monitorar preço; ele só desenha candles, suporte/resistência e expõe o botão "Ativar alerta", que aciona o `GlobalAlertEngine`.

## 11. Ordem Recomendada de Implementação

**A próxima etapa não é escrever `GlobalAlertContext.tsx`.** É executar o LIVE PRICES AUDIT (seção 7) no projeto real, verificando os arquivos existentes. Só depois disso a implementação deve começar, na ordem abaixo — que evita quebrar o alarme atual e valida o pré-requisito mais crítico antes de investir no resto:

1. Localizar onde `livePrices` é criado.
2. Verificar se o feed contém múltiplos ativos simultaneamente ou apenas o selecionado — **se for só o selecionado, corrigir isso primeiro, antes de qualquer outra etapa.**
3. Localizar onde `support`/`resistance` são calculados hoje.
4. Verificar a assinatura atual de `SupportResistanceAlert`.
5. Criar `GlobalAlertContext` (com `PREDEFINED_ALERTS`, `source`, congelamento de níveis e persistência conforme este documento).
6. Remover o hook/estado local de monitoramento de preço do `PriceStructureChart`.
7. Colocar o `GlobalAlertRenderer` no nível global do layout.
8. Testar troca de ativo no gráfico: BTC → ETH → SOL, conferindo se os alertas de BTC continuam ativos mesmo com o gráfico mostrando ETH.
9. Testar desmontagem do gráfico (trocar de página) com alerta ativo.
10. Testar crossover e re-crossing (preço cruza o nível, volta, cruza de novo) para garantir que não há disparos duplicados nem perdidos.
