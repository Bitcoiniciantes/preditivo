// scripts/verify-market-chain.mjs
// Verificação da cadeia de dados (item 4 do escopo):
//   Binance → market-ingestion → CVD/fluxo/regime/absorção/eventos → snapshot
//   → ws://localhost:3001 → MarketPanel → ConfluenceCard
//
// Uso:  node scripts/verify-market-chain.mjs [segundos]
// Conecta no WebSocket local, coleta N snapshots e valida os campos que os dois
// widgets consomem. Requer o daemon rodando (node dist/index.js em
// services/market-ingestion). Exit code 0 = cadeia íntegra; 1 = falha.

const DURATION_SECONDS = Number(process.argv[2] || 12);
const WS_URL = process.env.MARKET_WS_URL || "ws://localhost:3001";

const requiredFields = [
  "ts", "p", "cvd", "cvd_whale", "imb", "oi", "oi_delta", "funding",
  "regime", "regime_confidence", "flow_regime", "divergence",
  "absorption_state", "score", "events", "quality",
];

let snapshots = 0;
let validSnapshots = 0;
let totalEvents = 0;
let whaleEvents = 0;
let lastSnapshot = null;
let errors = [];

const ws = new WebSocket(WS_URL);

const timer = setTimeout(() => {
  console.error(`[VERIFY] Timeout após ${DURATION_SECONDS}s (${snapshots} snapshots recebidos)`);
  finish(1);
}, (DURATION_SECONDS + 5) * 1000);

function finish(code) {
  clearTimeout(timer);
  try { ws.close(); } catch { /* noop */ }
  report();
  process.exit(code);
}

function report() {
  console.log("\n═══════════════ VERIFICAÇÃO DA CADEIA ═══════════════");
  console.log(`Fonte: ${WS_URL}`);
  console.log(`Snapshots recebidos: ${snapshots}`);
  console.log(`Snapshots válidos:   ${validSnapshots}`);
  console.log(`Eventos totais:      ${totalEvents}`);
  console.log(`Eventos de baleia:   ${whaleEvents}`);
  if (lastSnapshot) {
    console.log("\nÚltimo snapshot (campos consumidos pelos widgets):");
    console.log(`  preço:        ${lastSnapshot.p}`);
    console.log(`  cvd:          ${lastSnapshot.cvd}`);
    console.log(`  cvd_whale:    ${lastSnapshot.cvd_whale}`);
    console.log(`  imb:          ${lastSnapshot.imb}`);
    console.log(`  score fluxo:  ${lastSnapshot.score} (qualidade ${lastSnapshot.score_quality})`);
    console.log(`  regime:       ${lastSnapshot.regime} (conf ${lastSnapshot.regime_confidence})`);
    console.log(`  flow_regime:  ${lastSnapshot.flow_regime} (força ${lastSnapshot.flow_strength})`);
    console.log(`  divergence:   ${lastSnapshot.divergence}`);
    console.log(`  absorção:     ${lastSnapshot.absorption_state} (${lastSnapshot.absorption_level} ${lastSnapshot.absorption_intensity})`);
    console.log(`  qualidade:    ${JSON.stringify(lastSnapshot.quality)}`);
    console.log(`  eventos:      ${lastSnapshot.events?.length ?? 0}`);
  }
  if (errors.length) {
    console.log("\nErros encontrados:");
    for (const e of errors.slice(0, 10)) console.log(`  ✗ ${e}`);
  }
  console.log("═══════════════════════════════════════════════════════");
  console.log(validSnapshots > 0 ? "RESULTADO: CADEIA OK ✓" : "RESULTADO: CADEIA COM FALHAS ✗");
}

ws.onopen = () => {
  console.log(`[VERIFY] Conectado em ${WS_URL}`);
};

ws.onmessage = (event) => {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    errors.push("payload JSON inválido");
    return;
  }
  snapshots++;

  const missing = requiredFields.filter((f) => !(f in data));
  if (missing.length) {
    errors.push(`snapshot #${snapshots}: campos ausentes: ${missing.join(", ")}`);
    return;
  }
  validSnapshots++;
  totalEvents += Array.isArray(data.events) ? data.events.length : 0;
  whaleEvents += Array.isArray(data.events)
    ? data.events.filter((e) => e?.type === "whale_buy" || e?.type === "whale_sell").length
    : 0;
  lastSnapshot = data;

  if (snapshots === 1 || snapshots % 5 === 0) {
    console.log(`[VERIFY] snapshot #${snapshots}: p=${data.p} cvd=${data.cvd} cvd_whale=${data.cvd_whale} regime=${data.regime} score=${data.score} events=${data.events?.length ?? 0}`);
  }

  if (snapshots >= DURATION_SECONDS) finish(0);
};

ws.onerror = (err) => {
  errors.push(`WebSocket error: ${err?.message ?? "desconhecido"}`);
};

ws.onclose = () => {
  if (snapshots === 0) {
    console.error("[VERIFY] Conexão fechada sem receber snapshots. O daemon está rodando? (services/market-ingestion: node dist/index.js)");
    finish(1);
  }
};
