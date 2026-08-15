"use client";

import { useEffect, useMemo, useState } from "react";
import { calculatePosition, type PositionSide } from "../lib/positions";

type StoredPosition = { id: string; asset: string; side: PositionSide; averagePrice: number; quantity: number };
const STORAGE_KEY = "termometro-positions";

function readPositions(): StoredPosition[] {
  if (typeof window === "undefined") return [];
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((position): position is StoredPosition => Boolean(position && typeof position === "object" && typeof (position as StoredPosition).id === "string" && typeof (position as StoredPosition).asset === "string" && ["LONG", "SHORT"].includes((position as StoredPosition).side) && Number.isFinite((position as StoredPosition).averagePrice) && Number.isFinite((position as StoredPosition).quantity)));
  } catch { return []; }
}

export default function PositionPanel({ asset, assetLabel, currency, currentPrice }: { asset: string; assetLabel: string; currency: string; currentPrice?: number }) {
  const [positions, setPositions] = useState<StoredPosition[]>([]);
  const [ready, setReady] = useState(false);
  const [side, setSide] = useState<PositionSide>("LONG");
  const [averagePrice, setAveragePrice] = useState("");
  const [quantity, setQuantity] = useState("");
  useEffect(() => { setPositions(readPositions()); setReady(true); }, []);
  useEffect(() => { if (!ready) return; try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); } catch {} }, [positions, ready]);
  const visiblePositions = useMemo(() => positions.filter((position) => position.asset === asset), [asset, positions]);
  const money = (value: number) => currency + " " + value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const addPosition = () => {
    const entry = Number(averagePrice.replace(",", "."));
    const size = Number(quantity.replace(",", "."));
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(size) || size <= 0) return;
    setPositions((current) => [...current, { id: asset + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), asset, side, averagePrice: entry, quantity: size }]);
    setAveragePrice(""); setQuantity("");
  };
  return <article className="card positionPanel">
    <div className="cardTitle positionTitle"><div><span>{"POSI\u00c7\u00d5ES EM ABERTO \u2022 "}{assetLabel}</span><b>{"Controle de compra e venda"}</b></div><span className="positionQuote">{currentPrice ? money(currentPrice) : "COTA\u00c7\u00c3O INDISPON\u00cdVEL"}</span></div>
    <div className="positionForm">
      <label><span>{"POSI\u00c7\u00c3O"}</span><select value={side} onChange={(event) => setSide(event.target.value as PositionSide)}><option value="LONG">COMPRADO</option><option value="SHORT">VENDIDO</option></select></label>
      <label><span>{"PRE\u00c7O M\u00c9DIO"}</span><input value={averagePrice} onChange={(event) => setAveragePrice(event.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Pre\u00e7o m\u00e9dio" /></label>
      <label><span>QUANTIDADE</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" placeholder="0,00" aria-label="Quantidade" /></label>
      <button type="button" onClick={addPosition} disabled={!currentPrice}>+ INCLUIR</button>
    </div>
    {visiblePositions.length ? <div className="positionList">{visiblePositions.map((position) => {
      const result = currentPrice ? calculatePosition({ ...position, currentPrice }) : null;
      const positive = (result?.grossPnl ?? 0) >= 0;
      const output = result ? (result.grossPnl >= 0 ? "+" : "") + money(result.grossPnl) + " (" + (result.grossPercent >= 0 ? "+" : "") + result.grossPercent.toFixed(2) + "%)" : "AGUARDANDO COTA\u00c7\u00c3O";
      return <div className={"positionRow " + (position.side === "LONG" ? "long" : "short")} key={position.id}><div><span>{position.side === "LONG" ? "COMPRADO" : "VENDIDO"}</span><b>{assetLabel}</b></div><div><span>{"PRE\u00c7O M\u00c9DIO"}</span><b>{money(position.averagePrice)}</b></div><div><span>QUANTIDADE</span><b>{position.quantity.toLocaleString("pt-BR", { maximumFractionDigits: 8 })}</b></div><div className={positive ? "profit" : "loss"}><span>RESULTADO BRUTO</span><b>{output}</b></div><button type="button" onClick={() => setPositions((current) => current.filter((item) => item.id !== position.id))} aria-label={"Remover posi\u00e7\u00e3o de " + assetLabel}>{"\u00d7"}</button></div>;
    })}</div> : <p className="positionEmpty">{"Nenhuma posi\u00e7\u00e3o registrada para "}{assetLabel}{". Os dados ficam salvos somente neste navegador."}</p>}
    <p className="positionNote">{"Resultado bruto pela cota\u00e7\u00e3o atual. Taxas, financiamento e custos da corretora n\u00e3o est\u00e3o inclu\u00eddos."}</p>
  </article>;
}
