// DB Worker (Worker Thread) — ÚNICO escritor SQLite. Isola todo acesso ao
// `node:sqlite` da Main Thread (FASE 1 — refatoração de performance, preserva 100% do
// comportamento analítico; nenhuma mudança de schema/dados/métricas).
import { parentPort } from 'node:worker_threads';
import { dbStorage } from './sqlite.js';

const port = parentPort;
if (!port) {
  throw new Error('db.worker.ts deve ser executado como Worker Thread (parentPort ausente)');
}

const log = (s: string) => process.stdout.write(s + '\n');

port.on('message', (msg: any) => {
  try {
    const t0 = performance.now();
    switch (msg?.type) {
      case 'snapshot': {
        const ok = dbStorage.saveSnapshot(msg.snapshot);
        port.postMessage({ type: ok ? 'snapshot_saved' : 'snapshot_error', timestamp: msg.snapshot?.timestamp, writeMs: performance.now() - t0 });
        return;
      }
      case 'event': {
        const ok = dbStorage.saveEvent(msg.event);
        port.postMessage({ type: ok ? 'event_saved' : 'event_error', writeMs: performance.now() - t0 });
        return;
      }
      case 'regime_event': {
        const ok = dbStorage.saveRegimeEvent(msg.regimeEvent);
        port.postMessage({ type: ok ? 'regime_event_saved' : 'regime_event_error', writeMs: performance.now() - t0 });
        return;
      }
      case 'db_stats': {
        port.postMessage({ type: 'db_stats', stats: dbStorage.getDbStats() });
        return;
      }
      case 'close': {
        dbStorage.close();
        // NÃO process.exit aqui: garante a entrega da confirmação 'closed'; o parent termina o Worker.
        port.postMessage({ type: 'closed' });
        return;
      }
      default:
        log(`[DB Worker] mensagem desconhecida: ${String(msg?.type)}`);
    }
  } catch (e) {
    // mensagens de erro incluem JSON.stringify para permanecerem serializáveis
    port.postMessage({ type: 'error', operation: String(msg?.type), error: (e as Error).message });
  }
});

log('[DB Worker] pronto — SQLite isolado da Main Thread');
