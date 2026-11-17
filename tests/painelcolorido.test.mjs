import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Rota experimental painelcolorido.* — dashboard observacional em arquivos
// novos, sem alterar nenhum painel existente, motor, daemon ou contrato.
// Linguagem: observacional, sem probabilidade preditiva ou projeção.

const COMP = new URL("../app/painelcolorido/PainelColorido.tsx", import.meta.url);
const PAGE = new URL("../app/painelcolorido/page.tsx", import.meta.url);
const CSS = new URL("../app/painelcolorido/painelcolorido.css", import.meta.url);
const HOOK = new URL("../lib/painelcolorido-session.ts", import.meta.url);

test("rota usa o provider/websocket único e nada de novo", async () => {
  const [page, comp] = await Promise.all([readFile(PAGE, "utf8"), readFile(COMP, "utf8")]);
  assert.match(page, /MarketStreamProvider/);
  assert.match(comp, /useMarketStreamContext/);
  assert.match(comp, /painel-status\.json/);
  assert.doesNotMatch(comp, /new WebSocket|fetchKlines/);
  assert.doesNotMatch(comp, /from "..\/..\/lib\/api"/);
});

test("blocos da referência existem sem linguagem preditiva", async () => {
  const comp = await readFile(COMP, "utf8");
  for (const id of ["pc-regime", "pc-fluxo", "pc-derivativos", "pc-grafico", "pc-micro", "pc-alertas", "pc-divergencias", "pc-saude", "pc-timeline"]) {
    assert.ok(comp.includes(`id="${id}"`), `ausente: ${id}`);
  }
  assert.match(comp, /nenhuma probabilidade preditiva/);
  assert.doesNotMatch(comp, /previs|projeção|vai subir|vai cair|comprar agora|oportunidade de (compra|venda)/i);
});

test("gráfico real: klines BTCUSDT, 7 timeframes, sem leitura de sinal", async () => {
  const [comp, chart, klines] = await Promise.all([
    readFile(COMP, "utf8"),
    readFile(new URL("../app/painelcolorido/PainelColoridoChart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/painelcolorido-klines.ts", import.meta.url), "utf8"),
  ]);
  assert.match(comp, /PainelColoridoChart/);
  assert.match(klines, /fapi\.binance\.com\/fapi\/v1\/klines\?symbol=BTCUSDT/);
  assert.match(klines, /"1m", "5m", "15m", "1h", "4h", "1D", "1W"/);
  assert.match(klines, /"1W": 7 \* 86_400_000/);
  assert.match(klines, /"1W": "1w"/);
  assert.match(chart, /lightweight-charts/);
  assert.match(chart, /CandlestickSeries/);
  assert.match(chart, /HistogramSeries/);
  assert.match(chart, /addSeries\(/);
});

test("MA50/MA200 com marcadores golden/death cross; resto proibido segue vetado", async () => {
  const chart = await readFile(new URL("../app/painelcolorido/PainelColoridoChart.tsx", import.meta.url), "utf8");
  const code = chart.replace(/^\/\/.*$/gm, "");
  // Desejado (mudança de critério documentada: cruzamento MA50/MA200 é leitura
  // técnica direta para uso pessoal; o veto a marcadores valia para sinais de trade).
  assert.match(code, /sma\(closes, 50\)/);
  assert.match(code, /sma\(closes, 200\)/);
  assert.match(code, /setMarkers/);
  assert.match(code, /"GC"/);
  assert.match(code, /"DC"/);
  assert.doesNotMatch(code, /sma\(closes, 9\)/);
  assert.doesNotMatch(code, /sma\(closes, 21\)/);
  // Segue proibido: padrões de candle, S/R automáticas, indicadores extras,
  // marcadores de entrada/saída de trade. (createPriceLine é permitido SOMENTE
  // para as linhas de referência 30/70 do RSI; RSI é funcionalidade desejada.)
  assert.doesNotMatch(code, /createShape|martelo|engolfo|MACD|Bollinger|Stochastic/i);
  assert.doesNotMatch(code, /compra|venda|entrada|saída/i);
});

test("klines informam a fonte (futures/spot) e gráfico exibe badge só no fallback", async () => {
  const [chart, klines] = await Promise.all([
    readFile(new URL("../app/painelcolorido/PainelColoridoChart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/painelcolorido-klines.ts", import.meta.url), "utf8"),
  ]);
  assert.match(klines, /PcSource = "futures" \| "spot"/);
  assert.match(klines, /return \{ bars, source \}/);
  assert.match(chart, /fonte: spot/);
  assert.match(chart, /fonte === "spot"/);
});

test("sem header full-width: ativo identificado na sidebar, sem vão morto", async () => {
  const comp = await readFile(COMP, "utf8");
  assert.doesNotMatch(comp, /pc-topbar/);
  assert.match(comp, /pc-asset/);
  assert.match(comp, /pc-btc-mini/);
  assert.match(comp, /pc-sideinfo/);
  const side = comp.slice(comp.indexOf("pc-sideinfo"));
  assert.ok(side.includes("pc-price"), "preço na sidebar");
  assert.ok(side.includes("pc-conn"), "conexão na sidebar");
  assert.doesNotMatch(side, /pc-regimebox/, "regime duplicado removido da sidebar");
  assert.match(comp, /pc-badge/);
  const header = comp.slice(0, comp.indexOf("pc-layout"));
  assert.doesNotMatch(header, /pc-live/, "LIVE duplicado removido do header");
  assert.match(comp, /pc-btc/);
});

test("estados vazios usam pc-empty; tabela de divergência intacta", async () => {
  const [comp, css] = await Promise.all([
    readFile(COMP, "utf8"),
    readFile(CSS, "utf8"),
  ]);
  assert.match(comp, /pc-empty">Nenhuma divergência ativa/);
  assert.match(comp, /pc-empty">Nenhum alerta neste filtro/);
  assert.match(comp, /pc-empty">Aguardando histórico/);
  assert.match(comp, /pc-div-status">ATIVA/);
  assert.match(comp, /pc-div-dur/);
  assert.match(comp, /pc-label-ico/);
  assert.match(css, /\.pc-table tbody tr:nth-child\(even\)/);
  assert.match(css, /\.pc-div-status \{ color: #e5484d;/);
  assert.match(comp, /<table className="pc-table">/);
  assert.match(css, /\.pc-empty \{ display: flex;/);
});

test("feed de alertas exibe horário com segundos", async () => {
  const comp = await readFile(COMP, "utf8");
  assert.match(comp, /second: "2-digit"/);
  assert.match(comp, /fmtHoraS\(new Date\(e\.t\)\.getTime\(\)\)/);
});

test("derivativos: viés long/short explícito sem linguagem de trade", async () => {
  const comp = await readFile(COMP, "utf8");
  assert.match(comp, /Mais longs/);
  assert.match(comp, /Mais shorts/);
  assert.match(comp, /Equilibrado/);
  assert.match(comp, /não é direção futura/);
  assert.doesNotMatch(comp, /comprar agora|vender agora|entre agora|oportunidade/i);
});
test("derivativos preenche a altura sem vão morto", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /#pc-derivativos \{ display: flex; flex-direction: column; justify-content: space-between;/);
});

test("estilos são escopados com prefixo pc-", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.pc-root/);
  assert.match(css, /\.pc-card/);
  assert.doesNotMatch(css, /\.obsCell|\.obsGrid|\.spu|\.iu/);
});

test("sidebar alinhada estruturalmente, sem compensação mágica", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.pc-layout \{ display: flex; align-items: flex-start;/);
  assert.match(css, /margin-top: 0; margin-bottom: 0;/);
  assert.doesNotMatch(css, /margin-top: -\d+px/);
});

test("regime mostra duração média; CVD usa K/M/B com negativos", async () => {
  const [comp, hook] = await Promise.all([
    readFile(COMP, "utf8"),
    readFile(new URL("../lib/painelcolorido-session.ts", import.meta.url), "utf8"),
  ]);
  assert.match(comp, /Duração média/);
  assert.match(comp, /hist\.durations/);
  assert.match(comp, /fmtPcUsd\(data\.cvd\)/);
  assert.match(comp, /fmtPcUsd\(data\.cvd_whale\)/);
  assert.match(hook, /Math\.abs\(v\)/);
  assert.match(hook, /\$.*B/);
});

test("pc-label é bloco com respiro (origem, não por card)", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.pc-label \{ display: block; margin-bottom: 6px;/);
});

test("hook de sessão não toca em motor nem backend", async () => {
  const hook = await readFile(HOOK, "utf8");
  assert.match(hook, /usePainelColoridoSeries/);
  assert.match(hook, /churnH/);
  assert.doesNotMatch(hook, /flow-regime|FlowRegimeDetector|computeScore|fetch\(|WebSocket/);
});

test("OI em contratos (sem $) e gauges como índice (sem %)", async () => {
  const comp = await readFile(COMP, "utf8");
  assert.doesNotMatch(comp, /fmtUsd\(data\.oi\)/, "OI sem formatação monetária");
  assert.match(comp, /contratos/, "OI rotulado em contratos");
  assert.match(comp, /ΔOI \/ 1min \(contratos\)/, "ΔOI na mesma unidade");
  assert.match(comp, /Volatilidade \(índice\)/, "volatilidade identificada como índice");
  assert.match(comp, /Força do Movimento \(índice\)/, "força identificada como índice");
  assert.doesNotMatch(comp, /\{v\.toFixed\(0\)\}%/, "gauge sem símbolo de porcentagem");
});
