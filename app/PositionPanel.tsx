"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLiveStockMarket, fetchMarket } from "../lib/api";
import { displayAsset, staticAssets } from "../lib/config";
import { calculatePosition, type PositionSide } from "../lib/positions";

type StoredPosition = { id: string; asset: string; side: PositionSide; averagePrice: number; quantity: number };
const STORAGE_KEY = "termometro-positions";
const POSITIONS_URL = "https://bitcoiniciantes-ia.bitcoiniciantes.workers.dev/api/public-positions?account=principal";

function cleanPositions(value: unknown): StoredPosition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((position): position is StoredPosition => Boolean(position && typeof position === "object" && typeof (position as StoredPosition).id === "string" && typeof (position as StoredPosition).asset === "string" && ["LONG", "SHORT"].includes((position as StoredPosition).side) && Number.isFinite((position as StoredPosition).averagePrice) && (position as StoredPosition).averagePrice > 0 && Number.isFinite((position as StoredPosition).quantity) && (position as StoredPosition).quantity > 0));
}
function readPositions(): StoredPosition[] {
  if (typeof window === "undefined") return [];
  try { return cleanPositions(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")); } catch { return []; }
}
function savePositions(positions: StoredPosition[]) { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); } catch {} }

function currencyFor(asset: string) { return staticAssets[asset]?.currency ?? "USDT"; }
function money(value: number, currency: string) { return currency + " " + value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function PositionPanel({ asset, currentPrice, assets }: { asset: string; currentPrice?: number; assets: string[] }) {
  const [positions, setPositions] = useState<StoredPosition[]>([]);
  const [ready, setReady] = useState(false);
  const [positionAsset, setPositionAsset] = useState(asset);
  const [side, setSide] = useState<PositionSide>("LONG");
  const [averagePrice, setAveragePrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const remoteUpdatedAt = useRef(0);
  const positionAssets = useMemo(() => [...new Set([...assets, asset])], [assets, asset]);

  const pullRemotePositions = async () => {
    const response = await fetch(POSITIONS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("positions-sync-read");
    const data: unknown = await response.json();
    const remote = data && typeof data === "object" ? data as { positions?: unknown; updatedAt?: unknown } : {};
    const updatedAt = Number(remote.updatedAt) || 0;
    if (updatedAt && updatedAt > remoteUpdatedAt.current) {
      const next = cleanPositions(remote.positions); remoteUpdatedAt.current = updatedAt; setPositions(next); savePositions(next); return true;
    }
    return Boolean(updatedAt);
  };
  const pushRemotePositions = async (next: StoredPosition[]) => {
    const response = await fetch(POSITIONS_URL, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positions: next }) });
    if (!response.ok) throw new Error("positions-sync-write");
    const data: unknown = await response.json(); const updatedAt = Number(data && typeof data === "object" ? (data as { updatedAt?: unknown }).updatedAt : 0) || 0;
    if (updatedAt) remoteUpdatedAt.current = updatedAt;
  };
  const changePositions = (apply: (current: StoredPosition[]) => StoredPosition[]) => {
    setPositions((current) => { const next = apply(current); savePositions(next); void pushRemotePositions(next).catch(() => {}); return next; });
  };
  useEffect(() => {
    let active = true;
    const start = async () => {
      const local = readPositions(); setPositions(local);
      try { const foundRemote = await pullRemotePositions(); if (!foundRemote) await pushRemotePositions(local); } catch { savePositions(local); }
      if (active) setReady(true);
    };
    void start(); return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => { void pullRemotePositions().catch(() => {}); }, 5000);
    const onVisibility = () => { if (document.visibilityState === "visible") void pullRemotePositions().catch(() => {}); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [ready]);
  useEffect(() => { setPositionAsset(asset); }, [asset]);
  useEffect(() => { if (currentPrice && currentPrice > 0) setPrices((current) => ({ ...current, [asset]: currentPrice })); }, [asset, currentPrice]);
  useEffect(() => {
    const tracked = [...new Set(positions.map((position) => position.asset).filter((item) => item !== asset))];
    if (!tracked.length) return;
    let active = true;
    const refresh = () => Promise.all(tracked.map((item) => fetchMarket(item, "1H").catch(() => fetchLiveStockMarket(item, "1H")).then((market) => [item, market.candles.at(-1)?.close] as const).catch(() => [item, undefined] as const))).then((rows) => {
      if (!active) return;
      setPrices((current) => ({ ...current, ...Object.fromEntries(rows.filter((row): row is [string, number] => Number.isFinite(row[1]) && (row[1] as number) > 0)) }));
    });
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [positions, asset]);

  const addPosition = () => {
    const entry = Number(averagePrice.replace(",", "."));
    const size = Number(quantity.replace(",", "."));
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(size) || size <= 0) return;
    changePositions((current) => [...current, { id: positionAsset + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), asset: positionAsset, side, averagePrice: entry, quantity: size }]);
    setAveragePrice(""); setQuantity("");
  };

  return <article className="card positionPanel">
    <div className="cardTitle positionTitle"><div><span>{"POSI\u00c7\u00d5ES EM ABERTO \u2022 TODOS OS ATIVOS"}</span><b>{"Controle de compra e venda"}</b></div><span className="positionQuote">{ready ? "SINCRONIZADO • " : "SINCRONIZANDO • "}{positions.length} POSIÇÃO(ÕES)</span></div>
    <div className="positionForm">
      <label><span>ATIVO</span><select value={positionAsset} onChange={(event) => setPositionAsset(event.target.value)}>{positionAssets.map((item) => <option key={item} value={item}>{displayAsset(item)}</option>)}</select></label>
      <label><span>C/V</span><select value={side} onChange={(event) => setSide(event.target.value as PositionSide)}><option value="LONG">C</option><option value="SHORT">V</option></select></label>
      <label><span>{"PRE\u00c7O M\u00c9DIO"}</span><input value={averagePrice} onChange={(event) => setAveragePrice(event.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Pre\u00e7o m\u00e9dio" /></label>
      <label><span>QTDE</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Quantidade" /></label>
      <button type="button" onClick={addPosition}>+ INCLUIR</button>
    </div>
    {positions.length ? <div className="positionList"><div className="positionHead"><span>ATIVO</span><span>C/V</span><span>ATUAL</span><span>{"M\u00c9DIO"}</span><span>QTDE</span><span>BRUTO</span></div>{positions.map((position) => {
      const currency = currencyFor(position.asset);
      const price = position.asset === asset && currentPrice ? currentPrice : prices[position.asset];
      const result = price ? calculatePosition({ ...position, currentPrice: price }) : null;
      const positive = (result?.grossPnl ?? 0) >= 0;
      const output = result ? (result.grossPnl >= 0 ? "+" : "") + money(result.grossPnl, currency) + " (" + (result.grossPercent >= 0 ? "+" : "") + result.grossPercent.toFixed(2) + "%)" : "AGUARDANDO";
      return <div className={"positionRow " + (position.side === "LONG" ? "long" : "short")} key={position.id}><div><span>ATIVO</span><b>{displayAsset(position.asset)}</b></div><div><span>C/V</span><b>{position.side === "LONG" ? "C" : "V"}</b></div><div><span>ATUAL</span><b>{price ? money(price, currency) : "\u2014"}</b></div><div><span>{"M\u00c9DIO"}</span><b>{money(position.averagePrice, currency)}</b></div><div><span>QTDE</span><b>{position.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</b></div><div className={positive ? "profit" : "loss"}><span>BRUTO</span><b>{output}</b></div><button type="button" onClick={() => changePositions((current) => current.filter((item) => item.id !== position.id))} aria-label={"Remover posi\u00e7\u00e3o de " + displayAsset(position.asset)}>{"\u00d7"}</button></div>;
    })}</div> : <p className="positionEmpty">{"Nenhuma posi\u00e7\u00e3o registrada. Selecione o ativo, C/V, pre\u00e7o m\u00e9dio e quantidade."}</p>}
    <p className="positionNote">{"Resultado bruto pela cota\u00e7\u00e3o atual. Taxas, financiamento e custos da corretora n\u00e3o est\u00e3o inclu\u00eddos."}</p>
  </article>;
}
