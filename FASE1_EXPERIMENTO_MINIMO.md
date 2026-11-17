# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)

Fonte: `C:\Users\joelh\Site Bitcoiniciantes\BACKUP\preditivo\services\market-ingestion\data\market.db`
Gerado em: 2026-09-05T22:13:40.401Z

## 0. Qualidade dos dados utilizados

- snapshots: 14927 (span 337.8h; cadência ~1/min quando online; uptime efetivo ≈ 248.8h em 38 segmentos)
- gaps > 3 min: 37 | maior: 988.0 min
- resets de CVD detectados (>50% em 1 passo): 275 → features de CVD usam Δ intra-janela; janelas com reset ficam NA
- regime_events: 88159 | whale events (events): 304700 (persistência ativada 2026-08-25T23:07:40.768Z — seção separada, §6)
- N de testes do experimento: 33 (11 features × 3 horizontes) → Bonferroni α = 0.00152
- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.
- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ 10 snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.

## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)

| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |
|---|---|---|---|---|
| 5 min | 2950 | 2064 | 880 | < -0.028% / ≤ 0.025% / > |
| | | | | fronteira: 2026-09-01T22:39:41.055Z |
| 15 min | 998 | 697 | 299 | < -0.058% / ≤ 0.048% / > |
| | | | | fronteira: 2026-09-02T00:52:41.905Z |
| 30 min | 494 | 345 | 148 | < -0.088% / ≤ 0.048% / > |
| | | | | fronteira: 2026-09-02T03:57:57.927Z |

## 2. Horizonte 5 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.028% ≤ RANGE ≤ 0.025% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 2064 | 688 (33.333%) | 689 (33.382%) | 687 (33.285%) |
| Teste | 880 | 276 (31.364%) | 340 (38.636%) | 264 (30.000%) |


### 3.1 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 26.6 | 0.0010★ | 0.080 | 0.003% → -0.002% (n=688/688) | 20.3 | 0.0010 | 0.013% → -0.013% (n=262/298) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 31.3 | 0.0020⚠ | 0.087 | -0.001% → -0.007% (n=589/590) | 22.7 | 0.0010 | 0.005% → -0.010% (n=230/291) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 36.6 | 0.0010★ | 0.094 | 0.003% → -0.005% (n=589/590) | 24.4 | 0.0010 | 0.001% → -0.011% (n=243/273) | sim |
| OI médio 15m | tercis | 2.3 | 0.6790 | 0.023 | -0.004% → 0.002% (n=688/688) | 57.3 | 0.0010 | -0.002% → -0.003% (n=57/489) | não |
| ΔOI médio 15m | tercis | 7.1 | 0.1370 | 0.041 | 0.002% → 0.001% (n=688/688) | 24.8 | 0.0010 | -0.008% → 0.005% (n=352/238) | não |
| book imbalance médio 15m | tercis | 3.0 | 0.5560 | 0.027 | 0.001% → -0.001% (n=688/688) | 6.2 | 0.1600 | 0.004% → 0.000% (n=273/279) | sim |
| score médio 15m | tercis | 19.7 | 0.0010★ | 0.069 | -0.001% → 0.001% (n=688/688) | 20.5 | 0.0010 | 0.003% → -0.010% (n=401/241) | não |
| regime (agrupado) | regime agrupado | 41.1 | 0.0010★ | 0.141 | -0.002% → 0.009% (n=1641/423) | 6.6 | 0.0400 | 0.000% → -0.009% (n=711/169) | não |
| nº flow_change 15m | contagem (0/1/2+) | 2.2 | 0.3630 | 0.032 | -0.015% → 0.001% (n=78/1986) | 1.6 | 1.0000 | 0.000% → -0.002% (n=1/879) | não |
| nº absorption_* 15m | contagem (0/1/2+) | 2.6 | 0.2630 | 0.036 | -0.014% → 0.001% (n=93/1971) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 22.5 | 0.0010★ | 0.074 | -0.001% → -0.000% (n=208/1747) | 36.1 | 0.0010 | 0.011% → -0.004% (n=93/721) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.1 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 2064 | -0.002% | 0.009% | 0.001% | -0.005% | 0.005% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 880 | 0.000% | -0.009% | 0.001% | 0.003% | -0.009% |

### 5.1 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**retorno 15m (feature)** (p-perm treino 0.0010, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 510 | 612 | 519 | 178 | 76 | 169 |
| ret. médio | 0.000% | -0.001% | -0.005% | 0.012% | 0.002% | 0.009% |

**ΔCVD large 15m** (p-perm treino 0.0010, bins: tercis (NA = reset CVD na janela))

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 455 | 515 | 466 | 134 | 74 | 124 |
| ret. médio | 0.002% | -0.003% | -0.006% | 0.009% | 0.004% | -0.000% |

**score médio 15m** (p-perm treino 0.0010, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 525 | 525 | 591 | 163 | 163 | 97 |
| ret. médio | -0.004% | -0.000% | -0.001% | 0.009% | 0.006% | 0.013% |

## 2. Horizonte 15 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.058% ≤ RANGE ≤ 0.048% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 697 | 233 (33.429%) | 233 (33.429%) | 231 (33.142%) |
| Teste | 299 | 96 (32.107%) | 107 (35.786%) | 96 (32.107%) |


### 3.2 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 9.7 | 0.0360⚠ | 0.083 | -0.008% → -0.021% (n=232/233) | 13.8 | 0.0050 | 0.011% → -0.015% (n=93/106) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 12.7 | 0.0460⚠ | 0.095 | -0.007% → -0.023% (n=200/200) | 19.2 | 0.0060 | 0.001% → -0.018% (n=86/96) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 15.5 | 0.0120⚠ | 0.106 | -0.012% → -0.020% (n=200/200) | 26.4 | 0.0010 | -0.003% → -0.021% (n=84/91) | sim |
| OI médio 15m | tercis | 5.4 | 0.2520 | 0.062 | -0.013% → -0.002% (n=232/233) | 33.2 | 0.0010 | -0.001% → -0.010% (n=20/160) | não |
| ΔOI médio 15m | tercis | 4.4 | 0.3790 | 0.056 | -0.008% → -0.014% (n=232/233) | 8.2 | 0.0810 | -0.014% → 0.012% (n=127/76) | não |
| book imbalance médio 15m | tercis | 5.3 | 0.2650 | 0.062 | -0.017% → -0.001% (n=232/233) | 4.9 | 0.2840 | 0.018% → -0.020% (n=92/90) | não |
| score médio 15m | tercis | 9.7 | 0.0430⚠ | 0.083 | -0.018% → -0.006% (n=232/233) | 11.4 | 0.0250 | 0.000% → -0.004% (n=129/81) | não |
| regime (agrupado) | regime agrupado | 3.8 | 0.1670 | 0.073 | -0.008% → 0.002% (n=561/136) | 6.9 | 0.0340 | 0.013% → -0.056% (n=241/58) | não |
| nº flow_change 15m | contagem (0/1/2+) | 11.3 | 0.0070⚠ | 0.127 | -0.075% → -0.004% (n=24/673) | 1.8 | 1.0000 | 0.007% → -0.000% (n=1/298) | não |
| nº absorption_* 15m | contagem (0/1/2+) | 7.1 | 0.0300⚠ | 0.101 | -0.056% → -0.004% (n=29/668) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 3.9 | 0.4030 | 0.053 | -0.031% → -0.005% (n=64/590) | 24.2 | 0.0010 | 0.022% → -0.003% (n=29/249) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.2 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 697 | -0.008% | 0.002% | -0.006% | 0.002% | -0.015% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 299 | 0.013% | -0.056% | -0.004% | 0.028% | -0.025% |

### 5.2 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº flow_change 15m** (p-perm treino 0.0070, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 19 | 542 | 5 | 131 |
| ret. médio | -0.058% | -0.006% | -0.137% | 0.007% |

**ΔCVD large 15m** (p-perm treino 0.0120, bins: tercis (NA = reset CVD na janela))

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 153 | 180 | 159 | 47 | 20 | 41 |
| ret. médio | -0.011% | 0.004% | -0.024% | -0.015% | 0.032% | -0.006% |

**nº absorption_* 15m** (p-perm treino 0.0300, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 23 | 538 | 6 | 130 |
| ret. médio | -0.040% | -0.007% | -0.116% | 0.007% |

## 2. Horizonte 30 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.088% ≤ RANGE ≤ 0.048% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 345 | 115 (33.333%) | 116 (33.623%) | 114 (33.043%) |
| Teste | 148 | 51 (34.459%) | 57 (38.514%) | 40 (27.027%) |


### 3.3 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 4.0 | 0.4010 | 0.077 | 0.006% → -0.009% (n=115/115) | 2.3 | 0.7110 | -0.020% → -0.015% (n=37/50) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 5.2 | 0.5040 | 0.087 | 0.019% → -0.056% (n=99/99) | 11.3 | 0.0650 | -0.026% → -0.047% (n=36/50) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 4.0 | 0.7020 | 0.076 | 0.017% → -0.037% (n=99/99) | 5.8 | 0.4690 | -0.016% → -0.030% (n=37/49) | sim |
| OI médio 15m | tercis | 0.6 | 0.9690 | 0.028 | -0.029% → -0.012% (n=115/115) | 16.1 | 0.0030 | -0.025% → -0.043% (n=10/75) | não |
| ΔOI médio 15m | tercis | 5.6 | 0.2190 | 0.090 | 0.030% → -0.028% (n=115/115) | 3.8 | 0.4460 | -0.001% → -0.007% (n=62/50) | sim |
| book imbalance médio 15m | tercis | 4.8 | 0.2920 | 0.084 | -0.016% → -0.015% (n=115/115) | 4.7 | 0.3290 | -0.031% → -0.022% (n=40/35) | sim |
| score médio 15m | tercis | 4.6 | 0.3330 | 0.082 | 0.021% → -0.016% (n=115/115) | 6.3 | 0.1600 | 0.005% → -0.059% (n=66/43) | sim |
| regime (agrupado) | regime agrupado | 2.2 | 0.3390 | 0.079 | -0.022% → 0.036% (n=283/62) | 0.9 | 0.6460 | -0.004% → -0.036% (n=116/32) | não |
| nº flow_change 15m | contagem (0/1/2+) | 3.6 | 0.1320 | 0.102 | -0.180% → -0.006% (n=11/334) | 1.9 | 0.5870 | 0.151% → -0.012% (n=1/147) | não |
| nº absorption_* 15m | contagem (0/1/2+) | 2.9 | 0.2460 | 0.091 | -0.122% → -0.007% (n=14/331) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 10.6 | 0.0280⚠ | 0.124 | -0.064% → -0.009% (n=35/285) | 7.7 | 0.0990 | 0.035% → -0.026% (n=18/118) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.3 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 345 | -0.022% | 0.036% | -0.004% | -0.028% | -0.003% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 148 | -0.004% | -0.036% | 0.028% | -0.004% | -0.056% |

### 5.3 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.0280, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|1 | trend|2+ |
| --- | --- | --- | --- | --- | --- | --- |
| N | 31 | 23 | 229 | 4 | 2 | 56 |
| ret. médio | -0.055% | 0.033% | -0.023% | -0.138% | 0.005% | 0.050% |

**nº flow_change 15m** (p-perm treino 0.1320, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 9 | 274 | 2 | 60 |
| ret. médio | -0.166% | -0.017% | -0.244% | 0.046% |

**ΔOI médio 15m** (p-perm treino 0.2190, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 88 | 104 | 91 | 27 | 11 | 24 |
| ret. médio | 0.036% | -0.042% | -0.056% | 0.008% | 0.009% | 0.080% |

## 6. Whale events — seção separada (não contamina a comparação histórica)

A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.

- eventos: 304706 | span: 15787.3 min (2026-08-25T23:07:40.768Z → 2026-09-05T22:15:01.618Z)
- volume whale compra: $27259236416 | venda: $28504388337

- análise bloqueada por N insuficiente: precisamos de ≥ 90 janelas de 15m com whale data (≥ 22.5 h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).
- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).

## 7. Veredito (critério de sucesso da Fase 1)

Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?
Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = 0.00152.
Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.

- Horizonte 5 min (treino 2064 / teste 880):
   - sobrevivem Bonferroni no treino: ΔCVD 15m, ΔCVD large 15m, score médio 15m, regime (agrupado), nº divergence* 15m
   - evidência fora da amostra (a+b+c): retorno 15m (feature), ΔCVD 15m, ΔCVD large 15m
- Horizonte 15 min (treino 697 / teste 299):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): retorno 15m (feature), ΔCVD 15m, ΔCVD large 15m
- Horizonte 30 min (treino 345 / teste 148):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma

CONCLUSÃO: há evidência preliminar fora da amostra em um ou mais horizontes — documentar as variáveis e combinações antes de construir o restante da arquitetura (Fase 2+).

