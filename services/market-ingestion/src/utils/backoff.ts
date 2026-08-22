interface BackoffConfig {
  initialMs: number;
  maxMs: number;
  multiplier: number;
}

export function backoffDelay(retries: number, config: BackoffConfig): number {
  const delay = config.initialMs * Math.pow(config.multiplier, retries);
  return Math.min(delay, config.maxMs);
}
