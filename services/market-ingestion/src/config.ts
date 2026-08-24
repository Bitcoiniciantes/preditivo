export const CONFIG = {
  symbol: 'BTCUSDT',
  wsUrl: 'wss://fstream.binance.com/stream',
  restUrl: 'https://fapi.binance.com',

  streams: {
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
    whalePercentile: 90,
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
