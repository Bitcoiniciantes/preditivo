import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { shouldDeliverAlert } from "../lib/alerts.ts";
import { bitcoinBuyLevel, bitcoinBuyLevelTransition } from "../lib/bitcoin-buy.ts";

test("classifica os quatro patamares configurados de compra do BTC", () => {
  assert.equal(bitcoinBuyLevel(57_000.01), null);
  assert.equal(bitcoinBuyLevel(57_000), "COMPRAR_AGORA");
  assert.equal(bitcoinBuyLevel(54_000), "COMPRAR_URGENTE");
  assert.equal(bitcoinBuyLevel(52_000), "COMPRA_EXTREMA");
  assert.equal(bitcoinBuyLevel(49_999.99), "FLUSH_BITCOIN");
  assert.equal(bitcoinBuyLevel(0), null);
});

test("sinaliza somente a entrada ou o aumento de urgencia", () => {
  assert.equal(bitcoinBuyLevelTransition(null, "COMPRAR_AGORA"), "COMPRAR_AGORA");
  assert.equal(
    bitcoinBuyLevelTransition("COMPRAR_AGORA", "COMPRAR_URGENTE"),
    "COMPRAR_URGENTE",
  );
  assert.equal(
    bitcoinBuyLevelTransition("FLUSH_BITCOIN", "COMPRA_EXTREMA"),
    null,
  );
  assert.equal(bitcoinBuyLevelTransition("COMPRAR_AGORA", null), null);
});

test("patamares do BTC chegam a todo assinante ativo", () => {
  assert.equal(shouldDeliverAlert("FORTES", "BTC_COMPRA"), true);
  assert.equal(shouldDeliverAlert("TODOS", "BTC_COMPRA"), true);
  assert.equal(shouldDeliverAlert("CAPITULACAO", "BTC_COMPRA"), true);
});

test("monitor usa a minima do pavio do candle em formacao para o alerta BTC", async () => {
  const script = await readFile(
    new URL("../scripts/monitor-telegram-alerts.mjs", import.meta.url),
    "utf8",
  );

  assert.match(script, /bitcoinBuyLevel\(currentCandle\.low\)/);
  assert.match(script, /Pavio \/ minima atingiu/);
});
