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
  score: number;
  score_quality: number;
  events: { type: string; magnitude: number; direction: string; timestamp: number }[];
  quality: { ws: string; oi: string; funding: string };
};

type Callbacks = {
  onData: (data: MarketStreamData) => void;
  onStatus: (status: MarketStreamStatus) => void;
};

const HEARTBEAT_MS = 5_000;
const BACKOFF_INITIAL = 1_000;
const BACKOFF_MAX = 15_000;

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

  const connect = useCallback(() => {
    if (stopped.current) return;

    setStatus(retries.current === 0 ? "connecting" : "reconnecting");

    const ws = new WebSocket(url);
    socket.current = ws;

    ws.onopen = () => {
      retries.current = 0;
      setStatus("live");
      resetHeartbeat();
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as MarketStreamData;
        setData(parsed);
        resetHeartbeat();
      } catch { /* drop */ }
    };

    ws.onerror = () => { ws.close(); };

    ws.onclose = () => {
      setStatus("disconnected");
      clearHeartbeat();
      if (!stopped.current) scheduleReconnect();
    };
  }, [url]);

  const scheduleReconnect = useCallback(() => {
    const delay = Math.min(BACKOFF_INITIAL * Math.pow(2, retries.current), BACKOFF_MAX);
    retries.current++;
    setTimeout(connect, delay);
  }, [connect]);

  const resetHeartbeat = useCallback(() => {
    clearHeartbeat();
    heartbeat.current = setTimeout(() => {
      socket.current?.close();
    }, HEARTBEAT_MS);
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeat.current) { clearTimeout(heartbeat.current); heartbeat.current = null; }
  }, []);

  useEffect(() => {
    if (!enabled) { setStatus("off"); return; }

    stopped.current = false;
    retries.current = 0;
    connect();

    return () => {
      stopped.current = true;
      clearHeartbeat();
      socket.current?.close();
      socket.current = null;
    };
  }, [enabled, connect, clearHeartbeat]);

  return { data, status };
}
