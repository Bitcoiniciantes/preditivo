const RATE_LIMIT_MAX = 2400;
const RATE_LIMIT_THRESHOLD = 0.8;

let usedWeight = 0;
let isPaused = false;
let pauseUntil = 0;

export function updateWeightFromHeaders(headers: Headers): void {
  const weightHeader = headers.get('x-mbx-used-weight-1m');
  if (weightHeader) {
    usedWeight = parseInt(weightHeader, 10);
  }

  if (usedWeight >= RATE_LIMIT_MAX * RATE_LIMIT_THRESHOLD) {
    isPaused = true;
    pauseUntil = Date.now() + 60_000;
    console.warn(`[RateLimit] Weight ${usedWeight}/${RATE_LIMIT_MAX} — pausing REST for 60s`);
  }
}

export function isRateLimited(): boolean {
  if (!isPaused) return false;
  if (Date.now() >= pauseUntil) {
    isPaused = false;
    console.log('[RateLimit] Pause ended, resuming REST calls');
    return false;
  }
  return true;
}

export function getWeight(): number {
  return usedWeight;
}
