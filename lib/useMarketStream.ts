"use client";
import { useEffect, useRef, useState, useCallback } from "react";

export type MarketStreamStatus = "off" | "connecting" | "live" | "reconnecting" | "disconnected";

export type MarketStreamData = {
  ts: number;
  p: number;
  cvd: number;
  cvd_whale: number;
  imb: number;
  oi: number;
  oi_delta: number;
  funding: number;
  funding_class: string;
  regime: string;
  regime_volatility: number;
  regime_confidence: number;
  flow_regime: string;
  flow_strength: number;
  divergence: string;
  absorption_state: string;
  absorption_level: string;
  absorption_intensity: number;
  score: number;
  score_quality: number;
  events: { type: string; magnitude: number; direction: string; timestamp: number }[];
  quality: { ws: string; oi: string; funding: string };
};

const HEARTBEAT_MS = 5_000;
const BACKOFF_INITIAL = 1_000;
const BACKOFF_MAX = 15_000;

function resolveWsUrl(fallbackUrl: string): string {
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "ws://localhost:3001";
  }
  return fallbackUrl;
}

export function useMarketStream(url: string, enabled: boolean): {
  data: MarketStreamData | null;
  status: MarketStreamStatus;
} {
  const [data, setData] = useState<MarketStreamData | null>(null);
  const [status, setStatus] = useState<MarketStreamStatus>("off");
  const retries = useRef(0);
  const stopped = useRef(false);
  const socket = useRef<WebSocket | null>(null);
  const heartbeat = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnect = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeat.current) { clearTimeout(heartbeat.current); heartbeat.current = null; }
  }, []);

  const resetHeartbeat = useCallback(() => {
    clearHeartbeat();
    heartbeat.current = setTimeout(() => {
      socket.current?.close();
    }, HEARTBEAT_MS);
  }, [clearHeartbeat]);

  // `connect` e `scheduleReconnect` têm dependência circular (cada um chama o
  // outro). Para o React Compiler preservar a memoização, quebramos o ciclo com
  // refs que apontam para as implementações atuais, evitando referência cruzada
  // direta entre os dois useCallback.
  const connectRef = useRef<() => void>(() => {});
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    clearReconnect();
    const delay = Math.min(BACKOFF_INITIAL * Math.pow(2, retries.current), BACKOFF_MAX);
    retries.current++;
    reconnectTimer.current = setTimeout(connectRef.current, delay);
  }, [clearReconnect]);

  const connect = useCallback(() => {
    if (stopped.current) return;

    if (socket.current) {
      socket.current.close();
      socket.current = null;
    }

    setStatus(retries.current === 0 ? "connecting" : "reconnecting");

    const wsUrl = resolveWsUrl(url);
    const ws = new WebSocket(wsUrl);
    socket.current = ws;

    ws.onopen = () => {
      if (socket.current !== ws) return;
      retries.current = 0;
      setStatus("live");
      resetHeartbeat();
    };

    ws.onmessage = (event) => {
      if (socket.current !== ws) return;
      resetHeartbeat();
      try {
        const parsed = JSON.parse(event.data);
        setData(parsed);
      } catch {
        // payload malformado (daemon restart, rede) — ignora, mantém último estado válido
      }
    };

    ws.onerror = () => { ws.close(); };

    ws.onclose = () => {
      if (socket.current !== ws) return;
      clearHeartbeat();
      setStatus("disconnected");
      if (!stopped.current) scheduleReconnectRef.current();
    };
  }, [url, resetHeartbeat, clearHeartbeat]);

  // Mantém as refs sincronizadas fora do render (o React Compiler proíbe
  // atribuir refs durante o render).
  useEffect(() => {
    connectRef.current = connect;
    scheduleReconnectRef.current = scheduleReconnect;
  }, [connect, scheduleReconnect]);

  useEffect(() => {
    if (!enabled) { setStatus("off"); return; }

    stopped.current = false;
    retries.current = 0;
    connect();

    return () => {
      stopped.current = true;
      clearReconnect();
      clearHeartbeat();
      if (socket.current) {
        socket.current.close();
      }
      socket.current = null;
    };
  }, [enabled, connect, clearReconnect, clearHeartbeat]);

  return { data, status };
}
