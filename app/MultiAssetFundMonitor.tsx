"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeBrakeRadar,
  BRAKE_ASSETS,
  BRAKE_MAX_EXTRA_ASSETS,
  brakeAssetName,
  fetchBrakeKlines,
  fetchBrakeSpotQuote,
  formatPreservedMinutes,
  toBrakeSpotSymbol,
  type BrakeKlinesSnapshot,
  type BrakeSpotQuote,
} from "../lib/brake-radar";
import { analyzeTopRadar } from "../lib/top-radar";

const REFRESH_MS = 60_000;
const fundPillLabel: Record<string, string> = {
  REACTION: "CONFIRMADA",
  REBOUND: "OBSERVAR",
  SLOWING: "DESACELERANDO",
  ACCELERATING: "QUEDA",
  UNSTABLE: "QUEDA",
  NO_DROP: "STAND-BY",
  UNAVAILABLE: "SEM DADOS",
};
const topPillLabel: Record<string, string> = {
  EXHAUSTION_CONFIRMED: "EXAUSTÃO",
  TOP_WATCH: "OBSERVAR",
  DECELERATING: "DESACELERA",
  STRONG_UPTREND: "ALTA",
  ORIGIN_LOST: "ORIGEM",
  NEUTRAL: "NEUTRO",
  UNAVAILABLE: "SEM DADOS",
};

const EMPTY_SNAPSHOT: {
  h1: BrakeKlinesSnapshot["h1"];
  m15: BrakeKlinesSnapshot["m15"];
  fetchedAt: number | null;
} = { h1: [], m15: [], fetchedAt: null };

type RadarMode = "fundos" | "topos";
type AssetMeta = { symbol: string; name: string; base: boolean };

function fmtPct(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const absolute = Math.abs(rounded).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const sign = rounded < 0 ? "−" : signed && rounded > 0 ? "+" : "";
  return `${sign}${absolute}%`;
}

function fmtQuotePrice(quote: BrakeSpotQuote | null | undefined): string {
  const value = quote?.price;
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "Indisponível";
  return `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function MultiAssetFundMonitor({
  btcSnapshot,
  now,
  radar,
  extraSymbols,
  onSelect,
  onAddExtra,
  onRemoveExtra,
}: {
  btcSnapshot: BrakeKlinesSnapshot | null;
  now: number;
  radar: RadarMode;
  extraSymbols: string[];
  onSelect: (symbol: string, snapshot: BrakeKlinesSnapshot | null) => void;
  onAddExtra: (symbol: string) => void;
  onRemoveExtra: (symbol: string) => void;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, BrakeKlinesSnapshot>>({});
  const [selected, setSelected] = useState<string>("BTCUSDT");

  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareQuotes, setCompareQuotes] = useState<Record<string, BrakeSpotQuote | null>>({});
  const [compareQuoteLoading, setCompareQuoteLoading] = useState<Record<string, boolean>>({});
  const allowedSymbolsRef = useRef<Set<string>>(new Set());

  const assets = useMemo<AssetMeta[]>(() => {
    const base = BRAKE_ASSETS.map(({ symbol, name }) => ({ symbol, name, base: true }));
    const extras = extraSymbols
      .filter((s) => !BRAKE_ASSETS.some((b) => b.symbol === s))
      .slice(0, BRAKE_MAX_EXTRA_ASSETS)
      .map((symbol) => ({ symbol, name: brakeAssetName(symbol), base: false }));
    return [...base, ...extras];
  }, [extraSymbols]);

  const allSymbols = useMemo(() => assets.map((a) => a.symbol), [assets]);

  useEffect(() => {
    allowedSymbolsRef.current = new Set(allSymbols);
  }, [allSymbols]);

  useEffect(() => {
    if (!allSymbols.includes(selected)) setSelected("BTCUSDT");
  }, [allSymbols, selected]);

  // Limpa imediatamente dados em memória de ativos removidos e evita restauração por respostas pendentes.
  useEffect(() => {
    const allowed = new Set(allSymbols);
    setSnapshots((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (!allowed.has(key)) { delete next[key]; changed = true; }
      }
      return changed ? next : current;
    });
    setCompareQuotes((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (!allowed.has(key)) { delete next[key]; changed = true; }
      }
      return changed ? next : current;
    });
    setCompareQuoteLoading((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (!allowed.has(key)) { delete next[key]; changed = true; }
      }
      return changed ? next : current;
    });
  }, [allSymbols.join("|")]);

  // BTC usa snapshot compartilhado do pai; demais são buscados aqui.
  const effectiveSnapshots = useMemo<Record<string, BrakeKlinesSnapshot | undefined>>(() => {
    const next: Record<string, BrakeKlinesSnapshot | undefined> = { ...snapshots };
    if (btcSnapshot) next.BTCUSDT = btcSnapshot;
    else delete next.BTCUSDT;
    return next;
  }, [btcSnapshot, snapshots]);

  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running) return;
      running = true;
      const symbols = allSymbols.filter((symbol) => symbol !== "BTCUSDT");
      const results = await Promise.allSettled(symbols.map((symbol) => fetchBrakeKlines(controller.signal, symbol)));
      if (active) {
        setSnapshots((current) => {
          const allowed = allowedSymbolsRef.current;
          const next = { ...current };
          results.forEach((result, index) => {
            const symbol = symbols[index];
            if (result.status === "fulfilled" && allowed.has(symbol)) next[symbol] = result.value;
          });
          // remove snapshots de ativos que saíram da lista
          for (const key of Object.keys(next)) {
            if (!allowed.has(key)) delete next[key];
          }
          return next;
        });
      }
      running = false;
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [allSymbols.join("|")]);

  // Mantém o radar principal sincronizado com o ativo selecionado.
  useEffect(() => {
    onSelect(selected, effectiveSnapshots[selected] ?? null);
  }, [effectiveSnapshots, onSelect, selected]);

  const fundReadings = useMemo(
    () => Object.fromEntries(allSymbols.map((symbol) => [symbol, analyzeBrakeRadar({ ...(effectiveSnapshots[symbol] ?? EMPTY_SNAPSHOT), now })])),
    [allSymbols, effectiveSnapshots, now],
  );
  const topReadings = useMemo(
    () => Object.fromEntries(allSymbols.map((symbol) => [symbol, analyzeTopRadar({ ...(effectiveSnapshots[symbol] ?? EMPTY_SNAPSHOT), now })])),
    [allSymbols, effectiveSnapshots, now],
  );
  const readings = radar === "fundos" ? fundReadings : topReadings;
  const labels = radar === "fundos" ? fundPillLabel : topPillLabel;
  const fallingAssets = radar === "fundos"
    ? allSymbols.filter((symbol) => ["ACCELERATING", "UNSTABLE"].includes(fundReadings[symbol]?.state ?? "")).length
    : 0;

  useEffect(() => {
    if (addOpen) window.setTimeout(() => addInputRef.current?.focus(), 0);
  }, [addOpen]);

  const submitAdd = async () => {
    const candidate = toBrakeSpotSymbol(addQuery);
    if (!candidate) {
      setAddError("Informe um ticker de criptomoeda válido (ex.: XRP).");
      return;
    }
    if (allSymbols.includes(candidate)) {
      setAddError("Este ativo já está no radar.");
      return;
    }
    if (extraSymbols.length >= BRAKE_MAX_EXTRA_ASSETS) {
      setAddError(`Limite de ${BRAKE_MAX_EXTRA_ASSETS} ativos adicionais atingido.`);
      return;
    }
    setAddBusy(true);
    setAddError("");
    try {
      const [snapshot, quote] = await Promise.all([
        fetchBrakeKlines(undefined, candidate),
        fetchBrakeSpotQuote(candidate).catch(() => null),
      ]);
      if (!snapshot?.h1?.length || !snapshot?.m15?.length) {
        setAddError("Dados históricos insuficientes (1h/15m) para este ativo.");
        return;
      }
      if (quote && quote.symbol !== candidate) {
        setAddError("Símbolo retornado não corresponde ao ticker solicitado.");
        return;
      }
      // aceita apenas pares com dados válidos na Binance Spot; análise confirmará elegibilidade operacional
      onAddExtra(candidate);
      setAddQuery("");
      setAddOpen(false);
      setSelected(candidate);
    } catch {
      setAddError("Ativo não compatível com o Radar de Reversão. Aceitos apenas criptoativos da Binance Spot com candles 1h/15m disponíveis.");
    } finally {
      setAddBusy(false);
    }
  };

  const validCompareSymbols = useMemo(
    () => allSymbols.filter((symbol) => {
      const snap = effectiveSnapshots[symbol];
      const reading = readings[symbol];
      return !!snap && reading && reading.state !== "UNAVAILABLE";
    }),
    [allSymbols, effectiveSnapshots, readings],
  );

  useEffect(() => {
    if (!compareOpen) return;
    setCompareA((a) => (a && validCompareSymbols.includes(a) ? a : ""));
    setCompareB((b) => (b && validCompareSymbols.includes(b) ? b : ""));
  }, [compareOpen, validCompareSymbols.join("|")]);

  // Cotações sob demanda para comparação (sem polling extra): busca apenas os selecionados e reutiliza em cache local.
  useEffect(() => {
    if (!compareOpen) return;
    const needed = [compareA, compareB].filter((s) => s && allSymbols.includes(s) && !(s in compareQuotes));
    if (!needed.length) return;
    let active = true;
    for (const symbol of needed) {
      setCompareQuoteLoading((m) => ({ ...m, [symbol]: true }));
      fetchBrakeSpotQuote(symbol)
        .then((quote) => { if (active && allowedSymbolsRef.current.has(symbol)) setCompareQuotes((m) => ({ ...m, [symbol]: quote })); })
        .catch(() => { if (active && allowedSymbolsRef.current.has(symbol)) setCompareQuotes((m) => ({ ...m, [symbol]: null })); })
        .finally(() => { if (active) setCompareQuoteLoading((m) => ({ ...m, [symbol]: false })); });
    }
    return () => { active = false; };
  }, [compareOpen, compareA, compareB, compareQuotes, allSymbols.join("|")]);

  const renderCompareCard = (symbol: string) => {
    if (!symbol) return <div className="rrCompareCard rrCompareEmpty"><span>Selecione um ativo</span></div>;
    const reading = readings[symbol];
    const quote = compareQuotes[symbol];
    const quoteLoading = compareQuoteLoading[symbol];
    const code = symbol.replace("USDT", "");
    const unavailable = !reading || reading.state === "UNAVAILABLE";
    const tone = reading?.tone ?? "gray";
    const cardClass = `rrCompareCard tone-${tone}`;
    if (radar === "fundos") {
      const r = fundReadings[symbol] as ReturnType<typeof analyzeBrakeRadar> | undefined;
      return (
        <div className={cardClass}>
          <div className="rrCompareHead"><b>{code}</b><span>{quoteLoading ? "Carregando…" : fmtQuotePrice(quote ?? null)}</span></div>
          {unavailable || !r ? <div className="rrCompareEmpty">Dados indisponíveis</div> : (
            <dl className="rrCompareGrid">
              <div><dt>Estado técnico</dt><dd className="rrCompareState">{r.label}</dd></div>
              <div><dt>Movimento recente (3h)</dt><dd>{fmtPct(r.recentReturnPct, true)}</dd></div>
              <div><dt>Recuperação da queda</dt><dd>{fmtPct(r.retracementPct)}</dd></div>
              <div><dt>Tempo de fundo preservado</dt><dd>{formatPreservedMinutes(r.preservedMinutes)}</dd></div>
              <div><dt>Situação do freio da queda</dt><dd>{r.brakeApplicable && r.brakePct !== null ? fmtPct(r.brakePct) : "Não aplicável"}</dd></div>
              <div className="rrCompareWide"><dt>Diagnóstico operacional de DCA</dt><dd><strong>{r.action}</strong><small>{r.reason}</small></dd></div>
            </dl>
          )}
        </div>
      );
    }
    const r = topReadings[symbol] as ReturnType<typeof analyzeTopRadar> | undefined;
    return (
      <div className={cardClass}>
        <div className="rrCompareHead"><b>{code}</b><span>{quoteLoading ? "Carregando…" : fmtQuotePrice(quote ?? null)}</span></div>
        {unavailable || !r ? <div className="rrCompareEmpty">Dados indisponíveis</div> : (
          <dl className="rrCompareGrid">
            <div><dt>Estado técnico</dt><dd className="rrCompareState">{r.label}</dd></div>
            <div><dt>Movimento recente (3h)</dt><dd>{fmtPct(r.recentReturnPct, true)}</dd></div>
            <div><dt>Recuo do topo</dt><dd>{fmtPct(r.drawdownPct)}</dd></div>
            <div><dt>Sem nova máxima / idade do topo</dt><dd>{formatPreservedMinutes(r.minutesWithoutNewHigh)} · {formatPreservedMinutes(r.peakAgeMinutes)}</dd></div>
            <div><dt>Situação da exaustão</dt><dd>{`${r.criteria.filter((c) => c.met).length}/5 critérios · 1H ${r.h1Filter.met ? "aprovado" : "reprovado"}`}</dd></div>
            <div className="rrCompareWide"><dt>Diagnóstico operacional</dt><dd><strong>{r.action}</strong><small>{r.reason}</small></dd></div>
          </dl>
        )}
      </div>
    );
  };

  const addDisabled = extraSymbols.length >= BRAKE_MAX_EXTRA_ASSETS;

  useEffect(() => {
    if (addDisabled && addOpen) {
      setAddOpen(false);
      setAddQuery("");
      setAddError("");
    }
  }, [addDisabled, addOpen]);

  return (
    <>
      <div className="rrAssetTabs" role="tablist" aria-label="Selecionar ativo do radar">
        {assets.map(({ symbol, base }) => {
          const reading = readings[symbol];
          const tone = reading?.tone ?? "gray";
          const state = reading?.state ?? "UNAVAILABLE";
          const code = symbol.replace("USDT", "");
          return (
            <div className="rrAssetPillWrap" key={symbol}>
              <button
                type="button"
                role="tab"
                aria-selected={selected === symbol}
                className={`rrAssetPill tone-${tone} ${selected === symbol ? "active" : ""}`}
                onClick={() => setSelected(symbol)}
                title={brakeAssetName(symbol)}
              >
                <span className="rrPillTop"><i aria-hidden="true" /><b>{code}</b></span>
                <small>{labels[state] ?? "—"}</small>
              </button>
              {!base && (
                <button
                  type="button"
                  className="rrPillRemove"
                  aria-label={`Remover ${code} do radar`}
                  title={`Remover ${code}`}
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRemoveExtra(symbol); }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <div className="rrActionGroup">
          <button
            type="button"
            className={`rrActionPill rrAddPill ${addOpen ? "active" : ""}`}
            onClick={() => { if (addDisabled) return; setAddOpen((v) => !v); setAddError(""); if (compareOpen) setCompareOpen(false); }}
            aria-expanded={addOpen}
            aria-label="Adicionar ativo ao radar"
            title={addDisabled ? "Limite de 3 ativos adicionais atingido" : "Buscar e incluir ativo compatível"}
            disabled={addDisabled}
          >
            <b>+ ATIVO</b>
          </button>
          <button
            type="button"
            className={`rrActionPill rrComparePill ${compareOpen ? "active" : ""}`}
            onClick={() => { setCompareOpen((v) => !v); if (!compareOpen) setAddOpen(false); }}
            aria-expanded={compareOpen}
            aria-label="Comparar ativos"
            title="Comparar dois ativos no modo técnico atual"
          >
            <b>COMPARAR</b>
          </button>
        </div>
      </div>
      {radar === "fundos" && allSymbols.length > 0 && fallingAssets / allSymbols.length >= 0.8 && (
        <p className="rrMarketAlert" role="status">
          {fallingAssets}/{allSymbols.length} ativos em queda — movimento de mercado, não isolado
        </p>
      )}
      {addDisabled && (
        <p className="rrLimitNotice" role="status">
          Limite de 3 ativos atingido. Remova um ativo pelo × para adicionar outro.
        </p>
      )}

      {addOpen && (
        <div className="rrAddPanel" role="region" aria-label="Buscar ativo para o radar">
          <div className="rrAddForm">
            <label className="rrAddLabel" htmlFor="rr-add-input">Buscar cripto (Binance Spot)</label>
            <div className="rrAddRow">
              <input
                id="rr-add-input"
                ref={addInputRef}
                className="rrAddInput"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitAdd(); } if (e.key === "Escape") setAddOpen(false); }}
                placeholder="XRP"
                type="search"
                enterKeyHint="search"
                autoCapitalize="characters"
                spellCheck={false}
                autoComplete="off"
                disabled={addBusy}
              />
              <button type="button" className="rrAddSubmit" onClick={() => void submitAdd()} disabled={addBusy || addDisabled}>
                {addBusy ? "Validando…" : "Incluir"}
              </button>
              <button type="button" className="rrAddCancel" onClick={() => setAddOpen(false)} disabled={addBusy}>Fechar</button>
            </div>
            <p className="rrAddHint">
              Somente criptomoedas da Binance Spot com candles 1h/15m compatíveis com o radar. Máx. 3 adicionais.
            </p>
            {addError && <p className="rrAddError" role="alert">{addError}</p>}
          </div>
        </div>
      )}

      {compareOpen && (
        <div className="rrComparePanel" role="region" aria-label={`Comparar ativos — ${radar === "fundos" ? "Caça-Fundos" : "Caça-Topos"}`}>
          <div className="rrCompareBar">
            <span className="rrCompareTitle">COMPARAR · {radar === "fundos" ? "CAÇA-FUNDOS" : "CAÇA-TOPOS"}</span>
            <div className="rrComparePickers">
              <label>
                <span>Ativo A</span>
                <select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
                  <option value="">Selecionar</option>
                  {validCompareSymbols.map((s) => <option key={s} value={s}>{s.replace("USDT", "")}</option>)}
                </select>
              </label>
              <label>
                <span>Ativo B</span>
                <select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
                  <option value="">Selecionar</option>
                  {validCompareSymbols.map((s) => <option key={s} value={s}>{s.replace("USDT", "")}</option>)}
                </select>
              </label>
            </div>
            <button type="button" className="rrCompareClose" onClick={() => setCompareOpen(false)}>Fechar</button>
          </div>
          {compareA && compareB && compareA === compareB ? (
            <p className="rrCompareWarn">Escolha dois ativos diferentes para comparar.</p>
          ) : validCompareSymbols.length < 2 ? (
            <p className="rrCompareWarn">Dados válidos insuficientes para comparação no momento.</p>
          ) : (
            <div className="rrCompareGridWrap">
              {renderCompareCard(compareA)}
              {renderCompareCard(compareB)}
            </div>
          )}
          <p className="rrCompareNote">Comparação informativa no modo técnico atual, com base nos mesmos cálculos e snapshots independentes do radar. Não indica vencedor nem recomendação de compra.</p>
        </div>
      )}
    </>
  );
}
