export type FlowRegime = 'BULL_FLOW' | 'BEAR_FLOW' | 'NEUTRAL_FLOW';
export type DivergenceState = 'DIVERGENCE_BULL' | 'DIVERGENCE_BEAR' | 'NONE';

export interface FlowRegimeResult {
  flowRegime: FlowRegime;
  divergence: DivergenceState;
  flowStrength: number;
  timestamp: number;
}

export interface FlowRegimeConfig {
  dominanceThreshold: number;
  confirmationThreshold: number;
  minConfidenceForDivergence: number;
}

const DEFAULT_CONFIG: FlowRegimeConfig = {
  dominanceThreshold: 60,
  confirmationThreshold: 5,
  minConfidenceForDivergence: 35,
};

export interface DivergenceResolution {
  eventType: 'divergence_resolved' | 'divergence_failed';
  resolvedInto: string;
  durationMs: number;
  divergence: DivergenceState;
}

export class FlowRegimeDetector {
  private config: FlowRegimeConfig;
  private candidateFlowRegime: FlowRegime = 'NEUTRAL_FLOW';
  private confirmationCount = 0;
  private currentFlowRegime: FlowRegime = 'NEUTRAL_FLOW';
  private divergenceCandidate: DivergenceState = 'NONE';
  private divergenceCount = 0;
  private activeDivergence: DivergenceState = 'NONE';
  private divergenceTriggeredAt = 0;
  private pendingResolution: DivergenceResolution | null = null;

  constructor(config?: Partial<FlowRegimeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  evaluate(
    imbalance: number,
    cvdWhale: number,
    priceRegime: string,
    regimeConfidence: number,
    timestamp: number,
  ): FlowRegimeResult {
    // Capturar resolução ANTES do clear — se havia divergência ativa e regime saiu de RANGE
    if (this.activeDivergence !== 'NONE' && priceRegime !== 'RANGE') {
      const durationMs = timestamp - this.divergenceTriggeredAt;
      const matched = (this.activeDivergence === 'DIVERGENCE_BULL' && priceRegime === 'BULL_TREND')
        || (this.activeDivergence === 'DIVERGENCE_BEAR' && priceRegime === 'BEAR_TREND');

      this.pendingResolution = {
        eventType: matched ? 'divergence_resolved' : 'divergence_failed',
        resolvedInto: priceRegime,
        durationMs,
        divergence: this.activeDivergence,
      };
    } else {
      this.pendingResolution = null;
    }

    const dominance = this.computeDominance(imbalance, cvdWhale);
    const candidate = this.classifyFlow(dominance);

    this.updateFlowRegime(candidate);
    const divergence = this.detectDivergence(priceRegime, regimeConfidence, timestamp);

    return {
      flowRegime: this.currentFlowRegime,
      divergence,
      flowStrength: dominance,
      timestamp,
    };
  }

  consumeResolution(): DivergenceResolution | null {
    const r = this.pendingResolution;
    this.pendingResolution = null;
    return r;
  }

  private computeDominance(imbalance: number, cvdWhale: number): number {
    const imbNorm = Math.max(-1, Math.min(1, imbalance)) * 50;
    const cvdNorm = Math.max(-1, Math.min(1, cvdWhale / 500_000)) * 50;
    return imbNorm + cvdNorm;
  }

  private classifyFlow(dominance: number): FlowRegime {
    if (dominance > this.config.dominanceThreshold) return 'BULL_FLOW';
    if (dominance < -this.config.dominanceThreshold) return 'BEAR_FLOW';
    return 'NEUTRAL_FLOW';
  }

  private updateFlowRegime(candidate: FlowRegime): void {
    if (candidate === this.candidateFlowRegime) {
      this.confirmationCount++;
    } else {
      this.candidateFlowRegime = candidate;
      this.confirmationCount = 1;
    }

    if (this.confirmationCount >= this.config.confirmationThreshold) {
      this.currentFlowRegime = this.candidateFlowRegime;
    }
  }

  private detectDivergence(priceRegime: string, regimeConfidence: number, timestamp: number): DivergenceState {
    // CLEAR: imediato e incondicional — divergência só existe em RANGE
    if (priceRegime !== 'RANGE' && this.activeDivergence !== 'NONE') {
      this.activeDivergence = 'NONE';
      this.divergenceCandidate = 'NONE';
      this.divergenceCount = 0;
      this.divergenceTriggeredAt = 0;
    }

    // SET: só quando priceRegime === 'RANGE' COM confiança mínima, com confirmação
    const isPriceRanging = priceRegime === 'RANGE' && regimeConfidence >= this.config.minConfidenceForDivergence;
    const isFlowBull = this.currentFlowRegime === 'BULL_FLOW';
    const isFlowBear = this.currentFlowRegime === 'BEAR_FLOW';

    let candidate: DivergenceState = 'NONE';
    if (isPriceRanging && isFlowBull) candidate = 'DIVERGENCE_BULL';
    else if (isPriceRanging && isFlowBear) candidate = 'DIVERGENCE_BEAR';

    if (!isPriceRanging) return this.activeDivergence;

    if (candidate === this.divergenceCandidate) {
      this.divergenceCount++;
    } else {
      this.divergenceCandidate = candidate;
      this.divergenceCount = 1;
    }

    if (this.divergenceCount >= this.config.confirmationThreshold && candidate !== 'NONE') {
      if (this.activeDivergence === 'NONE') {
        this.divergenceTriggeredAt = timestamp;
      }
      this.activeDivergence = this.divergenceCandidate;
    }

    return this.activeDivergence;
  }

  reset(): void {
    this.candidateFlowRegime = 'NEUTRAL_FLOW';
    this.confirmationCount = 0;
    this.currentFlowRegime = 'NEUTRAL_FLOW';
    this.divergenceCandidate = 'NONE';
    this.divergenceCount = 0;
    this.activeDivergence = 'NONE';
    this.divergenceTriggeredAt = 0;
    this.pendingResolution = null;
  }
}
