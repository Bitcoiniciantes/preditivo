import type { ConfluenceReading } from "../lib/types";

export default function ConfluencePanel({
  data,
  loading,
  asset,
  period,
}: {
  data: ConfluenceReading | null;
  loading: boolean;
  asset: string;
  period: string;
}) {
  if (loading) {
    return (
      <article className="card nexus nexusEmpty">
        <div className="cardTitle"><div><span className="nexusIdentity">NEXUS • <strong>{asset} • {period}</strong></span><b>{"Cruzando m\u00e9tricas, RSI e fluxo"}</b></div></div>
        <p>{"Processando candles conclu\u00eddos."}</p>
      </article>
    );
  }

  if (!data) {
    return (
      <article className="card nexus nexusEmpty">
        <div className="cardTitle"><div><span className="nexusIdentity">NEXUS • <strong>{asset} • {period}</strong></span><b>{"Fluxo agressor indispon\u00edvel"}</b></div></div>
        <p>{"Este ativo n\u00e3o fornece a separa\u00e7\u00e3o entre compras e vendas a mercado. Nenhuma estimativa foi criada."}</p>
      </article>
    );
  }

  const signed = (value: number) => (value > 0 ? "+" : "") + value;
  const tone = data.state === "BUY" ? "buy" : data.state === "SELL" ? "sell" : "neutral";
  const flowTone = !data.flow ? "neutral" : data.flow.deltaPercent >= 6 ? "buyer" : data.flow.deltaPercent <= -6 ? "seller" : "neutral";
  const rsiTone = data.rsi >= 55 ? "buyer" : data.rsi <= 45 ? "seller" : "neutral";
  const title = data.state === "BUY"
    ? "PRESS\u00c3O COMPRADORA"
    : data.state === "SELL"
      ? "PRESS\u00c3O VENDEDORA"
      : "FOR\u00c7AS EM DISPUTA";

  return (
    <article className={["card", "nexus", tone].join(" ")}>
      <div className="cardTitle">
        <div><span className="nexusIdentity">NEXUS • <strong>{asset} • {period}</strong></span><b>{title}</b></div>
        <span className="nexusScore">{signed(data.score)}</span>
      </div>
      <div className="nexusPulse">
        <div>
          {data.flow ? <>
            <span>{"FLUXO AGRESSOR \u2022 "}{data.flow.window} CANDLES</span>
            <b className={flowTone}>{(data.flow.buyShare * 100).toFixed(1)}% compra</b>
            <small className={flowTone}>Delta {data.flow.deltaPercent > 0 ? "+" : ""}{data.flow.deltaPercent.toFixed(1)}%</small>
          </> : <>
            <span>FLUXO AGRESSOR</span>
            <b className="neutral">{"INDISPON\u00cdVEL"}</b>
            <small>{"RSI e m\u00e9tricas continuam ativos"}</small>
          </>}
        </div>
        <div>
          <span>RSI CRUZADO</span>
          <b className={rsiTone}>{data.rsi.toFixed(1)}</b>
          <small>{"Confian\u00e7a "}{data.confidence}%</small>
        </div>
      </div>
      {data.flow ? <>
        <div className="nexusFlow" aria-label={"Compra " + (data.flow.buyShare * 100).toFixed(1) + " por cento"}>
          <i style={{ width: (data.flow.buyShare * 100) + "%" }} />
        </div>
        <div className="nexusLegend">
          <span>VENDA {(100 - data.flow.buyShare * 100).toFixed(1)}%</span>
          <span>COMPRA {(data.flow.buyShare * 100).toFixed(1)}%</span>
        </div>
      </> : <div className="nexusFlowUnavailable">{"Fluxo comprador/vendedor n\u00e3o fornecido pela fonte."}</div>}
      <div className="nexusMatrix">
        {data.rows.map((row) => {
          const ringTone = row.alignment > 0 ? "#70efaa" : row.alignment < 0 ? "#ff7885" : "#c9a64b";
          const ringDegrees = Math.min(100, Math.abs(row.alignment)) * 3.6;
          return <div key={row.metric} className={[row.status, row.baseScore > 0 ? "buyer" : row.baseScore < 0 ? "seller" : "neutral"].join(" ")}>
            <div className="nexusMetricHead"><b>{row.metric}</b><span className="nexusMiniRing" style={{ background: `conic-gradient(${ringTone} 0deg ${ringDegrees}deg, #47534d ${ringDegrees}deg 360deg)` }} aria-label={`Força ${signed(row.alignment)}`}><i>{row.alignment === 0 ? "=" : signed(row.alignment)}</i></span></div>
            <span>{row.status === "aligned" ? "CONFIRMA" : row.status === "conflict" ? "CONFLITA" : "NEUTRO"}</span>
            <strong>{row.alignment === 0 ? "EMPATE" : signed(row.alignment)}</strong>
            <small>{"NOTA BASE "}{signed(row.baseScore)}</small>
          </div>;
        })}
      </div>
      <p>{"Leitura atual de "}{asset}{" no per\u00edodo "}{period}{data.flow ? ". Cada m\u00e9trica \u00e9 confrontada com o RSI e o volume agressor real." : ". Leitura parcial: m\u00e9tricas e RSI ativos; fluxo agressor indispon\u00edvel."}{" O NEXUS \u00e9 contexto separado e n\u00e3o altera a nota principal."}</p>
    </article>
  );
}
