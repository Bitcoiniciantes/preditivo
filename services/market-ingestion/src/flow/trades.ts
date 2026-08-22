import { CONFIG } from '../config.js';
import { bucketTimestamp } from '../utils/time.js';
import { RingBuffer } from '../storage/ring-buffer.js';
import type { NormalizedTrade, TradeBucket } from '../types/index.js';

export class TradeAccumulator {
  private currentBucket: TradeBucket | null = null;
  private buckets: RingBuffer<TradeBucket>;

  constructor() {
    this.buckets = new RingBuffer<TradeBucket>(CONFIG.ringBufferSize);
  }

  addTrade(trade: NormalizedTrade): TradeBucket | null {
    const bucketTs = bucketTimestamp(trade.eventTime, CONFIG.flow.bucketMs);

    if (!this.currentBucket || this.currentBucket.timestamp !== bucketTs) {
      const closed = this.currentBucket;
      this.currentBucket = {
        timestamp: bucketTs,
        buyVolume: 0,
        sellVolume: 0,
        buyCount: 0,
        sellCount: 0,
        totalVolume: 0,
      };
      if (closed) this.buckets.push(closed);
      return closed;
    }

    const usdValue = trade.price * trade.quantity;
    this.currentBucket.totalVolume += usdValue;

    if (trade.side === 'BUY') {
      this.currentBucket.buyVolume += usdValue;
      this.currentBucket.buyCount++;
    } else {
      this.currentBucket.sellVolume += usdValue;
      this.currentBucket.sellCount++;
    }

    return null;
  }

  getBuckets(): TradeBucket[] {
    return this.buckets.getAll();
  }

  getCurrentBucket(): TradeBucket | null {
    return this.currentBucket;
  }

  clear(): void {
    this.currentBucket = null;
    this.buckets.clear();
  }
}
