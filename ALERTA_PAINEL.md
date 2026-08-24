# PLANEJAMENTO FASE 1 - FINAL CORRIGIDO (V4)

**Data:** 24/08/2026  
**Status:** Especificação fechada e pronta para implementação

---

## VISÃO GERAL DA ARQUITETURA

A arquitetura define um fluxo estrito onde o painel atua apenas como consumidor e gerenciador de estados, isolando a lógica de mercado no motor global.

```text
                    PREÇO AO VIVO
                         │
                         ▼
                   AlertEngine
                         │
                         ▼
                    livePrices
                         │
                         ▼
              ┌─────────────────────┐
              │ GlobalAlertContext  │
              │                     │
              │ Configs             │
              │ States              │
              │ Crossover           │
              │ Freeze              │
              │ Events              │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        AlertPanel              futuro
        Fase 1                  Renderer
                                  Fase 2
```

---

## REGRAS DE NEGÓCIO E CORREÇÕES TÉCNICAS APLICADAS

### 1. Concorrência e Motor de Eventos (useReducer 100% Determinístico)
Todo o cálculo de estado e eventos é centralizado em um `useReducer` puramente determinístico. Nenhuma chamada a `Date.now()` ocorre dentro do reducer; o tempo é sempre injetado via `timestamp` pelas actions (`PRICE_UPDATE`, `REGISTER`, `ACKNOWLEDGE`). Isso garante execução atômica e segura em React concorrente.

### 2. Fonte Única de Verdade para Congelamento
O estado `frozen` foi removido. A propriedade persistida é apenas `frozenUntil` (`number | null`). O congelamento é avaliado dinamicamente comparando o `timestamp` injetado pelo loop do motor com `frozenUntil`.

### 3. Gerenciamento e Hidratação de Estado (HYDRATE)
A restauração do estado após um `reload` (F5) utiliza uma action `HYDRATE`. Essa action recebe um `PersistedAlertState` (refletindo exatamente o que está no localStorage) e reconstrói o objeto completo injetando `lastPrice: null` e `lastCrossover: "none"`. Isso garante a reconstrução segura do baseline sem sobrescrever dados históricos.

### 4. Alternância com Reset Completo de Sessão (toggleAlert)
O contexto disponibiliza `toggleAlert`. Quando um alerta inativo é reativado pelo painel, o reducer limpa completamente os estados da sessão anterior (`lastPrice`, `triggered`, `frozenUntil`, etc). O alerta volta limpo, e o primeiro tick atuará como o novo baseline.

### 5. Responsabilidade do Cálculo de S/R Isolada
**O AlertPanel NÃO calcula S/R.** Na Fase 1, o painel recebe níveis calculados exclusivamente pela interface do gráfico (Structure Engine). O fluxo segue: `Gráfico calcula S/R → registerAlert() → GlobalAlertContext monitora`.

---

## IMPLEMENTAÇÃO: GlobalAlertContext.tsx

**Arquivo:** `app/GlobalAlertContext.tsx`

```typescript
"use client";

import { createContext, useContext, useEffect, useReducer } from "react";

// ============================================================================
// TIPOS
// ============================================================================

export type AlertConfig = {
  symbol: string;
  support: number;
  resistance: number;
  period: string;
  createdAt: number;
  enabled: boolean;
};

export type AlertState = {
  symbol: string;
  lastPrice: number | null;
  lastCrossover: "none" | "support" | "resistance";
  triggered: boolean;
  triggeredLevel: number | null;
  triggeredType: "SUPPORT_HIT" | "RESISTANCE_HIT" | null;
  triggeredAt: number | null;
  acknowledgedAt: number | null;
  frozenUntil: number | null; 
};

// Tipo exato do que vai para o LocalStorage
export type PersistedAlertState = Omit<AlertState, "lastPrice" | "lastCrossover">;

export type AlertEvent = {
  type: "SUPPORT_HIT" | "RESISTANCE_HIT";
  symbol: string;
  level: number;
  price: number;
  timestamp: number;
  period: string;
};

type State = {
  configs: Record<string, AlertConfig>;
  states: Record<string, AlertState>;
  events: AlertEvent[];
};

type Action =
  | { type: "PRICE_UPDATE"; livePrices: Record<string, number>; timestamp: number }
  | { type: "REGISTER"; config: Omit<AlertConfig, "createdAt" | "enabled">; timestamp: number }
  | { type: "REMOVE"; symbol: string }
  | { type: "TOGGLE"; symbol: string }
  | { type: "ACKNOWLEDGE"; symbol: string; timestamp: number }
  | { type: "HYDRATE"; configs: Record<string, AlertConfig>; states: Record<string, PersistedAlertState> };

type GlobalAlertContextValue = {
  alertConfigs: Record<string, AlertConfig>;
  alertStates: Record<string, AlertState>;
  alertEvents: AlertEvent[];
  registerAlert: (config: Omit<AlertConfig, "createdAt" | "enabled">) => void;
  removeAlert: (symbol: string) => void;
  toggleAlert: (symbol: string) => void;
  acknowledgeAlert: (symbol: string) => void;
};

// ============================================================================
// HELPERS
// ============================================================================

// Uso externo para componentes UI (O reducer usa avaliação direta para pureza)
export const isAlertFrozen = (state: AlertState): boolean =>
  state.frozenUntil !== null && Date.now() < state.frozenUntil;

// ============================================================================
// REDUCER (Puro e 100% Determinístico)
// ============================================================================

function alertReducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE": {
      const hydratedStates: Record<string, AlertState> = {};
      
      // Reconstrói o estado completo assegurando a nulidade do baseline (lastPrice e lastCrossover)
      for (const symbol in action.states) {
        const saved = action.states[symbol];
        hydratedStates[symbol] = {
          symbol: saved.symbol,
          lastPrice: null,
          lastCrossover: "none",
          triggered: saved.triggered ?? false,
          triggeredLevel: saved.triggeredLevel ?? null,
          triggeredType: saved.triggeredType ?? null,
          triggeredAt: saved.triggeredAt ?? null,
          acknowledgedAt: saved.acknowledgedAt ?? null,
          frozenUntil: saved.frozenUntil ?? null,
        };
      }

      return {
        ...state,
        configs: action.configs,
        states: hydratedStates,
      };
    }

    case "PRICE_UPDATE": {
      const { livePrices, timestamp: now } = action;
      
      let newEvents = [...state.events];
      const newStates = { ...state.states };
      let hasChanges = false;

      for (const symbol in state.configs) {
        const config = state.configs[symbol];
        if (!config.enabled) continue;

        let currentState = newStates[symbol];

        if (!currentState) {
          currentState = {
            symbol,
            lastPrice: null,
            lastCrossover: "none",
            triggered: false,
            triggeredLevel: null,
            triggeredType: null,
            triggeredAt: null,
            acknowledgedAt: null,
            frozenUntil: null,
          };
          newStates[symbol] = currentState;
          hasChanges = true;
        }

        const currentPrice = livePrices[symbol];
        if (currentPrice === undefined) continue;

        // Baseline tick: Primeiro preço capturado define a referência
        if (currentState.lastPrice === null) {
          newStates[symbol] = { ...currentState, lastPrice: currentPrice };
          hasChanges = true;
          continue;
        }

        // Limpeza de expiração do freeze baseada no timestamp puro
        if (currentState.frozenUntil !== null && now >= currentState.frozenUntil) {
          newStates[symbol] = {
            ...currentState,
            frozenUntil: null,
            triggered: false,
            triggeredType: null,
            triggeredLevel: null,
            triggeredAt: null,
          };
          hasChanges = true;
          currentState = newStates[symbol];
        }

        // Bloqueio se estiver congelado
        const isFrozen = currentState.frozenUntil !== null && now < currentState.frozenUntil;
        if (isFrozen) {
          if (currentState.lastPrice !== currentPrice) {
             newStates[symbol] = { ...currentState, lastPrice: currentPrice };
             hasChanges = true;
          }
          continue;
        }

        const previousPrice = currentState.lastPrice;
        const { support, resistance } = config;

        // CROSSOVER - SUPORTE
        if (previousPrice > support && currentPrice <= support) {
          newEvents = [
            ...newEvents,
            {
              type: "SUPPORT_HIT",
              symbol,
              level: support,
              price: currentPrice,
              timestamp: now,
              period: config.period,
            },
          ];

          newStates[symbol] = {
            ...currentState,
            lastPrice: currentPrice,
            lastCrossover: "support",
            triggered: true,
            frozenUntil: now + 3600000, // Congela por 1h
            triggeredLevel: support,
            triggeredType: "SUPPORT_HIT",
            triggeredAt: now,
          };
          hasChanges = true;
          continue;
        }

        // CROSSOVER - RESISTÊNCIA
        if (previousPrice < resistance && currentPrice >= resistance) {
          newEvents = [
            ...newEvents,
            {
              type: "RESISTANCE_HIT",
              symbol,
              level: resistance,
              price: currentPrice,
              timestamp: now,
              period: config.period,
            },
          ];

          newStates[symbol] = {
            ...currentState,
            lastPrice: currentPrice,
            lastCrossover: "resistance",
            triggered: true,
            frozenUntil: now + 3600000, // Congela por 1h
            triggeredLevel: resistance,
            triggeredType: "RESISTANCE_HIT",
            triggeredAt: now,
          };
          hasChanges = true;
          continue;
        }

        // Atualização contínua do preço de referência
        if (currentPrice !== previousPrice) {
          newStates[symbol] = { ...currentState, lastPrice: currentPrice };
          hasChanges = true;
        }
      }

      return hasChanges
        ? { ...state, states: newStates, events: newEvents }
        : state;
    }

    case "REGISTER": {
      const { config, timestamp } = action;
      const { symbol } = config;
      
      return {
        ...state,
        configs: {
          ...state.configs,
          [symbol]: {
            ...config,
            createdAt: timestamp,
            enabled: true,
          },
        },
        states: {
          ...state.states,
          [symbol]: {
            symbol,
            lastPrice: null, // Permite que o primeiro tick defina a referência inicial
            lastCrossover: "none",
            triggered: false,
            triggeredLevel: null,
            triggeredType: null,
            triggeredAt: null,
            acknowledgedAt: null,
            frozenUntil: null,
          },
        },
      };
    }

    case "REMOVE": {
      const { symbol } = action;
      const newConfigs = { ...state.configs };
      const newStates = { ...state.states };
      delete newConfigs[symbol];
      delete newStates[symbol];

      return {
        ...state,
        configs: newConfigs,
        states: newStates,
        events: state.events.filter((e) => e.symbol !== symbol), // Remove eventos atrelados
      };
    }

    case "TOGGLE": {
      const { symbol } = action;
      const config = state.configs[symbol];
      if (!config) return state;

      const newEnabled = !config.enabled;
      const currentState = state.states[symbol];

      // Se ativado novamente, inicia uma nova sessão de monitoramento totalmente limpa
      const updatedState = newEnabled
        ? {
            ...currentState,
            lastPrice: null,
            lastCrossover: "none" as const,
            triggered: false,
            triggeredLevel: null,
            triggeredType: null,
            triggeredAt: null,
            frozenUntil: null,
          }
        : currentState;

      return {
        ...state,
        configs: {
          ...state.configs,
          [symbol]: { ...config, enabled: newEnabled },
        },
        states: {
          ...state.states,
          [symbol]: updatedState,
        },
      };
    }

    case "ACKNOWLEDGE": {
      const { symbol, timestamp } = action;
      const currentState = state.states[symbol];
      if (!currentState) return state;

      return {
        ...state,
        states: {
          ...state.states,
          [symbol]: { ...currentState, acknowledgedAt: timestamp },
        },
        events: state.events.filter((e) => e.symbol !== symbol),
      };
    }

    default:
      return state;
  }
}

// ============================================================================
// CONTEXT & PROVIDER
// ============================================================================

const GlobalAlertContext = createContext<GlobalAlertContextValue | null>(null);

export function GlobalAlertProvider({
  children,
  livePrices,
}: {
  children: React.ReactNode;
  livePrices: Record<string, number>;
}) {
  const [state, dispatch] = useReducer(alertReducer, {
    configs: {},
    states: {},
    events: [],
  });

  // Carregamento inicial (Hydration)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedConfigs = localStorage.getItem("termometro-alerts-config");
      const savedStates = localStorage.getItem("termometro-alerts-state");

      // Sanitização básica opcional
      const parsedConfigs = savedConfigs ? JSON.parse(savedConfigs) : null;
      const parsedStates = savedStates ? JSON.parse(savedStates) : null;

      if (parsedConfigs || parsedStates) {
        dispatch({
          type: "HYDRATE",
          configs: typeof parsedConfigs === 'object' && parsedConfigs !== null ? parsedConfigs : {},
          states: typeof parsedStates === 'object' && parsedStates !== null ? parsedStates : {},
        });
      }
    } catch (error) {
      console.error("Erro ao carregar alertas:", error);
    }
  }, []);

  // Dispatch livePrices puro para o motor
  useEffect(() => {
    dispatch({ 
      type: "PRICE_UPDATE", 
      livePrices, 
      timestamp: Date.now() 
    });
  }, [livePrices]);

  // Persistência com Debounce
  useEffect(() => {
    if (typeof window === "undefined") return;

    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(
          "termometro-alerts-config",
          JSON.stringify(state.configs)
        );

        // Omitindo lastPrice e lastCrossover da persistência para poupar gravações inúteis
        const stateToPersist: Record<string, PersistedAlertState> = {};
        for (const symbol in state.states) {
          const s = state.states[symbol];
          stateToPersist[symbol] = {
            symbol: s.symbol,
            triggered: s.triggered,
            triggeredLevel: s.triggeredLevel,
            triggeredType: s.triggeredType,
            triggeredAt: s.triggeredAt,
            acknowledgedAt: s.acknowledgedAt,
            frozenUntil: s.frozenUntil,
          };
        }
        localStorage.setItem("termometro-alerts-state", JSON.stringify(stateToPersist));
      } catch (error) {
        console.error("Erro ao persistir alertas:", error);
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [state.configs, state.states]);

  // APIs Expostas (Injeção de tempo feita no dispatcher)
  const registerAlert = (config: Omit<AlertConfig, "createdAt" | "enabled">) => 
    dispatch({ type: "REGISTER", config, timestamp: Date.now() });
    
  const removeAlert = (symbol: string) => 
    dispatch({ type: "REMOVE", symbol });
    
  const toggleAlert = (symbol: string) => 
    dispatch({ type: "TOGGLE", symbol });
    
  const acknowledgeAlert = (symbol: string) => 
    dispatch({ type: "ACKNOWLEDGE", symbol, timestamp: Date.now() });

  return (
    <GlobalAlertContext.Provider 
      value={{ 
        alertConfigs: state.configs, 
        alertStates: state.states, 
        alertEvents: state.events, 
        registerAlert, 
        removeAlert, 
        toggleAlert, 
        acknowledgeAlert 
      }}
    >
      {children}
    </GlobalAlertContext.Provider>
  );
}

export function useGlobalAlerts() {
  const context = useContext(GlobalAlertContext);
  if (!context) throw new Error("useGlobalAlerts deve ser encapsulado por GlobalAlertProvider");
  return context;
}
```

---

## CHECKLIST DE IMPLEMENTAÇÃO FASE 1

### Parte 1A: Motor Global (GlobalAlertContext)
- [ ] 1. Criar `GlobalAlertContext.tsx` e implementar `useReducer` 100% puro e determinístico, sem injetar dados temporais por conta própria.
- [ ] 2. Passar `timestamp` nas actions (`PRICE_UPDATE`, `REGISTER`, `ACKNOWLEDGE`) para isolar os side-effects no dispatcher.
- [ ] 3. Criar action de `HYDRATE` com sanitização e injeção explícita de campos nulos faltantes (`lastPrice` e `lastCrossover`), garantindo tipagem consistente de leitura do localStorage.
- [ ] 4. Atualizar a lógica da action `TOGGLE` para destruir completamente qualquer lixo de estado de monitoramento residual ao reativar um ativo (resetando para a estaca zero).
- [ ] 5. Confirmar que a action `REMOVE` expele também os eventos atrelados do array `alertEvents`.

### Parte 1B: Interface de Gerenciamento (AlertPanel)
- [ ] 6. Criar componente isolado `AlertPanel.tsx`.
- [ ] 7. Ler S/R proveniente apenas do Structure Engine/Gráfico, acionando a API `registerAlert`.
- [ ] 8. Ancorar botões/switches de ativar/desativar na function `toggleAlert`.
- [ ] 9. Fornecer botão de exclusão vinculado ao método `removeAlert`.
- [ ] 10. Montar a lista (tabela ou card) limitando-se ao consumo de dados gerados no contexto.
