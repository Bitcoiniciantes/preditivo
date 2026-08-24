"use client";

// lib/useLivePrices.ts
// Correção do pré-requisito crítico (alerta2.md, seção 7): o feed ao vivo deve
// cobrir TODOS os ativos com alerta possível simultaneamente — não apenas o
// ativo selecionado no gráfico. Usa um único WebSocket combinado da Binance
// (streams) e mantém um objeto persistente Record<symbol, price>.
//
// Símbolos são chaves base ("BTC", "ETH"...) — o sufixo usdt@ticker é montado
// aqui. Ativos estáticos (MSTR, PRATA, COBRE, URÂNIO) não têm stream ao vivo
// da Binance e ficam de fora (o motor não dispara para eles).

import { useEffect, useRef, useState } from "react";

export type LivePrices = Record<string, number>;

const STREAM_URL = "wss://data-stream.binance.vision/stream?streams=";

export function livePriceStreamUrl(symbols: string[]): string {
  const streams = symbols
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9]{2,20}$/.test(s))
    .map((s) => `${s}usdt@ticker`);
  return STREAM_URL + streams.join("/");
}

type Status = "off" | "connecting" | "live" | "reconnecting" | "disconnected";

export function useLivePrices(symbols: string[], enabled = true): {
  livePrices: LivePrices;
  status: Status;
} {
  const [livePrices, setLivePrices] = useState<LivePrices>({});
  const [status, setStatus] = useState<Status>("off");
  const socketRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const stoppedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const lastTickAtRef = useRef(0);

  const symbolsKey = symbols.join(",");

  useEffect(() => {
    if (!enabled || symbols.length === 0) {
      setStatus("off");
      return;
    }

    stoppedRef.current = false;
    retriesRef.current = 0;

    const url = livePriceStreamUrl(symbols);
    let socket: WebSocket | null = null;

    const clearTimers = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatTimerRef.current !== null) {
        window.clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };

    const connect = () => {
      if (stoppedRef.current) return;
      clearTimers();
      setStatus(retriesRef.current === 0 ? "connecting" : "reconnecting");

      socket = new WebSocket(url);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (socketRef.current !== socket) return;
        retriesRef.current = 0;
        lastTickAtRef.current = Date.now();
        setStatus("live");
        heartbeatTimerRef.current = window.setInterval(() => {
          if (Date.now() - lastTickAtRef.current > 5_000) socket?.close();
        }, 1_000);
      });

      socket.addEventListener("message", (event) => {
        if (socketRef.current !== socket) return;
        lastTickAtRef.current = Date.now();
        try {
          const parsed = JSON.parse(event.data);
          const stream = parsed?.stream as string | undefined;
          const data = parsed?.data as { c?: unknown } | undefined;
          const price = Number(data?.c);
          if (stream && Number.isFinite(price) && price > 0) {
            const symbol = stream.replace("usdt@ticker", "").toUpperCase();
            if (symbol) {
              // Atualização incremental: mantém símbolos anteriores que não
              // vieram neste tick (persistência entre atualizações).
              setLivePrices((prev) => ({ ...prev, [symbol]: price }));
            }
          }
        } catch {
          // payload malformado — ignora e mantém o último estado válido
        }
      });

      socket.addEventListener("error", () => socket?.close());

      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) return;
        if (heartbeatTimerRef.current !== null) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (stoppedRef.current) return;
        setStatus("disconnected");
        retriesRef.current += 1;
        const delay = Math.min(1_000 * 2 ** Math.min(retriesRef.current - 1, 4), 15_000);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      stoppedRef.current = true;
      clearTimers();
      if (socket) {
        socket.close();
      }
      socketRef.current = null;
      setStatus("off");
    };
  }, [symbolsKey, enabled]);

  return { livePrices, status };
}
