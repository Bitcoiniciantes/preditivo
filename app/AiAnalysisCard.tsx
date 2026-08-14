"use client";

import { useEffect, useRef, useState } from "react";
import {
  AiAnalysisError,
  buildLocalAiPreview,
  fetchAiAnalysis,
  fetchAssetNews,
  type AssetNewsResponse,
  readCachedAiAnalysis,
  writeCachedAiAnalysis,
  type AiAnalysisRequest,
  type AiAnalysisResponse,
} from "../lib/ai";

type AnalysisSource = "local" | "groq" | "mimo" | "gemini" | "cache" | null;

function formatNewsDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : ` • ${date.toLocaleDateString("pt-BR")}`;
}

function LoadingPhrases({ asset, period }: { asset: string; period: string }) {
  const perPhrase = 2.4;
  const phrases = [
    `Consultando o Analista Digital para ${asset}…`,
    `Período ${period} em análise…`,
    "Lendo os dados públicos de mercado…",
    "Buscando notícias recentes…",
    "Interpretando os sinais técnicos…",
    "Montando a resposta educativa…",
  ];
  const cycle = phrases.length * perPhrase;
  return (
    <div className="aiPhraseLoading" role="status" aria-live="polite" aria-label="A IA está interpretando os sinais">
      <div className="aiPhraseLoadingPhrases">
        {phrases.map((phrase, index) => (
          <span key={phrase} style={{ animationDuration: `${cycle}s`, animationDelay: `${index * perPhrase}s` }}>
            {phrase}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AiAnalysisCard({
  payload,
  disabled,
  autoRunKey = 0,
}: {
  payload: AiAnalysisRequest;
  disabled: boolean;
  autoRunKey?: number;
}) {
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [source, setSource] = useState<AnalysisSource>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [news, setNews] = useState<AssetNewsResponse | null>(null);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const processedAutoRunKey = useRef(autoRunKey);
  const [elapsedSecs, setElapsedSecs] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  const stopElapsedTimer = () => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  useEffect(() => () => { requestRef.current?.abort(); stopElapsedTimer(); }, []);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setTimeout(() => {
      if (retryAfter <= 1) {
        setRetryAfter(0);
        setError("");
      } else {
        setRetryAfter(retryAfter - 1);
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);



  useEffect(() => {
    const controller = new AbortController();
    setNewsLoading(true);
    setNewsError(false);
    setNews(null);
    fetchAssetNews(payload.asset, controller.signal)
      .then(result => { if (!controller.signal.aborted) setNews(result); })
      .catch(() => { if (!controller.signal.aborted) setNewsError(true); })
      .finally(() => { if (!controller.signal.aborted) setNewsLoading(false); });
    return () => controller.abort();
  }, [payload.asset]);

  const generate = async (force = false) => {
    if (loading) return;
    setError("");
    setRetryAfter(0);
    if (!force) {
      const cached = readCachedAiAnalysis(payload);
      if (cached) {
        setAnalysis(cached);
        setSource("cache");
        return;
      }
    }

    const localPreview = buildLocalAiPreview(payload);
    if (!analysis) {
      setAnalysis(localPreview);
      setSource("local");
    }
    setLoading(true);
    const controller = new AbortController();
    requestRef.current = controller;
    startedAtRef.current = performance.now();
    setElapsedSecs(0);
    elapsedTimerRef.current = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsedSecs(Math.floor((performance.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    try {
      const refined = await fetchAiAnalysis({ ...payload, localPreview }, controller.signal);
      if (controller.signal.aborted) return;
      stopElapsedTimer();
      if (startedAtRef.current !== null) {
        setElapsedSecs(Math.floor((performance.now() - startedAtRef.current) / 1000));
      }
      startedAtRef.current = null;
      setAnalysis(refined);
      setSource(refined.provider || "groq");
      writeCachedAiAnalysis(payload, refined);
    } catch (cause) {
      if (controller.signal.aborted) return;
      stopElapsedTimer();
      setError(cause instanceof Error ? cause.message : "Análise por IA indisponível.");
      setRetryAfter(cause instanceof AiAnalysisError ? cause.retryAfterSeconds : 0);
    } finally {
      stopElapsedTimer();
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!autoRunKey || autoRunKey === processedAutoRunKey.current || disabled) return;
    processedAutoRunKey.current = autoRunKey;
    void generate(false);
  }, [autoRunKey, disabled]);
  const sourceLabel = source === "local"
    ? loading ? "PRÉ-ANÁLISE LOCAL • IA REFINANDO…" : "PRÉ-ANÁLISE LOCAL"
    : source === "cache"
      ? "LEITURA SALVA • ATÉ 5 MINUTOS"
      : source === "mimo"
      ? "ANÁLISE DIGITAL CONCLUÍDA"
      : source === "gemini"
        ? "ANÁLISE DIGITAL CONCLUÍDA"
        : "";
  const providerLabel = analysis?.provider === "gemini"
    ? "Gemini"
    : analysis?.provider === "groq"
      ? "Groq"
      : analysis?.provider === "mimo"
        ? "MiMo"
        : source === "local"
          ? "Local"
          : null;

  const riskLevel = payload.confidence < 55 || payload.volumeRatio < 0.7 ? "ELEVADO" : Math.abs(payload.change) >= 4 || payload.confidence < 70 ? "MODERADO" : "CONTROLADO";

  return (
    <article id="analista-digital" className="card aiAnalysis" aria-busy={loading}>
      <div className="cardTitle">
        <div><span>ANÁLISE ASSISTIDA</span><b>Analista Digital{providerLabel ? ` (${providerLabel})` : ""}{elapsedSecs !== null ? ` ${String(elapsedSecs).padStart(2, "0")}s` : ""}</b></div>
        <span className="aiBadge">IA</span>
      </div>
      {!analysis ? (
        <div className="aiIntro">
          <p>A IA interpreta os sinais já calculados pelo Termômetro. Ela não altera notas, preços ou níveis.</p>
          <button type="button" onClick={() => void generate(false)} disabled={disabled || loading || retryAfter > 0}>
            {loading ? "ANALISANDO…" : retryAfter > 0 ? `AGUARDE ${retryAfter}s` : "GERAR LEITURA"}
          </button>
          {error && <small className="aiError" role="alert">{retryAfter > 0 ? `Limite temporário da API atingido. Aguarde ${retryAfter}s.` : error}</small>}
        </div>
      ) : (
        <div className="aiResult">
          {sourceLabel && <small className={`aiSource ${source}`} role="status">{sourceLabel}</small>}
          {loading && <LoadingPhrases asset={payload.asset} period={payload.period} />}
          <div className={`aiScenario ${analysis.scenario.toLowerCase().replace(" ", "-")}`}>
            <span>CENÁRIO</span><b>{analysis.scenario}</b>
          </div>
          <h3>{analysis.headline}</h3>
          <div className={`aiRiskAssessment ${riskLevel.toLowerCase()}`}><div><span>▣ AVALIAÇÃO DE RISCO</span><b>{riskLevel}</b></div><p>{riskLevel==="ELEVADO"?"Volume ou concordância insuficientes aumentam a chance de falsos movimentos.":riskLevel==="MODERADO"?"O cenário exige confirmação por fechamento e volume antes de qualquer conclusão.":"Sinais e volume oferecem contexto mais consistente, mas o risco de mercado permanece."}</p></div>
          <p>{analysis.summary}</p>
          <div className="aiSection"><b>ESTRATÉGIA CONDICIONAL</b><ol>{analysis.strategy.map(item => <li key={item}>{item}</li>)}</ol></div>
          <div className="aiSection aiRisks"><b>RISCOS</b><ul>{analysis.risks.map(item => <li key={item}>{item}</li>)}</ul></div>
          <div className="aiInvalidation"><span>INVALIDAÇÃO DA LEITURA</span><p>{analysis.invalidation}</p></div>

          <div className="aiSection aiNews">
            <b>FATOS RELEVANTES</b>
            {newsLoading ? <p>Buscando notícias recentes?</p> : newsError ? <p>Não foi possível carregar as notícias agora. Tente novamente mais tarde.</p> : news?.items.length ? (
              <ul>{news.items.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><small>{item.source}{formatNewsDate(item.publishedAt)}</small></li>)}</ul>
            ) : <p>Sem notícias relevantes encontradas nas últimas 48 horas.</p>}
          </div>
          <div className="aiActions"><small>Leitura gerada em {new Date(analysis.generatedAt).toLocaleString("pt-BR")}</small></div>
          {error && <small className="aiError" role="alert">{retryAfter > 0 ? `Limite temporário da API atingido. Aguarde ${retryAfter}s.` : error}</small>}
        </div>
      )}
      <p className="aiDisclaimer">Leitura quantitativa gerada por IA para analise de mercado.</p>
    </article>
  );
}
