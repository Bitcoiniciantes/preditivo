// src/ia/snapshot-store.ts — guarda o MarketSnapshot mais recente em memória
// para o servidor local de IA (porta 3002). Escopo de módulo, sem global solta.
// O loop de broadcast continua dono da captura; aqui só leitura/escrita do último
// snapshot já construído. Não altera motor, regime nem WebSocket :3001.
import type { MarketSnapshot } from '../types/index.js';

let lastSnapshot: MarketSnapshot | null = null;

export function setLastSnapshot(snapshot: MarketSnapshot): void {
  lastSnapshot = snapshot;
}

export function getLastSnapshot(): MarketSnapshot | null {
  return lastSnapshot;
}

export function clearLastSnapshot(): void {
  lastSnapshot = null;
}
