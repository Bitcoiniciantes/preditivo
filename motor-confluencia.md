# Instruções para a IA Desenvolvedora: Motor de Confluência

## Objetivo

Criar um motor de regras lógicas que confronte o **Viés Técnico** (RSI, Tendência, Padrão — painel esquerdo) com o **Viés de Fluxo** (CVD, Imbalance, OI — painel direito) e classifique o cenário de mercado resultante do cruzamento entre eles.

O sistema **não deve calcular uma média** entre os dois vieses — eles têm naturezas distintas e devem ser avaliados como dimensões separadas de um mesmo mapa de decisão.

---

## 1. Cuidados Arquiteturais (o que NÃO fazer)

- **Não crie um "Super Score" único.** Não some o Score de fluxo (-100 a +100) com a Nota Base da tendência técnica (-100 a +100). Somar essas notas mascara divergências importantes — é exatamente a divergência entre elas que gera os sinais mais valiosos (bull trap, bear trap).
- **Respeite os timeframes de cada painel:**
  - Painel esquerdo (técnico): opera no fechamento de candles de 1H ou 4H — é uma leitura de estrutura macro.
  - Painel direito (fluxo): opera em tempo real — é uma leitura instantânea de intenção de mercado.
  - O motor deve usar o **estado instantâneo do fluxo para validar (ou invalidar) a estrutura macro atual**, nunca o contrário.
- **Não trate os quatro cenários como mutuamente redundantes.** Cada regra deve ter condições de disparo mutuamente exclusivas e testadas em ordem de prioridade (divergências perigosas primeiro, depois confluências, depois exaustão, por último o default).

---

## 2. Lógica de Cruzamento (Matriz de Cenários)

### Cenário 1 — Confluência Verdadeira (Rompimento Legítimo)
- **Técnico:** Rompimento de resistência ou tendência de alta.
- **Fluxo:** CVD crescendo positivamente + Imbalance comprador + OI subindo.
- **Ação:** Confirmação de entrada (`ENTER_LONG`).

### Cenário 2 — Bull Trap / Absorção (Falsa Alta)
- **Técnico:** Preço subindo, indicadores técnicos apontando compra.
- **Fluxo:** CVD fortemente negativo (baleias vendendo) + score de fluxo negativo.
- **Ação:** Alerta vermelho de armadilha. Proibir compras (`DANGER_BULL_TRAP`).

### Cenário 3 — Bear Trap / Squeeze (Falsa Queda)
- **Técnico:** Preço caindo, perdendo suporte.
- **Fluxo:** CVD positivo persistente (acumulação passiva).
- **Ação:** Preparar para reversão de alta (`DANGER_BEAR_TRAP`).

### Cenário 4 — Exaustão Direcional
- **Ambos:** Preço lateral, volume/CVD neutros, mas Funding Rate e OI em extremos.
- **Ação:** Risco de liquidação (long/short squeeze) — sinalizar como alerta separado, não como `WAIT` genérico.

### Default — Ruído / Indecisão
- Nenhuma das condições acima disparou.
- **Ação:** Aguardar (`WAIT`).

> **Nota de refinamento:** o esqueleto original de código implementava os Cenários 1, 2 e 3, mas não o Cenário 4 (Exaustão). A versão abaixo adiciona esse caso, incluindo os parâmetros de `fundingRate` e `openInterestExtreme` necessários para avaliá-lo.

---

## 2.1. Correções Críticas de Produção

Duas falhas foram identificadas na revisão que quebrariam o motor em ambiente real. Ambas foram corrigidas na implementação da Seção 3.

### A) "Ghosting" de Dados — Dessincronia entre Timeframes

O motor cruza `techScore` (atualiza no fechamento de candle de 1H/4H) com `flowScore` (atualiza em tempo real, ~4Hz). Se o daemon roda o motor a cada 250ms, existe uma janela em que:

- O candle técnico está prestes a fechar (ou acabou de fechar) e o `techScore` está prestes a saltar bruscamente.
- O `flowScore` ainda não teve tempo de reagir à nova estrutura.

Nessa janela, o motor pode disparar `ENTER_LONG`/`ENTER_SHORT`/traps com base em uma combinação transitória e não confiável — um "atraso fantasma".

**Solução:** o motor passa a receber o timestamp da última atualização do painel técnico (`techScoreTimestamp`) e calcula sua "idade". Se o `techScore` estiver **stale** (por padrão, mais de 50 minutos em candles de 1H — ou seja, perto do fechamento sem ainda ter capturado a liquidez desse fechamento), o resultado é rebaixado para um novo campo `signalQuality: 'DEGRADED'`, e o `actionableSignal` de confluência/trap é substituído por `WAIT` até a estrutura técnica se estabilizar após o fechamento da vela.

### B) Limiar de Funding Rate Irrealista

O valor original (`0.01` = 1% por período) é cerca de 10–20x maior que qualquer funding realmente extremo em BTCUSDT — na prática isso faria o Cenário 4 nunca disparar. Funding rates de perpétuos são cobrados tipicamente a cada 8h (algumas exchanges usam 4h), e níveis de alerta de squeeze giram em torno de `0.0005` (0.05%) a `0.001` (0.1%) por período.

**Solução:** o limiar foi ajustado para `0.0005` (0.05%) como padrão, exposto como constante configurável e documentado por período de cobrança (8h), para permitir ajuste fino por ativo/exchange sem alterar a lógica do motor.

---

## 3. Esqueleto de Implementação (TypeScript)

Arquivo: `src/features/cross-validation.ts`

```typescript
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
```

---

## 4. Pontos de Atenção para Testes

- **Staleness é checada primeiro, antes de qualquer outra regra.** Se `techScore` estiver perto do fechamento do candle (dentro de `STALE_TECH_SCORE_TOLERANCE_MINUTES`), o motor retorna `WAIT` com `signalQuality: 'DEGRADED'` imediatamente, sem avaliar traps ou confluências. Testar especificamente a fronteira (ex: candle de 1H com exatamente 50 min de idade) para garantir que o corte acontece no momento certo.
- **`techScoreTimestamp` e `techTimeframeMinutes` são obrigatórios** — sem eles o motor não tem como saber se está prestes a operar sobre um dado técnico obsoleto. O backend que popula o payload deve gravar o timestamp exato do fechamento do candle, não o timestamp de quando o dado chegou ao motor.
- **Ordem de avaliação importa.** Depois do check de staleness, as divergências (Bull Trap / Bear Trap) devem ser checadas *antes* das confluências, já que ambas usam limiares parecidos (`> 20` / `< -20`) e uma ordem errada pode mascarar um trap como confluência.
- **Cobrir os limiares exatos** (`techScore = 20`, `flowScore = -20`, etc.) com testes de borda, já que o motor usa `>` e `<` estritos — valores exatamente em 20/-20 caem no cenário default.
- **`cvdWhale`** deve ser validado quanto à unidade e sinal antes de chegar ao motor (a lógica assume que valores negativos = venda líquida das baleias).
- **Funding rate extremo foi recalibrado para `0.0005` (0.05% por período de 8h)**, patamar realista para BTC/ETH — o valor anterior de `0.01` (1%) nunca dispararia em produção. Trate esse limiar como configurável por ativo/exchange (períodos de 4h vs 8h, majors vs altcoins de baixa liquidez têm "extremos" diferentes), e documente sempre a que período de cobrança o valor se refere.
- **`getBias`** foi exposto como método público — ele não é usado diretamente em `evaluate`, mas é útil para exibir o rótulo textual do viés (ex: "STRONG_BULL") na UI, mantendo a lógica de classificação centralizada em um único lugar.
- **`signalQuality: 'DEGRADED'` deve ser tratado na UI**, não só no backend — o frontend deve exibir claramente ao usuário que aquele sinal específico está em zona de transição de candle, para não gerar falsa confiança durante o "ghosting".
