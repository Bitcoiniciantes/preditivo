export const CONFIG = {
  symbol: 'BTCUSDT',
  wsUrl: 'wss://fstream.binance.com/stream',
  restUrl: 'https://fapi.binance.com',

  streams: {
    // `@trade` do futures entrega EXECUÇÕES individuais com id `t`. Verificado em 26/08:
    // o futures NÃO possui stream `@aggTrade` (fstream.binance.com entrega 0 mensagens;
    // o spot possui). A agregação é feita client-side (flow/aggregator.ts, janela ~100ms
    // por lado agressor) como substituto — P0-01 da auditoria.
    trade: 'btcusdt@trade',
    depth: 'btcusdt@depth20@100ms',
    bookTicker: 'btcusdt@bookTicker',
  },

  intervals: {
    broadcastMs: 1000,
    snapshotPersistMs: 60_000,
    oiPollMs: 5_000,
    fundingPollMs: 10_000,
  },

  ringBufferSize: 60,

  wsPort: 3001,

  dbPath: process.env.DB_PATH || './data/market.db',

  backoff: {
    initialMs: 1_000,
    maxMs: 15_000,
    multiplier: 2,
  },

  orderbook: {
    depth20Levels: 20,
    wallMultiplier: 2,
    imbalancePercentages: [0.25, 0.5, 1, 2, 3, 5],
  },

  flow: {
    bucketMs: 1_000,
    // Threshold absoluto de "whale" (P0-01, calibrado nos dados da auditoria 26/08):
    // US$ 100.000 de nocional por trade agregado (~1,27 BTC a US$ 78,5k). O threshold
    // relativo anterior (3× média móvel) capturava varejo (ticket médio 0,33 BTC).
    // whalePercentile: 90 era código morto — removido.
    whaleNotionalUsd: 100_000,
  },

  score: {
    trendWeight: 0.24,
    patternWeight: 0.14,
    momentumWeight: 0.16,
    volumeWeight: 0.10,
    riskWeight: 0.12,
    derivativesWeight: 0.10,
    liquidityWeight: 0.08,
    cvdWeight: 0.06,
  },
} as const;
