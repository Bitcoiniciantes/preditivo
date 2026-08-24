// ── Binance raw events ──

export interface BinanceAggTrade {
  e: 'aggTrade';
  E: number;
  s: string;
  a: number;
  p: string;
  q: string;
  f: number;
  l: number;
  T: number;
  m: boolean;
}

export interface BinanceDepth {
  lastUpdateId: number;
  E: number;
  T: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface BinanceTicker {
  e: '24hrTicker';
  E: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
}

export interface BinanceOI {
  openInterest: string;
  symbol: string;
  time: number;
}

export interface BinanceFundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

// ── Normalized types ──

export interface NormalizedTrade {
  exchange: 'binance';
  eventTime: number;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  isBuyerMaker: boolean;
}

export interface OrderBookSnapshot {
  exchange: 'binance';
  lastUpdateId: number;
  timestamp: number;
  bids: [number, number][];
  asks: [number, number][];
}

export interface OrderBookState {
  valid: boolean;
  imbalance: number;
  bidWall: { price: number; qty: number } | null;
  askWall: { price: number; qty: number } | null;
  lastUpdateId: number;
  bidLiquidity: number[];
  askLiquidity: number[];
}

export interface DepthUpdate {
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

// ── Flow / CVD ──

export interface TradeBucket {
  timestamp: number;
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
  totalVolume: number;
}

export interface CvdState {
  totalCvd: number;
  whaleCvd: number;
  retailCvd: number;
  delta: number;
  buyVolume: number;
  sellVolume: number;
}

// ── Derivatives ──

export interface DerivativesState {
  openInterest: number;
  oiChange: number;
  fundingRate: number;
  fundingClassification: 'neutral' | 'positive' | 'negative' | 'extreme';
}

// ── Features ──

export type Regime = 'BULL_TREND' | 'BEAR_TREND' | 'RANGE' | 'TRENDING_UP' | 'TRENDING_DOWN' | 'HIGH_VOLATILITY' | 'LOW_VOLATILITY';

export interface FeatureState {
  regime: Regime;
  score: number;
  scoreQuality: number;
}

// ── Broadcast payload ──

export interface MarketSnapshot {
  ts: number;
  p: number;
  cvd: number;
  cvd_whale: number;
  imb: number;
  oi: number;
  oi_delta: number;
  funding: number;
  funding_class: string;
  regime: string;
  regime_volatility: number;
  regime_confidence: number;
  flow_regime: string;
  flow_strength: number;
  divergence: string;
  absorption_state: string;
  absorption_level: string;
  absorption_intensity: number;
  score: number;
  score_quality: number;
  events: MarketEvent[];
  quality: DataQuality;
}

export interface MarketEvent {
  type: string;
  magnitude: number;
  direction: string;
  timestamp: number;
}

export interface DataQuality {
  ws: 'LIVE' | 'STALE' | 'DISCONNECTED';
  oi: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  funding: 'LIVE' | 'STALE' | 'UNAVAILABLE';
}

// ── SQLite rows ──

export interface SnapshotRow {
  id: number;
  timestamp: number;
  symbol: string;
  price: number;
  oi: number;
  oi_change: number;
  funding_rate: number;
  cvd: number;
  cvd_whale: number;
  book_imbalance: number;
  score: number;
  regime: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  timestamp: number;
  symbol: string;
  event_type: string;
  magnitude: number;
  direction: string;
  details: string;
  created_at: string;
}
