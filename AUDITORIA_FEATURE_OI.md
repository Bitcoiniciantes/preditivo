# AUDITORIA B — FEATURE OI (oi_delta / ΔOI)

**Data:** 26/08/2026 · **Tipo:** somente leitura (código + schema + SQLite). Nenhuma alteração.
Fonte: `grep` no repo + consulta SQLite (2.560 snapshots com `oi_change`).

---

## 1. MAPA DE OCORRÊNCIAS

| # | Local | Onde é calculada | Janela | Precisão/unidade | Sofre o truncamento do painel? |
|---|---|---|---|---|---|
| 1 | `services/market-ingestion/src/derivatives/oi.ts` (linha 18) | `oiChange = (currentOi − previousOi)/previousOi` entre polls | **5s** (oiPollMs) | fração completa (ex.: 0,00002857) | **não** (valor cru) |
| 2 | Persistência `snapshots.oi_change` (sqlite.ts:55) | gravada a cada snapshot (~1/min) com o valor do poll mais recente | 5s (amostrada ~1/min) | fração completa | **não** (cru) |
| 3 | `index.ts:317` broadcast `oi_delta` | mesmo `oiChange` de (1) | 5s | fração completa | **não** |
| 4 | `index.ts:359,369` → `features/score.ts` (linhas 47-50) | score usa `oiChange` com thresholds 0,005/0,02 (0,5%/2%) | 5s | fração; thresholds em % | **sim (morto por escala)** |
| 5 | `app/page.tsx:159` → `openInterestExtreme = \|flowData.oiDelta\| > 0.005` → `ConfluenceCard` → `lib/cross-validation.ts` (ConfluenceEngine) | mesma `oi_delta` de (3) com threshold 0,005 (0,5%) | 5s | fração; threshold em % | **sim (morto por escala)** |
| 6 | `services/.../features/cross-validation.ts` (linhas 34,72,140) | define `openInterestExtreme` como input; **código morto no daemon** (nenhum importador) | — | — | — |
| 7 | `viewer.ts:23` (console dev) | `(oi_delta*100).toFixed(3)%` | 5s | 3 casas decimais de % | **sim (mesmo truncamento de exibição)** |
| 8 | Fase 1 — `fase1-experimento-minimo.mjs:187` `oiChangeMean` | média do `oi_change` **persistido** na janela de 15m | 15m (sobre valores de 5s) | fração completa | **não** |
| 9 | Fase 1 — `oiMean` | média do OI absoluto na janela de 15m | 15m | unidades de OI (base BTC) | **não** |
| 10 | Fase 1 — `scoreMean` (feature) | média do `score` (que contém o componente OI de (4)) | 15m | score -40..28 | **indiretamente** (score tem componente OI morto) |

## 2. CLASSIFICAÇÃO

- **Dataset da Fase 1 (`oiMean`, `oiChangeMean`):** usa o `oi_change` **persistido** (fração completa). O SQLite mostra 2.392/2.560 não-zero, min -0,09% / máx +0,34% (fração crua, ex.: `-0.00089957`). **SEM truncamento** — a correção do painel (exibição client-side) **não deixou equivalente server-side de exibição quebrado**: não existe um "ΔOI de exibição" persistido; o persistido é o valor cru.
- **Fase 4 (persistence/coherence/efficiency/churn/reversal):** **não implementadas** (congeladas) — nenhuma usa OI hoje.
- **`behavior_features`:** **não existe** no código (0 ocorrências) — categoria não presente.

## 3. PROBLEMAS SERVER-SIDE DETECTADOS (P1 PENDENTE — NÃO CORRIGIDOS)

Empiricamente (2.560 snapshots):
- **`features/score.ts` (componente OI do score):** thresholds `oiChange > 0.005` (+4) e `> 0.02` (+8) (e negativos). **Nenhum snapshot jamais atingiu** (>0.005: 0; >0.02: 0; < -0.005: 0; < -0.02: 0; máx |oi_change| = 0,34% < 0,5%). → **o componente OI do score é EFETIVAMENTE MORTO** (nunca contribui ±4/±8). Como `score` é persistido e é **feature da Fase 1 (`scoreMean`)**, o score atual **não reflete OI em nada** (viés silencioso). **P1 pendente** (janela 5s × threshold calibrado para janela maior).
- **`openInterestExtreme` (ConfluenceCard/ConfluenceEngine):** `|oi_delta| > 0.005` (0,5% na janela de 5s). **Nunca dispara** (0 casos). → o sinal "OI extremo" do confluence é **morto**. **P1 pendente** (mesma causa: threshold vs janela 5s).
- **`services/.../features/cross-validation.ts`:** código morto no daemon (sem importador) — irrelevante.

## 4. RELAÇÃO COM A CORREÇÃO DO PAINEL

A correção do ΔOI (janela de 1 min client-side) **não** criou nem resolveu os pendentes acima: eles são **pré-existentes** (thresholds mal calibrados para a janela de 5s do daemon), independentes da exibição. O que o painel fix corrigiu foi a **exibição**; os pendentes P1 são do **cálculo/feature engine** e devem ser tratados em outra autorização.

## 5. RECOMENDAÇÕES (não implementadas — aguardando autorização)

- **P1 — `score.ts` OI:** recalibrar os thresholds do componente OI do score para a janela efetiva (5s) — ex.: thresholds em ~0,0005/0,0002 (0,05%/0,02%), OU usar uma janela maior (ex.: ΔOI de 1 min) para os thresholds existentes. **Atenção:** altera o `score` persistido e, logo, a feature `scoreMean` da Fase 1 → **quebra comparabilidade** do histórico de score.
- **P1 — `openInterestExtreme`:** mesmo recalibre (janela de 1 min ou threshold realista). Não é feature da Fase 1.
- **P2 — `viewer.ts:23`:** usar a mesma formatação corrigida (não trunca para 0.000%).

## 6. CONCLUSÃO

- Fase 1 usa OI via `oiMean` + `oiChangeMean` (persistido, **cru, sem truncamento**) e `scoreMean` (com componente OI **morto**).
- **Não existe** `behavior_features`; **Fase 4 não implementada**.
- **A correção do painel não deixou equivalente server-side de exibição quebrado** (o persistido é cru). Mas há **2 pendentes P1 server-side pré-existentes** (score OI morto; openInterestExtreme morto) por threshold × janela de 5s.
- Nenhuma alteração feita. **Parado.**
