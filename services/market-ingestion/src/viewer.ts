import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
  console.log('Conectado ao backend. Dados ao vivo:\n');
});

ws.on('message', (raw: Buffer) => {
  const d = JSON.parse(raw.toString());
  const time = new Date(d.ts).toLocaleTimeString('pt-BR');
  console.clear();
  console.log(`=== MARKET INGESTION - AO VIVO ===`);
  console.log(`Horário:    ${time}`);
  console.log(`Preço:      $${d.p?.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`─────────────────────────────────`);
  console.log(`CVD Total:  ${d.cvd?.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`CVD Whale:  ${d.cvd_whale?.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`─────────────────────────────────`);
  console.log(`Imbalance:  ${d.imb > 0 ? '+' : ''}${(d.imb * 100).toFixed(1)}% ${d.imb > 0 ? '🟢 COMPRA' : d.imb < 0 ? '🔴 VENDA' : '⚪ NEUTRO'}`);
  console.log(`─────────────────────────────────`);
  console.log(`OI:         ${d.oi?.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`OI Delta:   ${d.oi_delta > 0 ? '+' : ''}${(d.oi_delta * 100).toFixed(3)}%`);
  console.log(`Funding:    ${(d.funding * 100).toFixed(4)}% (${d.funding_class})`);
  console.log(`─────────────────────────────────`);
  console.log(`Regime:     ${d.regime}`);
  console.log(`Score:      ${d.score}/100 (qualidade: ${d.score_quality})`);
  console.log(`─────────────────────────────────`);
  console.log(`WS: ${d.quality?.ws} | OI: ${d.quality?.oi} | Funding: ${d.quality?.funding}`);
  if (d.events?.length > 0) {
    console.log(`Eventos: ${d.events.length}`);
    d.events.forEach((e: any) => console.log(`  • ${e.type}: ${e.direction} (${e.magnitude})`));
  }
});

ws.on('error', (err) => {
  console.error('Erro:', err.message);
});

process.on('SIGINT', () => { ws.close(); process.exit(); });
