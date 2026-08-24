"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type AlertType = "SUPPORT" | "RESISTANCE";

export interface AlertState {
  type: AlertType;
  price: number;
  timestamp: number;
  isVisible: boolean;
}

// AudioContext com fallback webkit (Safari), sem `any` explícito.
interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const playBeep = async () => {
  try {
    if (typeof window === "undefined") return;
    const AudioContextClass =
      window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextClass) return;

    const audioCtx = new AudioContextClass();

    // Aguarda a liberação do contexto caso esteja suspenso pelo navegador
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

    // CRÍTICO: evita vazamento de memória e exaustão do limite de AudioContext
    oscillator.onended = () => {
      audioCtx.close();
    };

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.5);
  } catch (error) {
    console.error("Erro ao tocar alerta de áudio (Autoplay block provável):", error);
  }
};

export function useSupportResistanceAlert({
  currentPrice,
  support,
  resistance,
  enabled = false,
  tolerancePercent = 0.1,
  cooldownMs = 300000, // 5 minutos
}: {
  currentPrice: number;
  support: number;
  resistance: number;
  enabled?: boolean;
  tolerancePercent?: number;
  cooldownMs?: number;
}) {
  const [alert, setAlert] = useState<AlertState | null>(null);

  // CRÍTICO: refs mantêm valores atualizados fora do ciclo de dependências,
  // evitando stale closure entre cruzamentos de preço.
  const previousPriceRef = useRef<number>(currentPrice);
  const lastAlertRef = useRef<{ type: AlertType; timestamp: number } | null>(null);

  const dismissAlert = useCallback(() => {
    setAlert((prev) => (prev ? { ...prev, isVisible: false } : null));
  }, []);

  useEffect(() => {
    if (!enabled || !currentPrice || !support || !resistance) {
      previousPriceRef.current = currentPrice;
      return;
    }

    const previousPrice = previousPriceRef.current;
    const tolerance = tolerancePercent / 100;

    const supportThreshold = support * (1 + tolerance);
    const resistanceThreshold = resistance * (1 - tolerance);
    const now = Date.now();

    const isCoolingDown = (type: AlertType) => {
      const last = lastAlertRef.current;
      return last && last.type === type && now - last.timestamp < cooldownMs;
    };

    // Cruzamento de suporte (preço caiu abaixo do suporte + tolerância)
    if (
      previousPrice > supportThreshold &&
      currentPrice <= supportThreshold &&
      !isCoolingDown("SUPPORT")
    ) {
      setAlert({ type: "SUPPORT", price: currentPrice, timestamp: now, isVisible: true });
      lastAlertRef.current = { type: "SUPPORT", timestamp: now };
      playBeep();
    }
    // Cruzamento de resistência (preço subiu acima da resistência - tolerância)
    else if (
      previousPrice < resistanceThreshold &&
      currentPrice >= resistanceThreshold &&
      !isCoolingDown("RESISTANCE")
    ) {
      setAlert({ type: "RESISTANCE", price: currentPrice, timestamp: now, isVisible: true });
      lastAlertRef.current = { type: "RESISTANCE", timestamp: now };
      playBeep();
    }

    previousPriceRef.current = currentPrice;
  }, [currentPrice, support, resistance, enabled, tolerancePercent, cooldownMs]);

  return { alert, dismissAlert };
}
