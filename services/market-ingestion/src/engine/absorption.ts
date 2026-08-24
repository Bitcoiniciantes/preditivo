export type AbsorptionState = 'NONE' | 'BULL_ABSORPTION' | 'BEAR_ABSORPTION';
export type AbsorptionLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AbsorptionResult {
  state: AbsorptionState;
  level: AbsorptionLevel;
  intensity: number;
  timestamp: number;
}

export interface AbsorptionConfig {
  imbalanceThreshold: number;
  cvdThreshold: number;

  /** Ticks consecutivos para ATIVAR absorção (protege contra falso positivo). */
  confirmationThreshold: number;

  /** Ticks consecutivos para DESATIVAR absorção (limpa rápido quando mercado normaliza). */
  exitConfirmationThreshold: number;

  lowThreshold: number;
  highThreshold: number;
}

const DEFAULT_CONFIG: AbsorptionConfig = {
  imbalanceThreshold: 0.15,
  cvdThreshold: 100_000,
  confirmationThreshold: 5,
  exitConfirmationThreshold: 2,
  lowThreshold: 0.3,
  highThreshold: 0.7,
};

export class AbsorptionDetector {
  private config: AbsorptionConfig;
  private candidateState: AbsorptionState = 'NONE';
  private confirmationCount = 0;
  private currentState: AbsorptionState = 'NONE';

  constructor(config?: Partial<AbsorptionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  evaluate(
    imbalance: number,
    cvdWhale: number,
    timestamp: number,
  ): AbsorptionResult {
    const candidate = this.classify(imbalance, cvdWhale);
    this.updateState(candidate);
    const intensity = this.computeIntensity(imbalance, cvdWhale);
    const level = this.classifyLevel(intensity);

    return {
      state: this.currentState,
      level,
      intensity,
      timestamp,
    };
  }

  private classify(imbalance: number, cvdWhale: number): AbsorptionState {
    const imbNeg = imbalance < -this.config.imbalanceThreshold;
    const cvdPos = cvdWhale > this.config.cvdThreshold;
    const imbPos = imbalance > this.config.imbalanceThreshold;
    const cvdNeg = cvdWhale < -this.config.cvdThreshold;

    if (imbNeg && cvdPos) return 'BULL_ABSORPTION';
    if (imbPos && cvdNeg) return 'BEAR_ABSORPTION';
    return 'NONE';
  }

  private updateState(candidate: AbsorptionState): void {
    if (candidate === this.candidateState) {
      this.confirmationCount++;
    } else {
      this.candidateState = candidate;
      this.confirmationCount = 1;
    }

    // Assimetria: entrar exige N ticks, sair exige apenas exitThreshold
    const isExiting = this.currentState !== 'NONE' && candidate === 'NONE';
    const threshold = isExiting
      ? this.config.exitConfirmationThreshold
      : this.config.confirmationThreshold;

    if (this.confirmationCount >= threshold) {
      this.currentState = this.candidateState;
    }
  }

  private computeIntensity(imbalance: number, cvdWhale: number): number {
    const imbNorm = Math.min(1, Math.abs(imbalance) / this.config.imbalanceThreshold);
    const cvdNorm = Math.min(1, Math.abs(cvdWhale) / this.config.cvdThreshold);
    return Math.min(1, (imbNorm + cvdNorm) / 2);
  }

  private classifyLevel(intensity: number): AbsorptionLevel {
    if (intensity >= this.config.highThreshold) return 'HIGH';
    if (intensity >= this.config.lowThreshold) return 'MEDIUM';
    return 'LOW';
  }

  reset(): void {
    this.candidateState = 'NONE';
    this.confirmationCount = 0;
    this.currentState = 'NONE';
  }
}
