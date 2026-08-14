import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("expõe o painel e o motor transparente", async () => {
  const [page, analysis] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /TERMÔMETRO/);
  assert.match(analysis, /export function analyze/);
  assert.match(analysis, /RSI de Wilder em 14 períodos/);
  assert.match(analysis, /ATR de 14 períodos/);
  assert.match(page, /termometro-assets/);
  assert.match(page, /PriceStructureChart/);
  assert.doesNotMatch(page, /i%4===0\|\|i%7===0/);
  assert.match(page, /desktopPeriodPrompt/);
  assert.match(page, /key=\{`\$\{ticker\}-\$\{period\}`\}/);
  assert.match(page, /setOpen\]=useState<number\|null>\(null\)/);
  assert.match(page, /mobileChartPeriods/);
  assert.ok(page.indexOf('className="card chart"') < page.indexOf('className="card signals"'));
  assert.ok(page.indexOf('className="card signals"') < page.indexOf('className="analysisColumn analysisRight"'));
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.analysisDesk \.mobileChartPeriods \{ order:5; \}/);
  assert.match(styles, /main>header nav\{position:absolute;left:50%;top:50%;margin:0;transform:translate\(-50%,-50%\)\}/);
  assert.match(styles, /\.quickScale\{flex:1 1 360px;min-width:280px;max-width:520px/);
  assert.match(page, /EXTREMO TÉCNICO/);
  assert.match(page, /sinais de nota/);
  assert.match(page, /NEUTRO ↑/);
  assert.match(analysis, /candle encerrado/);
  assert.match(analysis, /Força da tendência \(ADX\)/);
});

test("consulta a fonte pública diretamente no navegador", async () => {
  const [api, config] = await Promise.all([
    readFile(new URL("../lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(api, /data-api\.binance\.vision\/api\/v3\/klines/);
  assert.match(api, /Binance Public Market Data/);
  assert.match(config, /"1M": "1M"/);
  assert.match(config, /PAXG/);
  assert.doesNotMatch(config, /"SOL"/);
  assert.doesNotMatch(api, /api[_-]?key|authorization/i);
});

test("inclui ativos pré-cadastrados com fonte gratuita separada", async () => {
  const [api, config, workflow] = await Promise.all([
    readFile(new URL("../lib/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  ]);
  assert.match(api, /fetchStaticAsset/);
  assert.match(config, /PRATA/);
  assert.match(config, /COBRE/);
  assert.match(config, /URÂNIO/);
  assert.match(workflow, /update-market-data\.mjs/);
  for (const file of ["mstr", "prata", "cobre", "uranio"]) {
    const snapshot = await readFile(new URL(`../public/data/${file}.json`, import.meta.url), "utf8");
    const data = JSON.parse(snapshot);
    for (const period of ["1H", "4H", "1D", "1S", "1M"]) {
      assert.ok(data.periods[period].length >= 55, `${file} sem dados em ${period}`);
    }
  }
});
