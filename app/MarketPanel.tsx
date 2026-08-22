"use client";
import { useState, useMemo, useEffect } from "react";
import { useMarketStream } from "../lib/useMarketStream";

const WS_URL = "ws://localhost:3001";

function StatusDot({ status }: { status: string }) {
  const color = status === "LIVE" ? "var(--lime)" : status === "STALE" ? "#f0ad4e" : "var(--red)";
  return <span className="marketDot" style={{ background: color }} />;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score > 0 ? "var(--lime)" : score < 0 ? "var(--red)" : "var(--muted)";
  return (
    <span className="marketScore" style={{ color, borderColor: color }}>
      {score > 0 ? "+" : ""}{score}
    </span>
  );
}

function RegimeBadge({ regime, leigo }: { regime: string; leigo: boolean }) {
  const map: Record<string, { tech: string; simple: string; color: string }> = {
    TRENDING_UP: { tech: "TENDENCIA ALTA", simple: "Mercado subindo", color: "var(--lime)" },
    TRENDING_DOWN: { tech: "TENDENCIA BAIXA", simple: "Mercado caindo", color: "var(--red)" },
    RANGING: { tech: "LATERAL", simple: "Mercado parado", color: "#f0ad4e" },
    HIGH_VOLATILITY: { tech: "ALTA VOLATILIDADE", simple: "Mercado agitado", color: "var(--cyan)" },
    LOW_VOLATILITY: { tech: "BAIXA VOLATILIDADE", simple: "Mercado calmo", color: "var(--muted)" },
  };
  const r = map[regime] || { tech: regime, simple: regime, color: "var(--muted)" };
  return <span className="marketRegime" style={{ color: r.color }}>{leigo ? r.simple : r.tech}</span>;
}

function ImbalanceBar({ imb }: { imb: number }) {
  const pct = Math.round((imb + 1) * 50);
  const color = imb > 0.05 ? "var(--lime)" : imb < -0.05 ? "var(--red)" : "var(--muted)";
  return (
    <div className="marketImbBar">
      <div className="marketImbLabel" style={{ color: "var(--muted)" }}>VENDA</div>
      <div className="marketImbTrack">
        <div className="marketImbFill" style={{ width: `${pct}%`, background: color }} />
        <div className="marketImbCenter" />
      </div>
      <div className="marketImbLabel" style={{ color: "var(--muted)" }}>COMPRA</div>
    </div>
  );
}

function ImpactPhrase({ text }: { text: string }) {
  return <span className="marketImpact">{text}</span>;
}

function DataQuality({ quality }: { quality: { ws: string; oi: string; funding: string } }) {
  const items = [
    { label: "WS", status: quality.ws },
    { label: "OI", status: quality.oi },
    { label: "FUND", status: quality.funding },
  ];
  return (
    <div className="marketQuality">
      {items.map((it) => (
        <span key={it.label} className="marketQItem">
          <StatusDot status={it.status} />
          <span className="marketQLabel">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function getImbalancePhrase(imb: number): string {
  if (imb > 0.3) return "Compradores dominando com força — pressão de alta";
  if (imb > 0.1) return "Compradores liderando — demanda ativa nos suportes";
  if (imb > 0.05) return "Leve vantagem compradora — defesa passiva nos suportes";
  if (imb < -0.3) return "Vendedores dominando com força — pressão de baixa";
  if (imb < -0.1) return "Vendedores liderando — ofertas pesadas no topo";
  if (imb < -0.05) return "Leve vantagem vendedora — resistência ativa";
  return "Mercado equilibrado — compradores e vendedores empatados";
}

function getCvdPhrase(cvd: number): string {
  if (cvd > 500000) return "Fluxo comprador dominante — acumulação ativa";
  if (cvd > 100000) return "Mais ordens de compra executando — pressão compradora";
  if (cvd > 0) return "Leve viés comprador — mercado positivo";
  if (cvd < -500000) return "Grandes players descarregando a mercado — pressão vendedora institucional";
  if (cvd < -100000) return "Mais ordens de venda executando — pressão vendedora";
  if (cvd < 0) return "Leve viés vendedor — mercado negativo";
  return "Fluxo neutro — sem direção clara";
}

function getOiPhrase(oi: number, delta: number): string {
  const pct = delta * 100;
  if (pct > 0.5) return "Novos capitais entrando — mercado aquecendo";
  if (pct > 0.1) return "Posições crescendo — capital entrando devagar";
  if (pct < -0.5) return "Capital saindo do mercado — desalavancagem ativa";
  if (pct < -0.1) return "Posições reduzindo — money leaving";
  if (Math.abs(pct) < 0.01) return "Posições alavancadas estagnadas — sem novas entradas";
  return "Mercado lateral — sem movimento significativo";
}

function getFundingPhrase(funding: number, cls: string): string {
  if (cls === "extreme_positive") return "Funding extremo — mercado muito otimista (cuidado: reversão próxima)";
  if (cls === "extreme") return "Funding extremo — mercado muito pessimista (cuidado: reversão próxima)";
  if (funding > 0.03) return "Compradores pagando caro — otimismo exagerado do varejo";
  if (funding > 0.01) return "Compradores pagando a taxa — otimismo do varejo";
  if (funding > 0) return "Taxa neutra — mercado calmo";
  if (funding < -0.01) return "Vendedores pagando a taxa — pessimismo do varejo";
  return "Taxa negativa — varejo apostando queda";
}

export type FlowData = {
  score: number;
  cvdWhale: number;
  fundingRate: number;
  oiDelta: number;
};

export default function MarketPanel({ onFlowData }: { onFlowData?: (data: FlowData) => void }) {
  const { data, status } = useMarketStream(WS_URL, true);
  const [expanded, setExpanded] = useState(false);
  const [leigo, setLeigo] = useState(true);

  // Expor dados do fluxo para o motor de confluência
  useEffect(() => {
    if (data && onFlowData) {
      onFlowData({
        score: data.score,
        cvdWhale: data.cvd_whale,
        fundingRate: data.funding,
        oiDelta: data.oi_delta,
      });
    }
  }, [data, onFlowData]);

  const impactPhrases = useMemo(() => {
    if (!data || !leigo) return null;
    return {
      cvd: getCvdPhrase(data.cvd),
      cvdWhale: getCvdPhrase(data.cvd_whale),
      imb: getImbalancePhrase(data.imb),
      oi: getOiPhrase(data.oi, data.oi_delta),
      funding: getFundingPhrase(data.funding, data.funding_class),
    };
  }, [data, leigo]);

  if (!data && status !== "live") {
    return (
      <article className="card marketPanel">
        <div className="cardTitle">
          <div>
            <span>{leigo ? "FLUXO DO MERCADO" : "MARKET INGESTION"}</span>
            <b>{leigo ? "O que está acontecendo agora" : "Order Flow & Estrutura"}</b>
          </div>
          <span className="marketStatus">{status === "connecting" ? "CONECTANDO..." : "OFFLINE"}</span>
        </div>
        <div className="marketEmpty">Backend offline. Rode <code>node dist/index.js</code></div>
      </article>
    );
  }

  return (
    <article className="card marketPanel">
      <div className="cardTitle">
        <div>
          <span>{leigo ? "FLUXO DO MERCADO" : "MARKET INGESTION"}</span>
          <b>{leigo ? "O que está acontecendo agora" : "Order Flow & Estrutura"}</b>
        </div>
        <div className="marketHeaderRight">
          <ScoreBadge score={data?.score ?? 0} />
          <button
            className="marketToggle"
            onClick={() => setLeigo(!leigo)}
            title={leigo ? "Modo técnico" : "Modo leigo"}
          >
            {leigo ? "LEIGO" : "TÉCNICO"}
          </button>
        </div>
      </div>

      <div className="marketGrid">
        {/* Preço */}
        <div className="marketCell marketPriceCell">
          <span className="marketLabel">{leigo ? "PREÇO ATUAL" : "PREÇO"}</span>
          <span className="marketPrice">${data?.p?.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
        </div>

        {/* Regime */}
        <div className="marketCell">
          <span className="marketLabel">{leigo ? "COMO O MERCADO ESTÁ" : "REGIME"}</span>
          <RegimeBadge regime={data?.regime ?? "RANGING"} leigo={leigo} />
        </div>

        {/* Imbalance */}
        <div className="marketCell marketImbCell">
          <span className="marketLabel">{leigo ? "QUEM ESTÁ DOMINANDO" : "ORDER BOOK IMBALANCE"}</span>
          <span className="marketValue" style={{ color: (data?.imb ?? 0) > 0 ? "var(--lime)" : (data?.imb ?? 0) < 0 ? "var(--red)" : "var(--muted)" }}>
            {((data?.imb ?? 0) * 100).toFixed(1)}%
          </span>
          <ImbalanceBar imb={data?.imb ?? 0} />
          {impactPhrases && <ImpactPhrase text={impactPhrases.imb} />}
        </div>

        {/* CVD */}
        <div className="marketCell">
          <span className="marketLabel">{leigo ? "PRESSIONE DE COMPRA/VENDA" : "CVD TOTAL"}</span>
          <span className="marketValue" style={{ color: (data?.cvd ?? 0) > 0 ? "var(--lime)" : "var(--red)" }}>
            {(data?.cvd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
          {impactPhrases && <ImpactPhrase text={impactPhrases.cvd} />}
        </div>

        <div className="marketCell">
          <span className="marketLabel">{leigo ? "MOVIMENTO DOS GRANDES" : "CVD WHALE"}</span>
          <span className="marketValue" style={{ color: (data?.cvd_whale ?? 0) > 0 ? "var(--lime)" : "var(--red)" }}>
            {(data?.cvd_whale ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
          {impactPhrases && <ImpactPhrase text={impactPhrases.cvdWhale} />}
        </div>

        {/* Derivativos */}
        <div className="marketCell">
          <span className="marketLabel">{leigo ? "DINHEIRO NO MERCADO" : "OPEN INTEREST"}</span>
          <span className="marketValue">{(data?.oi ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          <span className="marketDelta" style={{ color: (data?.oi_delta ?? 0) > 0 ? "var(--lime)" : (data?.oi_delta ?? 0) < 0 ? "var(--red)" : "var(--muted)" }}>
            {(data?.oi_delta ?? 0) > 0 ? "+" : ""}{((data?.oi_delta ?? 0) * 100).toFixed(3)}%
          </span>
          {impactPhrases && <ImpactPhrase text={impactPhrases.oi} />}
        </div>

        <div className="marketCell">
          <span className="marketLabel">{leigo ? "CUSTO DE MANUTENÇÃO" : "FUNDING RATE"}</span>
          <span className="marketValue">{((data?.funding ?? 0) * 100).toFixed(4)}%</span>
          <span className="marketDelta" style={{ color: data?.funding_class === "extreme" ? "var(--red)" : "var(--muted)" }}>
            {leigo
              ? (data?.funding_class === "extreme_positive" ? "EXTREMO OTIMISTA" :
                 data?.funding_class === "extreme" ? "EXTREMO PESSIMISTA" :
                 (data?.funding ?? 0) > 0 ? "OTIMISMO" : (data?.funding ?? 0) < 0 ? "PESSIMISMO" : "NEUTRO")
              : data?.funding_class?.toUpperCase()}
          </span>
          {impactPhrases && <ImpactPhrase text={impactPhrases.funding} />}
        </div>
      </div>

      {/* Toggle expandir */}
      <button className="marketExpand" onClick={() => setExpanded(!expanded)}>
        {expanded ? "RECOLHER" : leigo ? "EXPLICAR TUDO" : "DETALHES"}
      </button>

      {expanded && (
        <div className="marketExpanded">
          <div className="marketExpandedGrid">
            <div className="marketCell">
              <span className="marketLabel">{leigo ? "CONFIABILIDADE" : "QUALIDADE DO SINAL"}</span>
              <span className="marketValue">{data?.score_quality}/100</span>
            </div>
            <div className="marketCell">
              <span className="marketLabel">{leigo ? "ALERTAS" : "EVENTOS"}</span>
              <span className="marketValue">{data?.events?.length ?? 0}</span>
            </div>
          </div>
          {data?.events && data.events.length > 0 && (
            <div className="marketEvents">
              {data.events.map((ev, i) => (
                <div key={i} className="marketEvent">
                  <span className="marketEventDot" style={{ background: ev.direction === "bullish" ? "var(--lime)" : ev.direction === "bearish" ? "var(--red)" : "var(--muted)" }} />
                  <span>{leigo
                    ? `${ev.type === "whale_buy" ? "Compra baleia" : ev.type === "whale_sell" ? "Venda baleia" : ev.type}: ${ev.direction === "bullish" ? "comprador" : ev.direction === "bearish" ? "vendedor" : "neutro"}`
                    : `${ev.type}: ${ev.direction} (${ev.magnitude.toFixed(1)})`
                  }</span>
                </div>
              ))}
            </div>
          )}
          <DataQuality quality={data?.quality ?? { ws: "UNKNOWN", oi: "UNKNOWN", funding: "UNKNOWN" }} />
        </div>
      )}
    </article>
  );
}
