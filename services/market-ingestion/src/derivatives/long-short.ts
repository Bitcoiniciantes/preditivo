import { fetchLongShortAccountRatio, type LongShortPeriod } from '../exchanges/binance/rest.js';

export type { LongShortPeriod };

export interface LongShortState {
  ratio: number;
  /** Fração de contas long (0..1), direto de `longAccount` da Binance. */
  longPct: number;
  /** Fração de contas short (0..1), direto de `shortAccount` da Binance. */
  shortPct: number;
  period: LongShortPeriod;
  /** Timestamp do bucket retornado pela Binance (idade do dado). Nunca usado p/ stale. */
  updatedAt: number;
  /** Momento da última consulta válida do daemon (saúde do feed). Base do stale. */
  fetchedAt: number;
}

// Períodos coletados: somente os necessários aos timeframes do gráfico
// (30m fica cacheado para uso futuro; 2h/6h/12h não são coletados).
export const LONG_SHORT_PERIODS: readonly LongShortPeriod[] = ['5m', '15m', '30m', '1h', '4h', '1d'] as const;

// Um poll por período a cada 60s — no máximo ~6 requests/minuto no total.
const POLL_INTERVAL_MS = 60_000;

const cache: Record<LongShortPeriod, LongShortState | null> = {
  '5m': null,
  '15m': null,
  '30m': null,
  '1h': null,
  '4h': null,
  '1d': null,
};

const lastPoll: Record<LongShortPeriod, number> = {
  '5m': 0,
  '15m': 0,
  '30m': 0,
  '1h': 0,
  '4h': 0,
  '1d': 0,
};

// `fetcher` injetável somente para testes (padrão = REST real, sem mudança
// de comportamento em produção).
export async function pollLongShortAccountRatios(
  now: number = Date.now(),
  fetcher: (period: LongShortPeriod) => Promise<{ ratio: number; longAccount: number; shortAccount: number; timestamp: number } | null> = fetchLongShortAccountRatio,
): Promise<void> {
  for (const period of LONG_SHORT_PERIODS) {
    if (now - lastPoll[period] < POLL_INTERVAL_MS) continue;
    lastPoll[period] = now;

    const data = await fetcher(period);
    // Erro/timeout/rate-limit: preserva último valor, updatedAt e fetchedAt.
    // fetchedAt só avança após resposta válida. Nunca zera, nunca null.
    if (!data) continue;

    cache[period] = {
      ratio: data.ratio,
      longPct: data.longAccount,
      shortPct: data.shortAccount,
      period,
      updatedAt: data.timestamp,
      fetchedAt: now,
    };
  }
}

export function getLongShortState(): Record<LongShortPeriod, LongShortState | null> {
  return { ...cache };
}

export function reset(): void {
  for (const period of LONG_SHORT_PERIODS) {
    cache[period] = null;
    lastPoll[period] = 0;
  }
}
