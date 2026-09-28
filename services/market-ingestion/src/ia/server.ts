// src/ia/server.ts — servidor HTTP local da Análise IA (porta 3002).
// Usa EXCLUSIVAMENTE o módulo nativo http do Node. Sem Express, sem API Route
// do Next. Não toca no WebSocket :3001 nem no motor de regime: só lê o último
// snapshot via getter injetado.
import http from 'node:http';
import type { MarketSnapshot } from '../types/index.js';
import { buildPcIaEstado } from './prompt.js';
import { gerarAnalisePcIa, PcIaConfigError, PcIaUpstreamError } from './gemini.js';

export const PC_IA_ROUTE = '/api/painel-ia';
export const PC_IA_RATE_LIMIT_MS = 60_000;
export const PC_IA_MAX_SNAPSHOT_AGE_S = 15;
const BODY_LIMIT_BYTES = 4_096;

type SnapshotGetter = () => MarketSnapshot | null;

let lastRequestAtMs = 0;

export function resetPcIaRateLimit(): void {
  lastRequestAtMs = 0;
}

export function resolvePcIaPort(): number {
  const raw = Number(process.env.PC_IA_PORT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3002;
}

function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin.trim());
}

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>, origin: string | null): void {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
  };
  if (origin && isLocalOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body);
}

function snapshotStale(snapshot: MarketSnapshot, now: number): { idadeSeg: number; stale: boolean } {
  const idadeSeg = Math.max(0, Math.round((now - snapshot.ts) / 1000));
  return { idadeSeg, stale: idadeSeg > PC_IA_MAX_SNAPSHOT_AGE_S };
}

export function startPainelIaServer(getSnapshot: SnapshotGetter): http.Server {
  const port = resolvePcIaPort();

  const server = http.createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    if (origin && !isLocalOrigin(origin)) {
      sendJson(res, 403, { error: 'Origem não permitida.' }, null);
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const method = (req.method || '').toUpperCase();

    if (url.pathname === PC_IA_ROUTE && method === 'OPTIONS') {
      const headers: Record<string, string> = { 'Content-Length': '0' };
      if (origin) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Vary'] = 'Origin';
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Max-Age'] = '600';
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (url.pathname !== PC_IA_ROUTE) {
      // Drena o corpo antes de responder para não travar o socket.
      req.resume();
      sendJson(res, 404, { error: 'Rota não encontrada.' }, origin);
      return;
    }

    if (method !== 'POST') {
      req.resume();
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'Método não permitido. Use POST.' }, origin);
      return;
    }

    // POST sem corpo: consome e descarta até 4KB para liberar o socket.
    let received = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > BODY_LIMIT_BYTES && !aborted) {
        aborted = true;
        req.destroy();
      }
    });
    req.on('error', () => {
      // Socket com erro: nada a responder.
    });
    req.on('end', () => {
      void handleAnalise(getSnapshot, res, origin);
    });
  });

  // Trava global de 60s: a origem é sempre local (127.0.0.1/::1), então um
  // único timestamp da última requisição basta — sem parsing de IP.
  async function handleAnalise(
    get: SnapshotGetter,
    res: http.ServerResponse,
    origin: string | null,
  ): Promise<void> {
    const now = Date.now();
    const sinceLast = now - lastRequestAtMs;
    if (lastRequestAtMs > 0 && sinceLast < PC_IA_RATE_LIMIT_MS) {
      const retryAfterSeconds = Math.ceil((PC_IA_RATE_LIMIT_MS - sinceLast) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      sendJson(res, 429, { error: 'Limite de 1 análise por minuto. Aguarde.', retryAfterSeconds }, origin);
      return;
    }

    const snapshot = get();
    if (!snapshot) {
      sendJson(res, 425, { error: 'Sem snapshot do motor. Aguarde o stream aquecer.' }, origin);
      return;
    }
    const { idadeSeg, stale } = snapshotStale(snapshot, now);
    if (stale) {
      sendJson(
        res,
        425,
        { error: `Snapshot desatualizado há ${idadeSeg}s. Aguarde o stream.`, snapshotTs: snapshot.ts, idadeSeg },
        origin,
      );
      return;
    }

    lastRequestAtMs = now;

    try {
      const estado = buildPcIaEstado(snapshot, now);
      const { texto, modelo } = await gerarAnalisePcIa(estado);
      sendJson(
        res,
        200,
        {
          texto,
          geradoEm: new Date().toISOString(),
          modelo,
          snapshotTs: snapshot.ts,
          snapshotIdadeSeg: idadeSeg,
        },
        origin,
      );
    } catch (error) {
      if (error instanceof PcIaConfigError) {
        sendJson(res, 503, { error: 'Análise IA indisponível no momento.' }, origin);
        return;
      }
      if (error instanceof PcIaUpstreamError) {
        sendJson(res, 502, { error: 'Falha ao consultar a IA. Tente novamente.' }, origin);
        return;
      }
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        sendJson(res, 504, { error: 'Tempo de resposta da IA excedido. Tente novamente.' }, origin);
        return;
      }
      sendJson(res, 500, { error: 'Erro interno ao gerar análise.' }, origin);
    }
  }

  server.listen(port, '127.0.0.1', () => {
    console.log(`[PainelIA] Servidor HTTP local em http://127.0.0.1:${port}${PC_IA_ROUTE}`);
  });
  return server;
}
