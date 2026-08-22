import { CONFIG } from '../config.js';
import type { OrderBookSnapshot, OrderBookState } from '../types/index.js';

export class OrderBookManager {
  private valid = false;
  private bids: [number, number][] = [];
  private asks: [number, number][] = 0 as any;
  private currentPrice = 0;

  setCurrentPrice(price: number): void {
    this.currentPrice = price;
  }

  // depth20@100ms envia snapshots completos. Substituir inteiramente.
  onSnapshot(snapshot: OrderBookSnapshot): void {
    this.bids = snapshot.bids;
    this.asks = snapshot.asks;
    this.valid = true;
  }

  getState(): OrderBookState {
    if (!this.valid) {
      return {
        valid: false,
        imbalance: 0,
        bidWall: null,
        askWall: null,
        lastUpdateId: 0,
        bidLiquidity: [],
        askLiquidity: [],
      };
    }

    const totalBid = this.bids.reduce((s, [, q]) => s + q, 0);
    const totalAsk = this.asks.reduce((s, [, q]) => s + q, 0);

    const imbalance = (totalBid + totalAsk) > 0
      ? (totalBid - totalAsk) / (totalBid + totalAsk)
      : 0;

    const avgBid = totalBid / Math.max(this.bids.length, 1);
    const avgAsk = totalAsk / Math.max(this.asks.length, 1);
    const wallMult = CONFIG.orderbook.wallMultiplier;

    const bidWallEntry = this.bids.find(([, q]) => q > avgBid * wallMult);
    const askWallEntry = this.asks.find(([, q]) => q > avgAsk * wallMult);

    const percentages = CONFIG.orderbook.imbalancePercentages;
    const bidLiquidity: number[] = [];
    const askLiquidity: number[] = [];

    for (const pct of percentages) {
      const bidThreshold = this.currentPrice * (1 - pct / 100);
      const askThreshold = this.currentPrice * (1 + pct / 100);

      bidLiquidity.push(
        this.bids.filter(([p]) => p >= bidThreshold).reduce((s, [, q]) => s + q, 0)
      );
      askLiquidity.push(
        this.asks.filter(([p]) => p <= askThreshold).reduce((s, [, q]) => s + q, 0)
      );
    }

    return {
      valid: true,
      imbalance,
      bidWall: bidWallEntry ? { price: bidWallEntry[0], qty: bidWallEntry[1] } : null,
      askWall: askWallEntry ? { price: askWallEntry[0], qty: askWallEntry[1] } : null,
      lastUpdateId: 0,
      bidLiquidity,
      askLiquidity,
    };
  }

  isReady(): boolean {
    return this.valid;
  }

  reset(): void {
    this.bids = [];
    this.asks = [];
    this.valid = false;
  }
}
