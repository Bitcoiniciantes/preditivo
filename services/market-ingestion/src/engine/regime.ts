interface PriceSample {
  price: number;
  timestamp: number;
}

export interface RegimeResult {
  regime: 'BULL_TREND' | 'BEAR_TREND' | 'RANGE';
  volatility: number;
  confidence: number;
  candidateRegime: string;
  timestamp: number;
}

export interface RegimeDetectorConfig {
  windowSeconds: number;
  minSamples: number;
  baseThreshold: number;
  volatilityFactor: number;
  confirmationThreshold: number;
}

const DEFAULT_CONFIG: RegimeDetectorConfig = {
  windowSeconds: 60,
  minSamples: 10,
  baseThreshold: 0.05,
  // Calibração v2 (Etapa 2 — 24/08/2026): 2.0 → 5.0.
  // v1 (2.0): threshold efetivo preso no piso (volatilidade observada 0.010–0.021%
  // × 2.0 = 0.02–0.042% < piso 0.05%) → regime piscava (~55 mudanças/hora, 68%
  // das reversões <30s). v2 testa se o componente adaptativo passa a superar o
  // piso nas volatilidades observadas. baseThreshold INTENCIONALMENTE mantido em 0.05.
  volatilityFactor: 5.0,
  confirmationThreshold: 3,
};

export class RegimeDetector {
  private buffer: PriceSample[] = [];
  private config: RegimeDetectorConfig;
  private currentRegime: RegimeResult['regime'] = 'RANGE';
  private candidateRegime: RegimeResult['regime'] = 'RANGE';
  private confirmationCount = 0;

  constructor(config?: Partial<RegimeDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  evaluate(currentPrice: number, timestamp: number): RegimeResult {
    this.buffer.push({ price: currentPrice, timestamp });
    this.pruneOldSamples(timestamp);

    if (this.buffer.length < this.config.minSamples) {
      return {
        regime: 'RANGE',
        volatility: 0,
        confidence: 0,
        candidateRegime: 'RANGE',
        timestamp,
      };
    }

    const returns = this.computeReturns();
    const volatility = this.computeVolatility(returns);
    const netChange = this.computeNetChange();
    const threshold = Math.max(this.config.baseThreshold, volatility * this.config.volatilityFactor);

    const candidate = this.determineCandidate(netChange, threshold);
    this.updateState(candidate);

    const confidence = this.computeConfidence(netChange, threshold);

    return {
      regime: this.currentRegime,
      volatility,
      confidence,
      candidateRegime: this.candidateRegime,
      timestamp,
    };
  }

  private pruneOldSamples(now: number): void {
    const cutoff = now - this.config.windowSeconds * 1000;
    this.buffer = this.buffer.filter(s => s.timestamp >= cutoff);
  }

  private computeReturns(): number[] {
    const returns: number[] = [];
    for (let i = 1; i < this.buffer.length; i++) {
      const prev = this.buffer[i - 1].price;
      const curr = this.buffer[i].price;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  private computeVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => (r - mean) ** 2);
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
    return Math.sqrt(variance) * 100;
  }

  private computeNetChange(): number {
    if (this.buffer.length < 2) return 0;
    const first = this.buffer[0].price;
    const last = this.buffer[this.buffer.length - 1].price;
    if (first === 0) return 0;
    return ((last - first) / first) * 100;
  }

  private determineCandidate(netChange: number, threshold: number): RegimeResult['regime'] {
    if (netChange > threshold) return 'BULL_TREND';
    if (netChange < -threshold) return 'BEAR_TREND';
    return 'RANGE';
  }

  private updateState(candidate: RegimeResult['regime']): void {
    if (candidate === this.candidateRegime) {
      this.confirmationCount++;
    } else {
      this.candidateRegime = candidate;
      this.confirmationCount = 1;
    }

    if (this.confirmationCount >= this.config.confirmationThreshold) {
      this.currentRegime = this.candidateRegime;
    }
  }

  private computeConfidence(netChange: number, threshold: number): number {
    if (threshold === 0) return 0;
    const ratio = Math.abs(netChange) / threshold;
    const raw = Math.min(100, ratio * 50);
    return Math.round(raw);
  }

  reset(): void {
    this.buffer = [];
    this.currentRegime = 'RANGE';
    this.candidateRegime = 'RANGE';
    this.confirmationCount = 0;
  }
}
