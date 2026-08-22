import { RingBuffer } from '../storage/ring-buffer.js';
import { CONFIG } from '../config.js';
import type { OrderBookState } from '../types/index.js';

export class ImbalanceTracker {
  private history: RingBuffer<number>;

  constructor() {
    this.history = new RingBuffer<number>(CONFIG.ringBufferSize);
  }

  update(state: OrderBookState): void {
    if (state.valid) {
      this.history.push(state.imbalance);
    }
  }

  getInstantImbalance(): number {
    const last = this.history.last();
    return last ?? 0;
  }

  getAverageImbalance(window: number): number {
    const all = this.history.getAll();
    if (all.length === 0) return 0;
    const slice = all.slice(-window);
    return slice.reduce<number>((s, v) => s + v, 0) / slice.length;
  }

  clear(): void {
    this.history.clear();
  }
}
