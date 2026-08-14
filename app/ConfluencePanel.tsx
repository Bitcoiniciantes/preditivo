import type { ConfluenceReading } from "../lib/types";

export default function ConfluencePanel({
  data,
  loading,
}: {
  data: ConfluenceReading | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <article className="card nexus nexusEmpty">
        <div className="cardTitle"><div><span>NEXUS</span><b>Cruzando m�tricas, RSI e fluxo</b></div></div>
        <p>Processando candles conclu�dos.</p>
      </article>
    );
  }

  if (!data) {
    return (
      <article className="card nexus nexusEmpty">
        <div className="cardTitle"><div><span>NEXUS</span><b>Fluxo agressor indispon�vel</b></div></div>
        <p>Este ativo n�o fornece a separa��o entre compras e vendas a mercado. Nenhuma estimativa foi criada.</p>
      </article>
    );
  }

  const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
  const tone = data.state === "BUY" ? "buy" : data.state === "SELL" ? "sell" : "neutral";
  const title = data.state === "BUY"
    ? "PRESS�O COMPRADORA"
    : data.state === "SELL"
      ? "PRESS�O VENDEDORA"
      : "FOR�AS EM DISPUTA";

  return (
    <article className={`card nexus ${tone}`}>
      <div className="cardTitle">
        <div><span>NEXUS � MATRIZ DE CONFLU�NCIA</span><b>{title}</b></div>
        <span className="nexusScore">{signed(data.score)}</span>
      </div>
      <div className="nexusPulse">
        <div>
          <span>FLUXO AGRESSOR � {data.flow.window} CANDLES</span>
          <b>{(data.flow.buyShare * 100).toFixed(1)}% compra</b>
          <small>Delta {data.flow.deltaPercent > 0 ? "+" : ""}{data.flow.deltaPercent.toFixed(1)}%</small>
        </div>
        <div>
          <span>RSI CRUZADO</span>
          <b>{data.rsi.toFixed(1)}</b>
          <small>Confian�a {data.confidence}%</small>
        </div>
      </div>
      <div className="nexusFlow" aria-label={`Compra ${(data.flow.buyShare * 100).toFixed(1)} por cento`}>
        <i style={{ width: `${data.flow.buyShare * 100}%` }} />
      </div>
      <div className="nexusLegend">
        <span>VENDA {(100 - data.flow.buyShare * 100).toFixed(1)}%</span>
        <span>COMPRA {(data.flow.buyShare * 100).toFixed(1)}%</span>
      </div>
      <div className="nexusMatrix">
        {data.rows.map((row) => (
          <div key={row.metric} className={row.status}>
            <b>{row.metric}</b>
            <span>{row.status === "aligned" ? "CONFIRMA" : row.status === "conflict" ? "CONFLITA" : "NEUTRO"}</span>
            <strong>{signed(row.alignment)}</strong>
          </div>
        ))}
      </div>
      <p>Cada m�trica � confrontada com o RSI e o volume agressor real. O NEXUS � contexto separado e n�o altera a nota principal.</p>
    </article>
  );
}
