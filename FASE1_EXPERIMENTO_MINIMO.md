# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)

Fonte: `C:\Users\joelh\Site Bitcoiniciantes\BACKUP\preditivo\services\market-ingestion\data\market.db`
Gerado em: 2026-08-26T00:48:38.432Z

## 0. Qualidade dos dados utilizados

- snapshots: 1600 (span 76.4h; cadência ~1/min quando online; uptime efetivo ≈ 26.7h em 22 segmentos)
- gaps > 3 min: 21 | maior: 988.0 min
- resets de CVD detectados (>50% em 1 passo): 79 → features de CVD usam Δ intra-janela; janelas com reset ficam NA
- regime_events: 7382 | whale events (events): 19522 (persistência ativada 2026-08-25T23:07:40.768Z — seção separada, §6)
- N de testes do experimento: 33 (11 features × 3 horizontes) → Bonferroni α = 0.00152
- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.
- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ 10 snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.

## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)

| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |
|---|---|---|---|---|
| 5 min | 292 | 203 | 83 | < -0.046% / ≤ 0.037% / > |
| | | | | fronteira: 2026-08-24T21:55:57.536Z |
| 15 min | 92 | 63 | 27 | < -0.116% / ≤ 0.062% / > |
| | | | | fronteira: 2026-08-24T21:32:57.372Z |
| 30 min | 42 | 28 | 13 | < -0.198% / ≤ 0.014% / > |
| | | | | fronteira: 2026-08-24T21:17:57.224Z |

## 2. Horizonte 5 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.046% ≤ RANGE ≤ 0.037% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 203 | 68 (33.498%) | 69 (33.990%) | 66 (32.512%) |
| Teste | 83 | 29 (34.940%) | 27 (32.530%) | 27 (32.530%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.1 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 1.9 | 0.7700 | 0.068 | 0.000% → 0.016% (n=67/68) | 7.7 | 0.1160 | 0.039% → 0.022% (n=17/35) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 1.9 | 0.9290 | 0.068 | 0.012% → 0.005% (n=41/41) | 8.3 | 0.2120 | 0.012% → -0.024% (n=3/28) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 1.7 | 0.9380 | 0.065 | -0.001% → 0.005% (n=41/41) | 8.1 | 0.2120 | 0.016% → -0.024% (n=4/28) | não |
| OI médio 15m | tercis | 11.1 | 0.0260⚠ | 0.165 | -0.007% → 0.014% (n=67/68) | 1.5 | 0.5090 | 0.016% → 0.023% (n=65/18) | sim |
| ΔOI médio 15m | tercis | 1.8 | 0.7650 | 0.067 | 0.020% → 0.009% (n=67/68) | 1.9 | 0.7470 | 0.052% → 0.014% (n=22/34) | sim |
| book imbalance médio 15m | tercis | 2.3 | 0.7120 | 0.075 | -0.005% → 0.003% (n=67/68) | 4.6 | 0.3550 | 0.040% → -0.002% (n=27/29) | não |
| score médio 15m | tercis | 4.6 | 0.3180 | 0.106 | -0.001% → 0.001% (n=67/68) | 3.8 | 0.4340 | 0.013% → 0.026% (n=36/31) | sim |
| regime (agrupado) | regime agrupado | 11.2 | 0.0060⚠ | 0.235 | -0.003% → 0.014% (n=145/58) | 0.0 | 1.0000 | 0.013% → 0.027% (n=55/28) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 7.6 | 0.0190⚠ | 0.193 | -0.015% → 0.012% (n=78/125) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 12.4 | 0.0040⚠ | 0.247 | -0.014% → 0.015% (n=93/110) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 10.4 | 0.0260⚠ | 0.160 | -0.007% → 0.008% (n=87/114) | 1.9 | 1.0000 | 0.223% → 0.015% (n=1/82) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.1 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 203 | -0.003% | 0.014% | -0.021% | -0.006% | 0.032% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 83 | 0.013% | 0.027% (n=28<30) | -0.002% (n=27<30) | 0.014% (n=28<30) | 0.039% (n=28<30) |

### 5.1 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº absorption_* 15m** (p-perm treino 0.0040, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 79 | 66 | 14 | 44 |
| ret. médio | -0.008% | 0.002% | -0.047% | 0.034% |

**nº flow_change 15m** (p-perm treino 0.0190, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 68 | 77 | 10 | 48 |
| ret. médio | -0.010% | 0.003% | -0.050% | 0.028% |

**OI médio 15m** (p-perm treino 0.0260, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 53 | 53 | 39 | 14 | 15 | 29 |
| ret. médio | 0.004% | -0.020% | 0.010% | -0.047% | 0.060% | 0.020% |

## 2. Horizonte 15 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.116% ≤ RANGE ≤ 0.062% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 63 | 21 (33.333%) | 22 (34.921%) | 20 (31.746%) |
| Teste | 27 | 9 (33.333%) | 15 (55.556%) | 3 (11.111%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.2 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 3.9 | 0.4390 | 0.177 | 0.006% → 0.021% (n=21/21) | 4.8 | 0.3310 | 0.055% → -0.091% (n=8/9) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 2.2 | 0.8890 | 0.133 | -0.005% → -0.012% (n=12/13) | 5.4 | 0.4970 | 0.116% → -0.110% (n=1/8) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 2.2 | 0.9120 | 0.133 | -0.005% → -0.012% (n=12/13) | 7.2 | 0.3430 | 0.097% → -0.099% (n=2/9) | sim |
| OI médio 15m | tercis | 6.6 | 0.1530 | 0.229 | -0.011% → 0.032% (n=21/21) | 0.9 | 0.6340 | 0.022% → 0.069% (n=23/4) | sim |
| ΔOI médio 15m | tercis | 5.5 | 0.2540 | 0.209 | -0.020% → -0.024% (n=21/21) | 2.3 | 0.7200 | 0.001% → 0.066% (n=9/12) | não |
| book imbalance médio 15m | tercis | 2.4 | 0.6930 | 0.139 | -0.031% → -0.031% (n=21/21) | 2.4 | 0.7510 | -0.001% → -0.022% (n=7/8) | não |
| score médio 15m | tercis | 4.7 | 0.3400 | 0.194 | 0.002% → -0.048% (n=21/21) | 1.8 | 0.8260 | 0.061% → -0.001% (n=14/9) | sim |
| regime (agrupado) | regime agrupado | 7.4 | 0.0290⚠ | 0.343 | -0.040% → 0.020% (n=41/22) | 2.4 | 0.3060 | 0.019% → 0.045% (n=17/10) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 2.0 | 0.4160 | 0.180 | -0.075% → 0.016% (n=24/39) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 2.2 | 0.3520 | 0.185 | -0.056% → 0.013% (n=29/34) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 6.1 | 0.1480 | 0.220 | -0.075% → 0.024% (n=27/35) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.2 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 63 | -0.040% | 0.020% (n=22<30) | -0.014% (n=21<30) | -0.022% (n=21<30) | -0.021% (n=21<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 27 | 0.019% (n=17<30) | 0.045% (n=10<30) | -0.013% (n=9<30) | 0.123% (n=9<30) | -0.024% (n=9<30) |

### 5.2 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.1480, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 20 | 1 | 20 | 7 | 15 |
| ret. médio | -0.064% | 0.016% | -0.018% | -0.108% | 0.080% |

**OI médio 15m** (p-perm treino 0.1530, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 14 | 15 | 12 | 7 | 6 | 9 |
| ret. médio | 0.023% | -0.120% | -0.011% | -0.077% | 0.030% | 0.089% |

**ΔOI médio 15m** (p-perm treino 0.2540, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 13 | 15 | 13 | 8 | 6 | 8 |
| ret. médio | -0.003% | -0.054% | -0.059% | -0.046% | 0.090% | 0.033% |

## 2. Horizonte 30 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.198% ≤ RANGE ≤ 0.014% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 28 | 10 (35.714%) | 10 (35.714%) | 8 (28.571%) |
| Teste | 13 | 5 (38.462%) | 6 (46.154%) | 2 (15.385%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.3 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 1.8 | 0.8230 | 0.180 | 0.179% → 0.005% (n=9/10) | 1.6 | 1.0000 | 0.184% → -0.075% (n=4/6) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 7.6 | 0.2710 | 0.368 | 0.374% → 0.062% (n=5/5) | 5.0 | 0.5380 | -0.014% → 0.079% (n=1/8) | não |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 7.6 | 0.2700 | 0.368 | 0.374% → 0.062% (n=5/5) | 5.0 | 0.5400 | -0.014% → 0.079% (n=1/8) | não |
| OI médio 15m | tercis | 1.7 | 0.8410 | 0.176 | -0.074% → 0.052% (n=9/10) | 1.7 | 0.5120 | 0.012% → 0.200% (n=12/1) | sim |
| ΔOI médio 15m | tercis | 4.7 | 0.3590 | 0.289 | -0.036% → -0.025% (n=9/10) | 6.8 | 0.1160 | -0.024% → -0.099% (n=4/2) | não |
| book imbalance médio 15m | tercis | 1.8 | 0.8210 | 0.180 | -0.068% → 0.099% (n=9/10) | 11.5 | 0.0130 | 0.441% → 0.000% (n=2/6) | não |
| score médio 15m | tercis | 6.1 | 0.2250 | 0.329 | 0.193% → -0.111% (n=9/10) | 6.5 | 0.2130 | 0.088% → -0.058% (n=7/5) | sim |
| regime (agrupado) | regime agrupado | 2.0 | 0.5630 | 0.267 | -0.093% → 0.210% (n=21/7) | 1.0 | 0.7210 | -0.037% → 0.240% (n=10/3) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 5.8 | 0.1070 | 0.454 | -0.180% → 0.088% (n=11/17) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 5.7 | 0.0850 | 0.451 | -0.122% → 0.086% (n=14/14) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 10.7 | 0.0230⚠ | 0.438 | -0.168% → 0.119% (n=12/15) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.3 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 28 | -0.093% (n=21<30) | 0.210% (n=7<30) | -0.110% (n=9<30) | -0.080% (n=9<30) | 0.122% (n=10<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 13 | -0.037% (n=10<30) | 0.240% (n=3<30) | -0.042% (n=4<30) | 0.009% (n=4<30) | 0.096% (n=5<30) |

### 5.3 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.0230, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 9 | 1 | 11 | 3 | 4 |
| ret. médio | -0.166% | -0.271% | -0.018% | -0.173% | 0.497% |

**nº absorption_* 15m** (p-perm treino 0.0850, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 12 | 9 | 2 | 5 |
| ret. médio | -0.101% | -0.083% | -0.244% | 0.392% |

**nº flow_change 15m** (p-perm treino 0.1070, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 9 | 12 | 2 | 5 |
| ret. médio | -0.166% | -0.039% | -0.244% | 0.392% |

## 6. Whale events — seção separada (não contamina a comparação histórica)

A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.

- eventos: 19523 | span: 101.0 min (2026-08-25T23:07:40.768Z → 2026-08-26T00:48:38.207Z)
- volume whale compra: $258010389 | venda: $267843310

- análise bloqueada por N insuficiente: precisamos de ≥ 90 janelas de 15m com whale data (≥ 22.5 h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).
- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).

## 7. Veredito (critério de sucesso da Fase 1)

Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?
Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = 0.00152.
Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.

- Horizonte 5 min (treino 203 / teste 83):
   - sobrevivem Bonferroni no treino: nº absorption_* 15m
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 15 min (treino 63 / teste 27):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 30 min (treino 28 / teste 13):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma

CONCLUSÃO: NENHUMA evidência fora da amostra encontrada até aqui. Hipótese central NÃO suportada pelos dados atuais.
Nota de poder estatístico: o maior teste tem apenas ~77 observações (N<90 p/ 30/classe) — a ausência de evidência não é prova de ausência de efeito; o experimento precisa de mais dados (especialmente pós-ativação do saveEvent) antes de qualquer conclusão forte.

