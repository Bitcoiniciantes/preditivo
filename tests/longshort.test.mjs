import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Long/Short — Contas (Painel Colorido): mapeamento tf→período, stale por
// fetchedAt, ausência, compatibilidade WS e guardas arquiteturais.
// Padrão do repo: asserções sobre o fonte (sem rede, sem motor).

const COMP = new URL("../app/painelcolorido/PainelColorido.tsx", import.meta.url);
const CHART = new URL("../app/painelcolorido/PainelColoridoChart.tsx", import.meta.url);
const STREAM = new URL("../lib/useMarketStream.ts", import.meta.url);
const TYPES = new URL("../services/market-ingestion/src/types/index.ts", import.meta.url);
const LS = new URL("../services/market-ingestion/src/derivatives/long-short.ts", import.meta.url);
const REST = new URL("../services/market-ingestion/src/exchanges/binance/rest.ts", import.meta.url);
const INDEX = new URL("../services/market-ingestion/src/index.ts", import.meta.url);

test("mapeamento timeframe → período API (1m→5m, 1W→1d)", async () => {
  const comp = await readFile(COMP, "utf8");
  for (const [tf, period] of [["1m", "5m"], ["5m", "5m"], ["15m", "15m"], ["1h", "1h"], ["4h", "4h"], ["1D", "1d"], ["1W", "1d"]]) {
    assert.ok(comp.includes(`"${tf}": "${period}"`), `mapeamento ${tf} → ${period}`);
  }
  assert.doesNotMatch(comp, /"1m": "1m"/, "nunca exibe 1m como período da API");
  assert.doesNotMatch(comp, /"1W": "1w"/i, "nunca exibe 1W como período da API");
});

test("stale mede saúde do feed (fetchedAt), não idade do bucket", async () => {
  const comp = await readFile(COMP, "utf8");
  assert.match(comp, /LS_STALE_MS = 120_000/, "stale = 120s");
  assert.match(comp, /ls\.fetchedAt \?\? ls\.updatedAt/, "origem = fetchedAt com fallback");
  assert.match(comp, /now - lsFetchedAt/, "idade calculada sobre o momento da coleta");
  assert.match(comp, /lsAge > LS_STALE_MS/, "comparação contra o threshold");
  assert.match(comp, /desatualizado há/, "estado desatualizado existe");
  assert.match(comp, /atualizado \${haQuanto/, "estado atualizado existe");
});

test("sem dados: — + aguardando dados (sem inventar zero)", async () => {
  const comp = await readFile(COMP, "utf8");
  assert.match(comp, /aguardando dados/, "indicação discreta de ausência");
  assert.match(comp, /data\?\.longShort\?\.\[lsPeriod\] \?\? null/, "ausência = null (nunca zero)");
  assert.doesNotMatch(comp, /lsPeriod\] \?\? 0|ratio \?\? 0|longPct \?\? 0/, "ausência nunca vira zero");
});

test("percentuais crus da API, sem recálculo via ratio", async () => {
  const [comp, ls] = await Promise.all([readFile(COMP, "utf8"), readFile(LS, "utf8")]);
  assert.match(comp, /ls\.longPct \* 100/, "long exibido de longPct");
  assert.match(comp, /ls\.shortPct \* 100/, "short exibido de shortPct");
  assert.match(ls, /longPct: data\.longAccount/, "longPct vem de longAccount");
  assert.match(ls, /shortPct: data\.shortAccount/, "shortPct vem de shortAccount");
  assert.doesNotMatch(ls, /longPct:.*ratio/, "percentual nunca derivado do ratio");
});

test("throttle 60s vive no módulo (máx ~6 req/min)", async () => {
  const ls = await readFile(LS, "utf8");
  assert.match(ls, /POLL_INTERVAL_MS = 60_000/, "intervalo 60s");
  assert.match(ls, /now - lastPoll\[period\] < POLL_INTERVAL_MS/, "guarda por período");
  assert.match(ls, /fetchedAt: now/, "fetchedAt avança somente após resposta válida");
  assert.match(ls, /if \(!data\) continue/, "falha preserva último valor");
});

test("payload WS compatível e opcional (retrocompatível)", async () => {
  const [types, stream, index] = await Promise.all([
    readFile(TYPES, "utf8"), readFile(STREAM, "utf8"), readFile(INDEX, "utf8"),
  ]);
  assert.match(types, /longShort\?/, "MarketSnapshot.longShort opcional");
  assert.match(types, /fetchedAt: number/, "tipo inclui fetchedAt");
  assert.match(stream, /longShort\?/, "MarketStreamData.longShort opcional");
  assert.match(index, /longShort: getLongShortState\(\)/, "snapshot anexa o estado");
});

test("guardas arquiteturais: sem socket/porta/banco novos", async () => {
  const [index, ls, comp] = await Promise.all([
    readFile(INDEX, "utf8"), readFile(LS, "utf8"), readFile(COMP, "utf8"),
  ]);
  assert.doesNotMatch(ls, /new WebSocket|WebSocketServer|wsPort|3001/, "módulo sem socket/porta");
  assert.doesNotMatch(index, /dbSnapshot\(\{[^}]*longShort|saveSnapshot\(\{[^}]*longShort/, "sem persistência no market.db");
  assert.doesNotMatch(comp, /fapi\.binance|globalLongShort/, "frontend sem chamada Binance");
  // Escopo: somente o bloco Long/Short (o restante do painel tem VENDA/COMPRA
  // pré-existentes na escala do imbalance, fora deste escopo).
  const lsBlock = comp.slice(comp.indexOf("Long/Short — Contas"), comp.indexOf("</section>", comp.indexOf("Long/Short — Contas")));
  assert.ok(lsBlock.length > 0, "bloco Long/Short existe");
  assert.doesNotMatch(lsBlock, /varejo|bullish|bearish/i, "sem interpretação direcional no bloco");
  assert.doesNotMatch(lsBlock, /sinal|recomenda|probabilidade/i, "sem sinal/recomendação no bloco");
});

test("timeframe único: chart recebe tf via props, sem estado duplicado", async () => {
  const chart = await readFile(CHART, "utf8");
  const code = chart.replace(/^\/\/.*$/gm, "");
  assert.match(code, /onTfChange/, "chart usa callback do pai");
  assert.doesNotMatch(code, /useState<PcTf>/, "sem estado tf local duplicado");
});
