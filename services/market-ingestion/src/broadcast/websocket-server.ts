import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config.js';
import type { MarketSnapshot } from '../types/index.js';

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

export function startBroadcastServer(): void {
  wss = new WebSocketServer({ port: CONFIG.wsPort });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[Broadcast] Client connected (${clients.size} total)`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[Broadcast] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  console.log(`[Broadcast] WebSocket server listening on port ${CONFIG.wsPort}`);
}

export function broadcast(snapshot: MarketSnapshot): void {
  if (clients.size === 0) return;

  const payload = JSON.stringify(snapshot);

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

export function stopBroadcastServer(): void {
  if (wss) {
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
    wss = null;
  }
}
