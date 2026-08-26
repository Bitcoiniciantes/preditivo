"use client";
// Provedor único do stream do daemon local (ws://localhost:3001). Todos os cards
// observacionais consomem o MESMO WebSocket via contexto — uma única conexão.
import { createContext, useContext } from "react";
import { useMarketStream, type MarketStreamData, type MarketStreamStatus } from "../lib/useMarketStream";

const WS_URL = process.env.NEXT_PUBLIC_MARKET_WS_URL || "ws://localhost:3001";

type StreamValue = { data: MarketStreamData | null; status: MarketStreamStatus };

const MarketStreamContext = createContext<StreamValue>({ data: null, status: "off" });

export function MarketStreamProvider({ children }: { children: React.ReactNode }) {
  const value = useMarketStream(WS_URL, true);
  return <MarketStreamContext.Provider value={value}>{children}</MarketStreamContext.Provider>;
}

export function useMarketStreamContext(): StreamValue {
  return useContext(MarketStreamContext);
}
