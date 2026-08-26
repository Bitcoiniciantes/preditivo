// tests/oi-delta.test.mjs
// CORREÇÃO P0 — ΔOI: cálculo/renderização sobre janela de 1 min (material), preservando o OI absoluto.
//   node tests/oi-delta.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { computeOiDelta, fmtOiDelta } from "../lib/oi-delta.ts";

test("ΔOI — variação positiva", () => {
  const h = [
    { ts: 0, oi: 100000 },
    { ts: 60_000, oi: 100050 },
  ];
  const d = computeOiDelta(h, 60_000, 60_000);
  assert(d, "delta presente");
  assert.equal(d.oiAbs, 50);
  assert.ok(Math.abs(d.oiPct - 0.05) < 1e-9, `pct = ${d.oiPct}% (esperado 0.05%)`);
  assert.ok(fmtOiDelta(d).startsWith("+50"), `fmt = ${fmtOiDelta(d)}`);
});

test("ΔOI — variação negativa", () => {
  const h = [
    { ts: 0, oi: 100000 },
    { ts: 60_000, oi: 99950 },
  ];
  const d = computeOiDelta(h, 60_000, 60_000);
  assert(d);
  assert.equal(d.oiAbs, -50);
  assert.ok(Math.abs(d.oiPct - (-0.05)) < 1e-9);
  assert.ok(fmtOiDelta(d).startsWith("-50"));
});

test("ΔOI — variação próxima de zero (não trunca para 0.000%)", () => {
  const h = [
    { ts: 0, oi: 100000 },
    { ts: 60_000, oi: 100000.3 },
  ];
  const d = computeOiDelta(h, 60_000, 60_000);
  assert(d);
  assert.ok(d.oiAbs !== 0, "delta absoluto não-zero");
  assert.ok(d.oiPct > 0 && d.oiPct < 0.01, `pct pequena mas não-zero: ${d.oiPct}%`);
  const s = fmtOiDelta(d);
  assert.ok(!s.includes("0.00000%"), `fmt não trunca: ${s}`);
  assert.ok(s.includes("0.000"), `fmt mostra a variação real: ${s}`);
});

test("ΔOI — atualização entre snapshots (referência temporal correta)", () => {
  // série: base em t=0; oi sobe ao longo de 3 min
  const h = [
    { ts: 0, oi: 100000 },
    { ts: 60_000, oi: 100030 },
    { ts: 120_000, oi: 100080 },
    { ts: 180_000, oi: 100120 },
  ];
  // janela de 60s terminando em t=180s: base = ponto mais antigo dentro da janela (t=120s)
  const d = computeOiDelta(h, 60_000, 180_000);
  assert(d);
  assert.equal(d.oiAbs, 40, `ΔOI na janela de 1 min = 100120-100080 = 40 (recebeu ${d.oiAbs})`);
  assert.ok(Math.abs(d.oiPct - (40 / 100080) * 100) < 1e-9);
});

test("ΔOI — casos degenerados", () => {
  assert.equal(computeOiDelta([], 60_000, 0), null, "histórico vazio → null");
  assert.equal(computeOiDelta([{ ts: 0, oi: 100000 }], 60_000, 0), null, "ponto único → null");
  assert.equal(computeOiDelta([{ ts: 0, oi: 0 }, { ts: 60_000, oi: 10 }], 60_000, 60_000), null, "base oi<=0 → null");
  // mesmo timestamp (base >= latest) → null
  assert.equal(computeOiDelta([{ ts: 0, oi: 100000 }, { ts: 0, oi: 100000 }], 60_000, 0), null, "mesmo timestamp → null");
});
