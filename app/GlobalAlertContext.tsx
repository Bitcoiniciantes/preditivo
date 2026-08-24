"use client";

// app/GlobalAlertContext.tsx
// ============================================================================
// MOTOR GLOBAL DE ALERTAS DE SUPORTE/RESISTÊNCIA — FASE 1 (ALERTA_PAINEL.md V4)
// ============================================================================
// Arquitetura:
//   AlertEngine (feed multi-ativo) → livePrices → este contexto (useReducer
//   100% determinístico) → AlertPanel (Fase 1) / Renderer (Fase 2).
//
// Regras V4 aplicadas:
//   1. Nenhum Date.now() dentro do reducer — o tempo é sempre injetado pelas
//      actions (PRICE_UPDATE, REGISTER, ACKNOWLEDGE) via `timestamp`.
//   2. `frozen` foi removido. A autoridade única de congelamento é
//      `frozenUntil: number | null`, avaliada comparando o timestamp injetado
//      com frozenUntil.
//   3. HYDRATE reconstrói lastPrice: null e lastCrossover: "none" — o primeiro
//      preço após F5 vira baseline; lacunas de mercado enquanto o app estava
//      fechado NÃO são interpretadas como crossover.
//   4. TOGGLE (reativar) abre uma sessão de monitoramento totalmente limpa.
//   5. REMOVE limpa configs, states e events do símbolo.
//   6. lastPrice NÃO é persistido (fica fora do PersistedAlertState).
//   7. O painel NÃO calcula S/R — recebe do Gráfico/Structure Engine via
//      registerAlert(). Não possui motor próprio.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";

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

// Tipo exato do que vai para o LocalStorage (lastPrice/lastCrossover ficam fora)
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

// Uso externo para componentes UI. O reducer usa avaliação direta para manter
// a pureza; esta função recebe o timestamp explícito (consistência da API V4).
export const isAlertFrozen = (state: AlertState, timestamp: number): boolean =>
  state.frozenUntil !== null && timestamp < state.frozenUntil;

// ============================================================================
// REDUCER (Puro e 100% Determinístico — sem Date.now())
// ============================================================================

function alertReducer(state: State, action: Action): State {
  switch (action.type) {
    case "HYDRATE": {
      const hydratedStates: Record<string, AlertState> = {};

      // Reconstrói o estado completo assegurando baseline nulo
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

        // Baseline tick: primeiro preço capturado define a referência
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

        const previousPrice = currentState.lastPrice as number;
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
            lastPrice: null, // permite que o primeiro tick defina a referência
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
        events: state.events.filter((e) => e.symbol !== symbol), // remove eventos atrelados
      };
    }

    case "TOGGLE": {
      const { symbol } = action;
      const config = state.configs[symbol];
      if (!config) return state;

      const newEnabled = !config.enabled;
      const currentState = state.states[symbol];

      // Se ativado novamente, inicia uma nova sessão de monitoramento limpa
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

// ── Sincronização remota (mesmo padrão do PositionPanel) ──
// Espelha os alertas entre dispositivos (mobile ↔ notebook) via Worker.
// - GET:  lê { configs, states, updatedAt } da conta "alerts"
// - POST: grava { configs, states } e recebe updatedAt de volta
// - updatedAt resolve conflitos: só aplica remoto se for mais novo
// - push acontece SOMENTE em ação do usuário (flag userActionRef) — o HYDRATE
//   vindo de um pull remoto NÃO gera push de volta (evita loop de eco)
const ALERTS_SYNC_URL =
  "https://bitcoiniciantes-ia.bitcoiniciantes.workers.dev/api/public-positions?account=alerts";

function cleanRemoteConfigs(value: unknown): Record<string, AlertConfig> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, AlertConfig> = {};
  for (const [symbol, raw] of Object.entries(value as Record<string, unknown>)) {
    const c = raw as Partial<AlertConfig> | undefined;
    if (
      c && typeof c === "object" &&
      typeof c.symbol === "string" &&
      Number.isFinite(c.support) && (c.support as number) > 0 &&
      Number.isFinite(c.resistance) && (c.resistance as number) > 0 &&
      typeof c.period === "string" &&
      Number.isFinite(c.createdAt) &&
      typeof c.enabled === "boolean"
    ) {
      out[symbol] = { symbol: c.symbol, support: c.support as number, resistance: c.resistance as number, period: c.period, createdAt: c.createdAt as number, enabled: c.enabled };
    }
  }
  return out;
}

function cleanRemoteStates(value: unknown): Record<string, PersistedAlertState> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, PersistedAlertState> = {};
  for (const [symbol, raw] of Object.entries(value as Record<string, unknown>)) {
    const s = raw as Partial<PersistedAlertState> | undefined;
    if (s && typeof s === "object" && typeof s.symbol === "string") {
      out[symbol] = {
        symbol: s.symbol,
        triggered: Boolean(s.triggered),
        triggeredLevel: Number.isFinite(s.triggeredLevel as number) ? (s.triggeredLevel as number) : null,
        triggeredType: s.triggeredType === "SUPPORT_HIT" || s.triggeredType === "RESISTANCE_HIT" ? s.triggeredType : null,
        triggeredAt: Number.isFinite(s.triggeredAt as number) ? (s.triggeredAt as number) : null,
        acknowledgedAt: Number.isFinite(s.acknowledgedAt as number) ? (s.acknowledgedAt as number) : null,
        frozenUntil: Number.isFinite(s.frozenUntil as number) ? (s.frozenUntil as number) : null,
      };
    }
  }
  return out;
}

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

  // ── Chaves estáveis de persistência ──
  // Só mudam quando um campo PERSISTÍVEL muda (register/toggle/trigger/
  // acknowledge/remove) — nunca por causa de lastPrice/lastCrossover, que
  // são atualizados a cada tick e NÃO são persistidos.
  const persistedConfigsKey = JSON.stringify(state.configs);

  const persistedStatesKey = useMemo(() => {
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
    return JSON.stringify(stateToPersist);
  }, [state.states]);

  // ── Sincronização remota (espelho mobile ↔ notebook) ──
  // updatedAt do Worker é a autoridade de conflito: só aplica remoto se for
  // mais novo que o último visto. userActionRef marca mudanças feitas pelo
  // usuário neste dispositivo — o push remoto só ocorre nesses casos (evita
  // loop de eco quando um pull remoto re-hidrata o estado local).
  const remoteUpdatedAtRef = useRef(0);
  const userActionRef = useRef(false);

  const pullRemote = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(ALERTS_SYNC_URL, { cache: "no-store" });
      if (!response.ok) return false;
      const data: unknown = await response.json();
      const remote = data && typeof data === "object" ? data as { configs?: unknown; states?: unknown; updatedAt?: unknown } : {};
      const updatedAt = Number(remote.updatedAt) || 0;
      if (updatedAt && updatedAt > remoteUpdatedAtRef.current) {
        remoteUpdatedAtRef.current = updatedAt;
        const nextConfigs = cleanRemoteConfigs(remote.configs);
        const nextStates = cleanRemoteStates(remote.states);
        dispatch({ type: "HYDRATE", configs: nextConfigs, states: nextStates });
        return true;
      }
      return Boolean(updatedAt);
    } catch {
      return false;
    }
  }, []);

  const pushRemote = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(ALERTS_SYNC_URL, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configs: state.configs,
          states: Object.fromEntries(
            Object.entries(state.states).map(([symbol, s]) => [
              symbol,
              {
                symbol: s.symbol,
                triggered: s.triggered,
                triggeredLevel: s.triggeredLevel,
                triggeredType: s.triggeredType,
                triggeredAt: s.triggeredAt,
                acknowledgedAt: s.acknowledgedAt,
                frozenUntil: s.frozenUntil,
              },
            ]),
          ),
        }),
      });
      if (!response.ok) return;
      const data: unknown = await response.json();
      const updatedAt = Number(data && typeof data === "object" ? (data as { updatedAt?: unknown }).updatedAt : 0) || 0;
      if (updatedAt) remoteUpdatedAtRef.current = updatedAt;
    } catch {
      // offline — mantém local; próximo pull convergirá
    }
  }, [state.configs, state.states]);

  // Polling: espelha mudanças feitas em outro dispositivo a cada 5s e ao
  // voltar para a aba (mesmo comportamento do PositionPanel).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => { void pullRemote(); }, 2000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pullRemote();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pullRemote]);

  // Push remoto: apenas quando o USUÁRIO altera (register/toggle/remove/ack).
  // Dispara quando as chaves persistíveis mudam e a origem foi ação do usuário.
  useEffect(() => {
    if (!userActionRef.current) return;
    userActionRef.current = false;
    void pushRemote();
  }, [persistedConfigsKey, persistedStatesKey, pushRemote]);

  // Carregamento inicial (Hydration) — baseline reconstruído nulo.
  // Depois da hidratação local, puxa o espelho remoto (mobile ↔ notebook).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const start = async () => {
      try {
        const savedConfigs = localStorage.getItem("termometro-alerts-config");
        const savedStates = localStorage.getItem("termometro-alerts-state");

        const parsedConfigs = savedConfigs ? JSON.parse(savedConfigs) : null;
        const parsedStates = savedStates ? JSON.parse(savedStates) : null;

        if (parsedConfigs || parsedStates) {
          dispatch({
            type: "HYDRATE",
            configs: typeof parsedConfigs === "object" && parsedConfigs !== null ? parsedConfigs : {},
            states: typeof parsedStates === "object" && parsedStates !== null ? parsedStates : {},
          });
        }

        // Espelho remoto: se o Worker tiver estado mais novo (updatedAt), aplica.
        const foundRemote = await pullRemote();
        if (!active) return;
        if (!foundRemote) {
          // Primeiro uso no Worker (ou Worker vazio): envia o estado local.
          await pushRemote();
        }
      } catch (error) {
        console.error("Erro ao carregar alertas:", error);
      }
    };
    void start();
    return () => { active = false; };
  }, []);

  // Dispatch livePrices puro para o motor (tempo injetado no dispatcher)
  useEffect(() => {
    dispatch({
      type: "PRICE_UPDATE",
      livePrices,
      timestamp: Date.now(),
    });
  }, [livePrices]);

  // ── Persistência (corrigida) ──
  // IMPORTANTE: NÃO usar `state.states` diretamente como dependência — ele
  // muda a cada tick de preço (lastPrice é atualizado continuamente), o que
  // reiniciaria o debounce a cada segundo e o save nunca dispararia (por isso
  // os alertas sumiam no F5). Derivamos strings ESTÁVEIS: só mudam quando um
  // campo PERSISTÍVEL muda (register/toggle/trigger/acknowledge/remove),
  // nunca por causa de lastPrice/lastCrossover (que não são persistidos).
  useEffect(() => {
    if (typeof window === "undefined") return;

    const timeout = setTimeout(() => {
      try {
        localStorage.setItem("termometro-alerts-config", persistedConfigsKey);
        localStorage.setItem("termometro-alerts-state", persistedStatesKey);
      } catch (error) {
        console.error("Erro ao persistir alertas:", error);
      }
    }, 100);

    return () => clearTimeout(timeout);
  }, [persistedConfigsKey, persistedStatesKey]);

  // APIs Expostas (injeção de tempo feita no dispatcher).
  // Todas marcam userActionRef — o push remoto só ocorre em ação do usuário.
  const registerAlert = (config: Omit<AlertConfig, "createdAt" | "enabled">) => {
    userActionRef.current = true;
    dispatch({ type: "REGISTER", config, timestamp: Date.now() });
  };

  const removeAlert = (symbol: string) => {
    userActionRef.current = true;
    dispatch({ type: "REMOVE", symbol });
  };

  const toggleAlert = (symbol: string) => {
    userActionRef.current = true;
    dispatch({ type: "TOGGLE", symbol });
  };

  const acknowledgeAlert = (symbol: string) => {
    userActionRef.current = true;
    dispatch({ type: "ACKNOWLEDGE", symbol, timestamp: Date.now() });
  };

  return (
    <GlobalAlertContext.Provider
      value={{
        alertConfigs: state.configs,
        alertStates: state.states,
        alertEvents: state.events,
        registerAlert,
        removeAlert,
        toggleAlert,
        acknowledgeAlert,
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
