// src/features/cross-validation.ts

export type TechnicalBias = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
export type FlowBias = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export type ActionableSignal =
  | 'WAIT'
  | 'ENTER_LONG'
  | 'ENTER_SHORT'
  | 'DANGER_BULL_TRAP'
  | 'DANGER_BEAR_TRAP'
  | 'RISK_LIQUIDATION_SQUEEZE';

export type SignalQuality = 'FRESH' | 'DEGRADED';

export interface CrossValidationResult {
  scenario: string;
  actionableSignal: ActionableSignal;
  description: string;
  /** Qualidade do sinal considerando a sincronia entre timeframes técnico e de fluxo */
  signalQuality: SignalQuality;
}

export interface ConfluenceInput {
  /** Nota agregada do painel esquerdo (técnico), -100 a +100 */
  techScore: number;
  /** Nota dinâmica do Market Ingestion (fluxo), -100 a +100 */
  flowScore: number;
  /** Valor absoluto do CVD das baleias */
  cvdWhale: number;
  /** Funding rate atual (ex: 0.0005 para 0.05%) */
  fundingRate?: number;
  /** true se o Open Interest estiver em nível extremo (definido pela regra de negócio a montante) */
  openInterestExtreme?: boolean;
  /** Timestamp (ms epoch) da última atualização do techScore (fechamento do candle técnico) */
  techScoreTimestamp: number;
  /** Timeframe do painel técnico em minutos (60 para 1H, 240 para 4H) */
  techTimeframeMinutes: 60 | 240;
}

// Funding rate cobrado a cada 8h nas principais exchanges (Binance/Bybit padrão).
// Um funding de 0.05%–0.10% por período de 8h já é considerado extremo para BTC/ETH.
// AJUSTAR por ativo/exchange conforme liquidez — NÃO usar valores como 1% (irreal para majors).
const FUNDING_RATE_EXTREME_THRESHOLD = 0.0005; // 0.05% por período de 8h

// Janela de tolerância antes do fechamento do candle técnico em que o dado é
// considerado "prestes a virar" e portanto não confiável para confluência.
const STALE_TECH_SCORE_TOLERANCE_MINUTES = 10;

export class ConfluenceEngine {

  /**
   * Verifica se o techScore está "velho" — perto do fechamento do candle técnico,
   * janela em que o painel de fluxo (tempo real) ainda não refletiu a nova estrutura.
   */
  private static isTechScoreStale(
    techScoreTimestamp: number,
    techTimeframeMinutes: number,
    now: number = Date.now()
  ): boolean {
    const ageMinutes = (now - techScoreTimestamp) / 60000;
    const staleThreshold = techTimeframeMinutes - STALE_TECH_SCORE_TOLERANCE_MINUTES;
    return ageMinutes >= staleThreshold;
  }

  public static evaluate(input: ConfluenceInput): CrossValidationResult {
    const {
      techScore,
      flowScore,
      cvdWhale,
      fundingRate,
      openInterestExtreme,
      techScoreTimestamp,
      techTimeframeMinutes,
    } = input;

    const isStale = this.isTechScoreStale(techScoreTimestamp, techTimeframeMinutes);
    const signalQuality: SignalQuality = isStale ? 'DEGRADED' : 'FRESH';

    // Se o dado técnico está prestes a virar (candle perto do fechamento),
    // qualquer confluência/trap é rebaixada para WAIT — o cruzamento não é confiável
    // até o candle fechar e o fluxo ter tempo de reagir à nova estrutura.
    if (isStale) {
      return {
        scenario: 'TRANSIÇÃO DE VELA / DADOS DESSINCRONIZADOS',
        actionableSignal: 'WAIT',
        description:
          'O candle técnico está próximo do fechamento e o fluxo em tempo real ainda não teve tempo de refletir a nova estrutura. Aguardando sincronia entre painéis para evitar sinal fantasma.',
        signalQuality,
      };
    }

    // DIVERGÊNCIA 1: Bull Trap (gráfico sobe, dinheiro sai)
    if (techScore > 20 && flowScore < -20 && cvdWhale < 0) {
      return {
        scenario: 'ABSORÇÃO INSTITUCIONAL / BULL TRAP',
        actionableSignal: 'DANGER_BULL_TRAP',
        description:
          'Indicadores técnicos apontam alta, mas o fluxo agressor e as baleias estão vendendo pesadamente. Risco extremo de falso rompimento.',
        signalQuality,
      };
    }

    // DIVERGÊNCIA 2: Bear Trap (gráfico cai, dinheiro entra)
    if (techScore < -20 && flowScore > 20 && cvdWhale > 0) {
      return {
        scenario: 'ACUMULAÇÃO INSTITUCIONAL / BEAR TRAP',
        actionableSignal: 'DANGER_BEAR_TRAP',
        description:
          'Preço em queda técnica, mas baleias estão absorvendo passivamente. Fundo iminente.',
        signalQuality,
      };
    }

    // CONFLUÊNCIA BULLISH
    if (techScore > 20 && flowScore > 20) {
      return {
        scenario: 'TENDÊNCIA CONFIRMADA (ALTA)',
        actionableSignal: 'ENTER_LONG',
        description: 'Ação do preço e fluxo de ordens alinhados na compra.',
        signalQuality,
      };
    }

    // CONFLUÊNCIA BEARISH
    if (techScore < -20 && flowScore < -20) {
      return {
        scenario: 'TENDÊNCIA CONFIRMADA (BAIXA)',
        actionableSignal: 'ENTER_SHORT',
        description: 'Ação do preço e fluxo de ordens alinhados na venda.',
        signalQuality,
      };
    }

    // CENÁRIO 4: Exaustão Direcional (preço lateral + funding/OI em extremo)
    const isLateral = Math.abs(techScore) <= 20 && Math.abs(flowScore) <= 20;
    const fundingExtreme =
      fundingRate !== undefined && Math.abs(fundingRate) >= FUNDING_RATE_EXTREME_THRESHOLD;

    if (isLateral && (fundingExtreme || openInterestExtreme)) {
      return {
        scenario: 'EXAUSTÃO DIRECIONAL',
        actionableSignal: 'RISK_LIQUIDATION_SQUEEZE',
        description:
          'Preço e fluxo neutros, mas Funding Rate e/ou Open Interest em níveis extremos. Risco elevado de liquidação em cascata (long ou short squeeze).',
        signalQuality,
      };
    }

    // DEFAULT: Ruído / Indecisão
    return {
      scenario: 'FORÇAS EM DISPUTA / CONSOLIDAÇÃO',
      actionableSignal: 'WAIT',
      description:
        'Sem alinhamento claro entre a estrutura de preço e o fluxo agressor. Aguarde.',
      signalQuality,
    };
  }

  public static getBias(score: number): TechnicalBias | FlowBias {
    if (score >= 50) return 'STRONG_BULL';
    if (score >= 20) return 'BULL';
    if (score <= -50) return 'STRONG_BEAR';
    if (score <= -20) return 'BEAR';
    return 'NEUTRAL';
  }
}
