export function bucketTimestamp(eventTime: number, bucketMs: number): number {
  return Math.floor(eventTime / bucketMs) * bucketMs;
}

export function nowMs(): number {
  return Date.now();
}

export function isStale(timestamp: number, maxAgeMs: number): boolean {
  return Date.now() - timestamp > maxAgeMs;
}
