"use client";

// app/GlobalAlertContext.tsx
// Motor global de alertas de suporte/resistência (alerta2.md).
// Isola o monitoramento de preço do componente visual: os alertas funcionam
// para todos os ativos do feed (livePrices), independentemente do ativo
// selecionado ou renderizado no momento.

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

// Ativos pré-cadastrados: fonte separada do motor. Adicionar um ativo novo
// aqui NÃO exige tocar na lógica do provider. enabled:false — são
// pré-configurados, não pré-ativados (o usuário liga via toggleAlert).
// Chaves usam o símbolo BASE ("BTC") — mesma convenção do gráfico e do
// useLivePrices (que monta "BTCUSDT" no stream, mas entrega a chave "BTC").
const PREDEFINED_ALERTS: Record<string, AssetAlertConfig> = {
  BTC: { symbol: "BTC", support: 110000, resistance: 115000, enabled: false, source: "PREDEFINED" },
  ETH: { symbol: "ETH", support: 4400, resistance: 4800, enabled: false, source: "PREDEFINED" },
  SOL: { symbol: "SOL", support: 220, resistance: 250, enabled: false, source: "PREDEFINED" },
};

function loadPersistedConfigs(): Record<string, AssetAlertConfig> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, AssetAlertConfig>;
    // Mescla o persistido com os pré-cadastrados (novos ativos desde o save).
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
  // e só troca para o persistido dentro de um useEffect (pós-hidratação) —
  // lazy initializer no useState geraria mismatch de hidratação no Next.
  const [configs, setConfigs] = useState<Record<string, AssetAlertConfig>>(PREDEFINED_ALERTS);

  const [activeAlerts, setActiveAlerts] = useState<TriggeredAlert[]>([]);
  const prevPricesRef = useRef<Record<string, number>>({});

  // Hidrata a partir do localStorage após o mount no client.
  useEffect(() => {
    const persisted = loadPersistedConfigs();
    if (persisted) setConfigs(persisted);
  }, []);

  // Persistência: salva apenas QUAIS alertas estão ativos e seus níveis.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    } catch {
      // storage cheio/indisponível — ignora
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
    [],
  );

  useEffect(() => {
    // O loop percorre livePrices (não configs): prevPricesRef é atualizado
    // para TODOS os ativos que chegam no feed — inclusive os que ainda não têm
    // config. Quando o ativo for cadastrado/ativado depois, o motor já conhece
    // o preço anterior e não dispara de forma espúria.
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

        // Primeiro acionamento: cria e ativa capturando os níveis atuais.
        if (!existing) {
          return {
            ...prev,
            [symbol]: { symbol, support, resistance, enabled: true, source },
          };
        }

        // ATIVO -> desativa SEM alterar os níveis congelados.
        if (existing.enabled) {
          return {
            ...prev,
            [symbol]: { ...existing, enabled: false },
          };
        }

        // DESATIVADO -> reativa capturando os níveis atuais (substitui).
        return {
          ...prev,
          [symbol]: { ...existing, support, resistance, source, enabled: true },
        };
      });
    },
    [],
  );

  const updateConfigLevels = useCallback(
    (symbol: string, support: number, resistance: number, source: AlertLevelSource = "GRAPH") => {
      setConfigs((prev) => {
        const existing = prev[symbol];

        if (!existing) {
          // Primeira vez que o gráfico calcula níveis: cria desabilitado.
          return { ...prev, [symbol]: { symbol, support, resistance, enabled: false, source } };
        }

        // Congelamento: enquanto ATIVO, não sobrescreve níveis silenciosamente.
        if (existing.enabled) return prev;

        if (existing.support === support && existing.resistance === resistance) return prev;

        return {
          ...prev,
          [symbol]: { ...existing, support, resistance, source },
        };
      });
    },
    [],
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
