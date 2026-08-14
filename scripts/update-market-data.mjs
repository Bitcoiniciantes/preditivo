import { mkdir, writeFile } from "node:fs/promises";

const assets = [
  { asset: "MSTR", displayName: "MSTR", symbol: "MSTR", file: "mstr" },
  { asset: "SPCX", displayName: "SPCX", symbol: "SPCX", file: "spcx", requiredPeriods: ["1H"] },
  { asset: "QBTS", displayName: "QBTS", symbol: "QBTS", file: "qbts", requiredPeriods: ["1H"] },
  { asset: "BRENT", displayName: "BRENT", symbol: "BZ=F", file: "brent", requiredPeriods: ["1H"] },
  { asset: "PRATA", displayName: "PRATA", symbol: "SI=F", file: "prata" },
  { asset: "COBRE", displayName: "COBRE", symbol: "HG=F", file: "cobre" },
  { asset: "URANIO", displayName: "URÂNIO", symbol: "URNM", file: "uranio" },
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchCandles(symbol, interval, range) {
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", interval);
  url.searchParams.set("range", range);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TermometroMarketData/1.0)",
        Accept: "application/json",
      },
    });
    if (response.ok) {
      const payload = await response.json();
      const result = payload?.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !quote) throw new Error(`${symbol} sem candles em ${interval}`);
      return result.timestamp.flatMap((timestamp, index) => {
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        const volume = quote.volume?.[index];
        if (![open, high, low, close, volume].every(Number.isFinite)) return [];
        return [{ time: timestamp * 1000, open, high, low, close, volume }];
      });
    }
    if (attempt === 3) throw new Error(`${symbol}: Yahoo Finance respondeu ${response.status}`);
    await wait(attempt * 1200);
  }
}

function aggregateFourHours(hourly) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map();
  for (const candle of hourly) {
    const day = formatter.format(new Date(candle.time));
    const list = days.get(day) ?? [];
    list.push(candle);
    days.set(day, list);
  }
  return [...days.values()].flatMap((candles) => {
    const result = [];
    for (let index = 0; index < candles.length; index += 4) {
      const group = candles.slice(index, index + 4);
      result.push({
        time: group[0].time,
        open: group[0].open,
        high: Math.max(...group.map((item) => item.high)),
        low: Math.min(...group.map((item) => item.low)),
        close: group.at(-1).close,
        volume: group.reduce((sum, item) => sum + item.volume, 0),
      });
    }
    return result;
  });
}

async function buildAsset(config) {
  const fifteen = await fetchCandles(config.symbol, "15m", "5d");
  await wait(250);
  const hourly = await fetchCandles(config.symbol, "1h", "3mo");
  await wait(250);
  const daily = await fetchCandles(config.symbol, "1d", "1y");
  await wait(250);
  const weekly = await fetchCandles(config.symbol, "1wk", "5y");
  await wait(250);
  const monthly = await fetchCandles(config.symbol, "1mo", "max");

  const output = {
    asset: config.asset,
    displayName: config.displayName,
    marketSymbol: config.symbol,
    currency: "USD",
    source: "Yahoo Finance • atualização programada",
    updatedAt: Date.now(),
    periods: {
      "15M": fifteen.slice(-120),
      "1H": hourly.slice(-120),
      "4H": aggregateFourHours(hourly).slice(-120),
      "1D": daily.slice(-120),
      "1S": weekly.slice(-120),
      "1M": monthly.slice(-120),
    },
  };

  for (const period of config.requiredPeriods ?? Object.keys(output.periods)) {
    if ((output.periods[period] ?? []).length < 55) {
      throw new Error(`${config.displayName} sem histórico suficiente em ${period}`);
    }
  }
  await writeFile(
    new URL(`../public/data/${config.file}.json`, import.meta.url),
    JSON.stringify(output),
  );
  console.log(
    `${config.displayName}: ` +
      Object.entries(output.periods)
        .map(([period, candles]) => `${period}=${candles.length}`)
        .join(" • "),
  );
}

await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
for (const asset of assets) {
  await buildAsset(asset);
  await wait(500);
}
