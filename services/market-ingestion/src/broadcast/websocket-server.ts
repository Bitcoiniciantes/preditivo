import { WebSocketServer, WebSocket } from 'ws';
import { CONFIG } from '../config.js';
import type { MarketSnapshot } from '../types/index.js';

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

const clients = new Set<ExtWebSocket>();
let wss: WebSocketServer | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let lastPayloadBytes = 0;
let totalBytesSent = 0;
let totalBroadcasts = 0;

const PING_INTERVAL_MS = 30_000;
const BYTES_PER_MB = 1024 * 1024;
const MS_PER_HOUR = 3_600_000;
const HOURS_PER_MONTH = 730;

export function startBroadcastServer(): void {
  wss = new WebSocketServer({
    port: CONFIG.wsPort,
    perMessageDeflate: {
      zlibDeflateOptions: { chunkSize: 1024, memLevel: 7, level: 3 },
      zlibInflateOptions: { chunkSize: 10 * 1024 },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 256,
    },
  });

  wss.on('connection', (ws: ExtWebSocket) => {
    ws.isAlive = true;
    clients.add(ws);
    console.log(`[Broadcast] Client connected (${clients.size} total)`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[Broadcast] Client disconnected (${clients.size} total)`);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  pingInterval = setInterval(() => {
    for (const client of clients) {
      if (client.isAlive === false) {
        client.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, PING_INTERVAL_MS);

  console.log(`[Broadcast] WebSocket server listening on port ${CONFIG.wsPort}`);
  console.log(`[Broadcast] Compression: perMessageDeflate ON`);
  console.log(`[Broadcast] Heartbeat: ping every ${PING_INTERVAL_MS / 1000}s`);
}

export function broadcast(snapshot: MarketSnapshot): void {
  if (clients.size === 0) return;

  const payload = JSON.stringify(snapshot);
  lastPayloadBytes = Buffer.byteLength(payload, 'utf8');
  totalBroadcasts++;
  totalBytesSent += lastPayloadBytes * clients.size;

  if (totalBroadcasts % 50 === 0) {
    const estimatedMBperMonth = (totalBytesSent / totalBroadcasts) *
      (MS_PER_HOUR / CONFIG.intervals.broadcastMs) * HOURS_PER_MONTH / BYTES_PER_MB;
    console.log(
      `[Broadcast] Clients: ${clients.size} | ` +
      `Payload: ${lastPayloadBytes} bytes | ` +
      `Total sent: ${(totalBytesSent / BYTES_PER_MB).toFixed(2)} MB | ` +
      `Est. monthly: ~${estimatedMBperMonth.toFixed(1)} MB`
    );
  }

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}

export function getLastPayloadBytes(): number {
  return lastPayloadBytes;
}

export function stopBroadcastServer(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (wss) {
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close();
    wss = null;
  }
}
