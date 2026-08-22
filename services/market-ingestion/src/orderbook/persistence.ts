interface WallRecord {
  price: number;
  firstSeen: number;
  lastSeen: number;
  updates: number;
  cancelations: number;
  addedVolume: number;
}

const walls = new Map<string, WallRecord>();

function wallKey(side: 'bid' | 'ask', price: number): string {
  return `${side}:${price.toFixed(1)}`;
}

export function onDepthUpdate(
  side: 'bid' | 'ask',
  price: number,
  qty: number,
  prevQty: number,
  now: number
): void {
  const key = wallKey(side, price);
  const existing = walls.get(key);

  if (qty === 0 && existing) {
    existing.cancelations++;
    return;
  }

  if (prevQty === 0 && qty > 0) {
    walls.set(key, {
      price,
      firstSeen: now,
      lastSeen: now,
      updates: 1,
      cancelations: 0,
      addedVolume: qty,
    });
    return;
  }

  if (existing) {
    existing.lastSeen = now;
    existing.updates++;
    if (qty > prevQty) {
      existing.addedVolume += qty - prevQty;
    }
  }
}

export function getCancelRate(side: 'bid' | 'ask', price: number): number {
  const key = wallKey(side, price);
  const wall = walls.get(key);
  if (!wall || wall.addedVolume === 0) return 0;
  return wall.cancelations / Math.max(wall.updates, 1);
}

export function isPersistentWall(side: 'bid' | 'ask', price: number, minAgeMs: number, now: number): boolean {
  const key = wallKey(side, price);
  const wall = walls.get(key);
  if (!wall) return false;

  const age = now - wall.firstSeen;
  const cancelRate = wall.cancelations / Math.max(wall.updates, 1);

  return age >= minAgeMs && cancelRate < 0.5;
}

export function cleanup(maxAgeMs: number, now: number): void {
  for (const [key, wall] of walls) {
    if (now - wall.lastSeen > maxAgeMs) {
      walls.delete(key);
    }
  }
}

export function reset(): void {
  walls.clear();
}
