# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)

Fonte: `C:\Users\joelh\Site Bitcoiniciantes\BACKUP\preditivo\services\market-ingestion\data\market.db`
Gerado em: 2026-08-31T23:54:15.720Z

## 0. Qualidade dos dados utilizados

- snapshots: 8773 (span 219.5h; cadência ~1/min quando online; uptime efetivo ≈ 146.2h em 32 segmentos)
- gaps > 3 min: 31 | maior: 988.0 min
- resets de CVD detectados (>50% em 1 passo): 210 → features de CVD usam Δ intra-janela; janelas com reset ficam NA
- regime_events: 51705 | whale events (events): 212764 (persistência ativada 2026-08-25T23:07:40.768Z — seção separada, §6)
- N de testes do experimento: 33 (11 features × 3 horizontes) → Bonferroni α = 0.00152
- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.
- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ 10 snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.

## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)

| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |
|---|---|---|---|---|
| 5 min | 1796 | 1256 | 534 | < -0.030% / ≤ 0.028% / > |
| | | | | fronteira: 2026-08-29T20:35:25.602Z |
| 15 min | 597 | 417 | 178 | < -0.054% / ≤ 0.052% / > |
| | | | | fronteira: 2026-08-29T20:39:25.640Z |
| 30 min | 293 | 204 | 88 | < -0.087% / ≤ 0.042% / > |
| | | | | fronteira: 2026-08-29T21:24:25.954Z |

## 2. Horizonte 5 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.030% ≤ RANGE ≤ 0.028% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 1256 | 419 (33.360%) | 420 (33.439%) | 417 (33.201%) |
| Teste | 534 | 157 (29.401%) | 224 (41.948%) | 153 (28.652%) |


### 3.1 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 14.9 | 0.0060⚠ | 0.077 | 0.004% → 0.005% (n=418/419) | 19.3 | 0.0010 | 0.004% → -0.009% (n=155/164) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 19.2 | 0.0030⚠ | 0.087 | 0.005% → -0.007% (n=336/336) | 12.0 | 0.0560 | -0.001% → -0.004% (n=174/125) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 15.3 | 0.0170⚠ | 0.078 | 0.003% → -0.007% (n=336/336) | 22.7 | 0.0020 | 0.007% → -0.000% (n=167/129) | sim |
| OI médio 15m | tercis | 5.6 | 0.2340 | 0.047 | -0.006% → 0.008% (n=418/419) | 25.2 | 0.0010 | 0.003% → 0.005% (n=20/270) | sim |
| ΔOI médio 15m | tercis | 1.5 | 0.8190 | 0.024 | 0.007% → 0.002% (n=418/419) | 9.7 | 0.0360 | -0.000% → 0.001% (n=107/157) | não |
| book imbalance médio 15m | tercis | 2.6 | 0.6420 | 0.032 | 0.005% → 0.000% (n=418/419) | 7.4 | 0.1370 | 0.005% → 0.009% (n=172/147) | não |
| score médio 15m | tercis | 7.1 | 0.1410 | 0.053 | 0.004% → 0.000% (n=419/419) | 3.8 | 0.4150 | -0.000% → 0.003% (n=85/384) | não |
| regime (agrupado) | regime agrupado | 27.1 | 0.0010★ | 0.147 | -0.002% → 0.011% (n=978/278) | 5.7 | 0.0480 | 0.001% → 0.004% (n=447/87) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 2.5 | 0.2970 | 0.045 | -0.015% → 0.002% (n=78/1178) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 3.4 | 0.1970 | 0.052 | -0.014% → 0.002% (n=93/1163) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 4.3 | 0.3470 | 0.042 | -0.006% → 0.002% (n=138/1062) | 22.1 | 0.0010 | 0.010% → -0.001% (n=65/422) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.1 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 1256 | -0.002% | 0.011% | -0.002% | -0.001% | 0.006% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 534 | 0.001% | 0.004% | 0.003% | 0.001% | 0.001% |

### 5.1 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**ΔCVD 15m** (p-perm treino 0.0030, bins: tercis (NA = reset CVD na janela))

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 256 | 289 | 261 | 80 | 47 | 75 |
| ret. médio | 0.005% | -0.003% | -0.009% | 0.006% | 0.015% | -0.002% |

**retorno 15m (feature)** (p-perm treino 0.0060, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 302 | 370 | 306 | 116 | 49 | 113 |
| ret. médio | 0.005% | -0.007% | -0.002% | 0.003% | 0.001% | 0.023% |

**ΔCVD large 15m** (p-perm treino 0.0170, bins: tercis (NA = reset CVD na janela))

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 254 | 291 | 261 | 82 | 45 | 75 |
| ret. médio | 0.003% | -0.001% | -0.009% | 0.003% | 0.017% | -0.000% |

## 2. Horizonte 15 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.054% ≤ RANGE ≤ 0.052% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 417 | 139 (33.333%) | 140 (33.573%) | 138 (33.094%) |
| Teste | 178 | 48 (26.966%) | 69 (38.764%) | 61 (34.270%) |


### 3.2 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 7.6 | 0.1120 | 0.095 | 0.005% → -0.032% (n=139/139) | 10.5 | 0.0350 | 0.001% → -0.028% (n=57/53) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 16.5 | 0.0110⚠ | 0.141 | -0.020% → -0.023% (n=112/113) | 5.8 | 0.4480 | 0.015% → -0.007% (n=56/33) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 16.9 | 0.0100⚠ | 0.142 | -0.020% → -0.022% (n=112/113) | 4.5 | 0.6320 | 0.006% → -0.009% (n=59/38) | sim |
| OI médio 15m | tercis | 2.5 | 0.6370 | 0.055 | -0.009% → 0.002% (n=139/139) | 12.8 | 0.0130 | -0.059% → -0.001% (n=7/88) | sim |
| ΔOI médio 15m | tercis | 3.3 | 0.4900 | 0.063 | -0.015% → -0.005% (n=139/139) | 7.5 | 0.1150 | 0.055% → -0.037% (n=39/50) | não |
| book imbalance médio 15m | tercis | 3.9 | 0.4320 | 0.069 | -0.024% → 0.002% (n=139/139) | 10.2 | 0.0340 | 0.012% → 0.002% (n=59/55) | não |
| score médio 15m | tercis | 2.0 | 0.7450 | 0.048 | -0.017% → -0.006% (n=140/139) | 8.6 | 0.0990 | -0.009% → -0.006% (n=27/128) | sim |
| regime (agrupado) | regime agrupado | 2.6 | 0.2670 | 0.079 | -0.004% → -0.001% (n=337/80) | 2.7 | 0.2830 | -0.012% → 0.007% (n=144/34) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 15.4 | 0.0010★ | 0.192 | -0.075% → 0.001% (n=24/393) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 10.1 | 0.0080⚠ | 0.155 | -0.056% → 0.001% (n=29/388) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 8.4 | 0.0680 | 0.100 | -0.052% → 0.001% (n=42/355) | 5.2 | 0.2620 | 0.001% → -0.014% (n=20/139) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.2 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 417 | -0.004% | -0.001% | 0.011% | 0.013% | -0.034% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 178 | -0.012% | 0.007% | 0.004% | -0.045% | 0.015% |

### 5.2 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº flow_change 15m** (p-perm treino 0.0010, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 19 | 318 | 5 | 75 |
| ret. médio | -0.058% | -0.001% | -0.137% | 0.008% |

**nº absorption_* 15m** (p-perm treino 0.0080, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 23 | 314 | 6 | 74 |
| ret. médio | -0.040% | -0.001% | -0.116% | 0.008% |

**ΔCVD large 15m** (p-perm treino 0.0100, bins: tercis (NA = reset CVD na janela))

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 85 | 103 | 88 | 27 | 10 | 25 |
| ret. médio | -0.004% | 0.010% | -0.030% | -0.067% | 0.046% | 0.008% |

## 2. Horizonte 30 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.087% ≤ RANGE ≤ 0.042% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 204 | 68 (33.333%) | 69 (33.824%) | 67 (32.843%) |
| Teste | 88 | 35 (39.773%) | 24 (27.273%) | 29 (32.955%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.3 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 4.7 | 0.3370 | 0.108 | -0.001% → -0.011% (n=68/68) | 10.1 | 0.0390 | 0.028% → 0.008% (n=29/27) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 2.4 | 0.8770 | 0.077 | 0.010% → -0.053% (n=55/55) | 10.4 | 0.0940 | 0.075% → -0.045% (n=27/17) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 3.8 | 0.7190 | 0.096 | 0.001% → -0.036% (n=55/55) | 8.5 | 0.2150 | 0.055% → -0.043% (n=28/25) | sim |
| OI médio 15m | tercis | 3.6 | 0.5220 | 0.094 | -0.030% → 0.010% (n=68/68) | 11.1 | 0.0200 | -0.207% → 0.013% (n=3/43) | sim |
| ΔOI médio 15m | tercis | 1.4 | 0.8410 | 0.058 | 0.011% → -0.019% (n=68/68) | 9.0 | 0.0540 | 0.132% → -0.071% (n=20/19) | sim |
| book imbalance médio 15m | tercis | 2.5 | 0.6380 | 0.079 | -0.014% → -0.003% (n=68/68) | 5.1 | 0.2890 | 0.073% → -0.026% (n=25/28) | não |
| score médio 15m | tercis | 5.8 | 0.2170 | 0.119 | 0.053% → -0.014% (n=68/68) | 4.7 | 0.3450 | -0.002% → -0.002% (n=15/63) | sim |
| regime (agrupado) | regime agrupado | 1.4 | 0.5280 | 0.082 | -0.021% → 0.053% (n=165/39) | 0.1 | 1.0000 | -0.024% → 0.070% (n=72/16) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 3.7 | 0.1400 | 0.135 | -0.180% → 0.003% (n=11/193) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 3.0 | 0.2060 | 0.121 | -0.122% → 0.002% (n=14/190) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 5.6 | 0.2430 | 0.117 | -0.114% → 0.005% (n=21/173) | 10.6 | 0.0270 | -0.003% → -0.020% (n=12/63) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.3 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 204 | -0.021% | 0.053% | 0.006% | 0.005% | -0.032% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 88 | -0.024% | 0.070% (n=16<30) | -0.009% (n=29<30) | -0.058% (n=29<30) | 0.046% |

### 5.3 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº flow_change 15m** (p-perm treino 0.1400, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 9 | 156 | 2 | 37 |
| ret. médio | -0.166% | -0.012% | -0.244% | 0.069% |

**nº absorption_* 15m** (p-perm treino 0.2060, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 12 | 153 | 2 | 37 |
| ret. médio | -0.101% | -0.014% | -0.244% | 0.069% |

**score médio 15m** (p-perm treino 0.2170, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 51 | 61 | 53 | 17 | 7 | 15 |
| ret. médio | 0.013% | -0.084% | 0.019% | 0.172% | 0.160% | -0.133% |

## 6. Whale events — seção separada (não contamina a comparação histórica)

A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.

- eventos: 212767 | span: 8686.8 min (2026-08-25T23:07:40.768Z → 2026-08-31T23:54:31.723Z)
- volume whale compra: $14394614630 | venda: $15035157027

- análise bloqueada por N insuficiente: precisamos de ≥ 90 janelas de 15m com whale data (≥ 22.5 h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).
- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).

## 7. Veredito (critério de sucesso da Fase 1)

Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?
Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = 0.00152.
Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.

- Horizonte 5 min (treino 1256 / teste 534):
   - sobrevivem Bonferroni no treino: regime (agrupado)
   - evidência fora da amostra (a+b+c): ΔCVD 15m, ΔCVD large 15m
- Horizonte 15 min (treino 417 / teste 178):
   - sobrevivem Bonferroni no treino: nº flow_change 15m
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 30 min (treino 204 / teste 88):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma

CONCLUSÃO: há evidência preliminar fora da amostra em um ou mais horizontes — documentar as variáveis e combinações antes de construir o restante da arquitetura (Fase 2+).

