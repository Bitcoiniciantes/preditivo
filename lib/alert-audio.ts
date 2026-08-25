"use client";

// lib/alert-audio.ts
// Áudio dos alertas. Vive FORA do reducer (que permanece puro): o crossover
// gera um AlertEvent e um efeito chama playAlertSound(). A preparação acontece
// na interação do usuário (clique para ativar) para desbloquear o autoplay.

interface WebkitWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

let ctx: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Chamado no clique de ativar/desativar — desbloqueia o AudioContext.
export function prepareAlertAudio(): void {
  ensureContext();
}

// Chamado quando um AlertEvent é criado.
export function playAlertSound(): void {
  const audioCtx = ensureContext();
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.5);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch {
    // autoplay ainda bloqueado — silencioso
  }
}
