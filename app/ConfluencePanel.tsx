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
        <div className="cardTitle"><div><span>{"NEXUS \u2022 "}{asset}{" \u2022 "}{period}</span><b>{"Cruzando m\u00e9tricas, RSI e fluxo"}</b></div></div>
        <p>{"Processando candles conclu\u00eddos."}</p>
      </article>
    );
  }

  if (!data) {
    return (
      <article className="card nexus nexusEmpty">
        <div className="cardTitle"><div><span>{"NEXUS \u2022 "}{asset}{" \u2022 "}{period}</span><b>{"Fluxo agressor indispon\u00edvel"}</b></div></div>
        <p>{"Este ativo n\u00e3o fornece a separa\u00e7\u00e3o entre compras e vendas a mercado. Nenhuma estimativa foi criada."}</p>
      </article>
    );
  }

  const signed = (value: number) => (value > 0 ? "+" : "") + value;
  const tone = data.state === "BUY" ? "buy" : data.state === "SELL" ? "sell" : "neutral";
  const title = data.state === "BUY"
    ? "PRESS\u00c3O COMPRADORA"
    : data.state === "SELL"
      ? "PRESS\u00c3O VENDEDORA"
      : "FOR\u00c7AS EM DISPUTA";

  return (
    <article className={["card", "nexus", tone].join(" ")}>
      <div className="cardTitle">
        <div><span>{"NEXUS \u2022 "}{asset}{" \u2022 "}{period}</span><b>{title}</b></div>
        <span className="nexusScore">{signed(data.score)}</span>
      </div>
      <div className="nexusPulse">
        <div>
          <span>{"FLUXO AGRESSOR \u2022 "}{data.flow.window} CANDLES</span>
          <b>{(data.flow.buyShare * 100).toFixed(1)}% compra</b>
          <small>Delta {data.flow.deltaPercent > 0 ? "+" : ""}{data.flow.deltaPercent.toFixed(1)}%</small>
        </div>
        <div>
          <span>RSI CRUZADO</span>
          <b>{data.rsi.toFixed(1)}</b>
          <small>{"Confian\u00e7a "}{data.confidence}%</small>
        </div>
      </div>
      <div className="nexusFlow" aria-label={"Compra " + (data.flow.buyShare * 100).toFixed(1) + " por cento"}>
        <i style={{ width: (data.flow.buyShare * 100) + "%" }} />
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
      <p>{"Leitura atual de "}{asset}{" no per\u00edodo "}{period}{". Cada m\u00e9trica \u00e9 confrontada com o RSI e o volume agressor real. O NEXUS \u00e9 contexto separado e n\u00e3o altera a nota principal."}</p>
    </article>
  );
}
