export const defaults = [
  "BTC",
  "ETH",
  "LINK",
  "AVAX",
  "PAXG",
  "MSTR",
  "PRATA",
  "COBRE",
  "URANIO",
];

export const staticAssets: Record<string, { file: string; currency: string }> = {
  MSTR: { file: "mstr", currency: "USD" },
  PRATA: { file: "prata", currency: "USD" },
  COBRE: { file: "cobre", currency: "USD" },
  URANIO: { file: "uranio", currency: "USD" },
};

export const marketSymbols: Record<string, string> = { PRATA: "SI=F", COBRE: "HG=F", URANIO: "URNM" };

const displayNames: Record<string, string> = {
  PRATA: "PRATA",
  COBRE: "COBRE",
  URANIO: "URÂNIO",
};

export const displayAsset = (asset: string) => displayNames[asset] ?? asset;

export const intervals: Record<string, string> = {
  "15M": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
  "1S": "1w",
  "1M": "1M",
};

export const rsiLabelByPeriod: Record<string, string> = {
  "15M": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1D",
  "1S": "1S",
  "1M": "1M",
};

export const rsiPeriods = [
  { label: "15m", period: "15M", interval: "15m", weight: 1.2 },
  { label: "1h", period: "1H", interval: "1h", weight: 1.5 },
  { label: "4h", period: "4H", interval: "4h", weight: 2 },
  { label: "1D", period: "1D", interval: "1d", weight: 3 },
  { label: "1S", period: "1S", interval: "1w", weight: 3.5 },
  { label: "1M", period: "1M", interval: "1M", weight: 4 },
];
