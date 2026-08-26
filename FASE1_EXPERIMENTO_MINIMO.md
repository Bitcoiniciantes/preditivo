# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)

Fonte: `C:\Users\joelh\Site Bitcoiniciantes\BACKUP\preditivo\services\market-ingestion\data\market.db`
Gerado em: 2026-08-26T00:35:11.074Z

## 0. Qualidade dos dados utilizados

- snapshots: 1588 (span 76.2h; cadência ~1/min quando online; uptime efetivo ≈ 26.5h em 22 segmentos)
- gaps > 3 min: 21 | maior: 988.0 min
- resets de CVD detectados (>50% em 1 passo): 78 → features de CVD usam Δ intra-janela; janelas com reset ficam NA
- regime_events: 7286 | whale events (events): 16788 (persistência ativada 2026-08-25T23:07:40.768Z — seção separada, §6)
- N de testes do experimento: 33 (11 features × 3 horizontes) → Bonferroni α = 0.00152
- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.
- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ 10 snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.

## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)

| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |
|---|---|---|---|---|
| 5 min | 290 | 202 | 82 | < -0.046% / ≤ 0.037% / > |
| | | | | fronteira: 2026-08-24T21:50:57.494Z |
| 15 min | 91 | 62 | 27 | < -0.129% / ≤ 0.062% / > |
| | | | | fronteira: 2026-08-24T21:17:57.224Z |
| 30 min | 42 | 28 | 13 | < -0.198% / ≤ 0.014% / > |
| | | | | fronteira: 2026-08-24T21:17:57.224Z |

## 2. Horizonte 5 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.046% ≤ RANGE ≤ 0.037% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 202 | 68 (33.663%) | 68 (33.663%) | 66 (32.673%) |
| Teste | 82 | 29 (35.366%) | 27 (32.927%) | 26 (31.707%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.1 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 1.2 | 0.8730 | 0.055 | 0.000% → 0.016% (n=67/68) | 8.2 | 0.0910 | 0.040% → 0.022% (n=17/35) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 1.3 | 0.9730 | 0.057 | 0.011% → 0.007% (n=40/41) | 8.8 | 0.1940 | 0.012% → -0.018% (n=3/26) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 1.3 | 0.9800 | 0.057 | 0.002% → 0.007% (n=40/41) | 8.6 | 0.1730 | 0.016% → -0.018% (n=4/26) | não |
| OI médio 15m | tercis | 11.8 | 0.0160⚠ | 0.171 | -0.007% → 0.014% (n=67/68) | 1.7 | 0.4490 | 0.019% → 0.023% (n=64/18) | sim |
| ΔOI médio 15m | tercis | 1.4 | 0.8540 | 0.059 | 0.020% → 0.009% (n=67/68) | 1.9 | 0.7420 | 0.052% → 0.020% (n=22/33) | sim |
| book imbalance médio 15m | tercis | 2.2 | 0.6920 | 0.074 | -0.006% → 0.003% (n=67/68) | 4.5 | 0.3640 | 0.052% → -0.002% (n=25/29) | não |
| score médio 15m | tercis | 5.0 | 0.2940 | 0.112 | 0.001% → 0.001% (n=67/68) | 5.2 | 0.2660 | 0.019% → 0.026% (n=39/31) | sim |
| regime (agrupado) | regime agrupado | 12.7 | 0.0010★ | 0.250 | -0.003% → 0.014% (n=144/58) | 0.0 | 1.0000 | 0.017% → 0.027% (n=54/28) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 8.0 | 0.0230⚠ | 0.199 | -0.015% → 0.013% (n=78/124) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 13.1 | 0.0040⚠ | 0.254 | -0.014% → 0.015% (n=93/109) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 10.9 | 0.0210⚠ | 0.165 | -0.007% → 0.008% (n=87/113) | 1.9 | 1.0000 | 0.223% → 0.018% (n=1/81) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.1 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 202 | -0.003% | 0.014% | -0.019% | -0.008% | 0.032% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 82 | 0.017% | 0.027% (n=28<30) | -0.004% (n=27<30) | 0.025% (n=27<30) | 0.039% (n=28<30) |

### 5.1 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº absorption_* 15m** (p-perm treino 0.0040, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 79 | 65 | 14 | 44 |
| ret. médio | -0.008% | 0.003% | -0.047% | 0.034% |

**OI médio 15m** (p-perm treino 0.0160, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 53 | 52 | 39 | 14 | 15 | 29 |
| ret. médio | 0.004% | -0.019% | 0.010% | -0.047% | 0.060% | 0.020% |

**nº divergence* 15m** (p-perm treino 0.0210, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 71 | 2 | 71 | 16 | 42 |
| ret. médio | -0.010% | 0.034% | 0.004% | 0.007% | 0.017% |

## 2. Horizonte 15 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.129% ≤ RANGE ≤ 0.062% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 62 | 21 (33.871%) | 22 (35.484%) | 19 (30.645%) |
| Teste | 27 | 9 (33.333%) | 15 (55.556%) | 3 (11.111%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.2 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 2.2 | 0.7020 | 0.134 | 0.003% → 0.021% (n=20/21) | 4.8 | 0.3440 | 0.055% → -0.103% (n=8/9) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 1.5 | 0.9640 | 0.112 | -0.005% → -0.014% (n=12/12) | 11.7 | 0.0650 | 0.116% → -0.130% (n=1/7) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 3.5 | 0.7810 | 0.168 | -0.005% → 0.016% (n=12/12) | 12.3 | 0.0330 | 0.097% → -0.125% (n=2/8) | não |
| OI médio 15m | tercis | 6.4 | 0.1930 | 0.228 | -0.019% → 0.032% (n=20/21) | 0.9 | 0.5900 | 0.017% → 0.069% (n=23/4) | sim |
| ΔOI médio 15m | tercis | 5.8 | 0.2380 | 0.216 | -0.012% → -0.024% (n=20/21) | 5.8 | 0.2660 | -0.034% → 0.081% (n=5/11) | não |
| book imbalance médio 15m | tercis | 2.7 | 0.6250 | 0.147 | -0.031% → -0.031% (n=20/21) | 5.4 | 0.2500 | -0.016% → -0.022% (n=7/8) | não |
| score médio 15m | tercis | 5.8 | 0.2140 | 0.216 | 0.001% → -0.048% (n=20/21) | 1.8 | 0.8580 | 0.053% → -0.001% (n=14/9) | sim |
| regime (agrupado) | regime agrupado | 5.5 | 0.0720 | 0.298 | -0.041% → 0.020% (n=40/22) | 1.8 | 0.6090 | 0.006% → 0.061% (n=18/9) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 2.5 | 0.2900 | 0.201 | -0.075% → 0.016% (n=24/38) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 2.6 | 0.3190 | 0.203 | -0.056% → 0.013% (n=29/33) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 5.5 | 0.2040 | 0.211 | -0.075% → 0.024% (n=27/34) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.2 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 62 | -0.041% | 0.020% (n=22<30) | -0.016% (n=20<30) | -0.022% (n=21<30) | -0.021% (n=21<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 27 | 0.006% (n=18<30) | 0.061% (n=9<30) | -0.037% (n=9<30) | 0.115% (n=9<30) | -0.005% (n=9<30) |

### 5.2 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**OI médio 15m** (p-perm treino 0.1930, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 14 | 14 | 12 | 6 | 7 | 9 |
| ret. médio | 0.023% | -0.131% | -0.011% | -0.116% | 0.049% | 0.089% |

**nº divergence* 15m** (p-perm treino 0.2040, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 20 | 1 | 19 | 7 | 15 |
| ret. médio | -0.064% | 0.016% | -0.020% | -0.108% | 0.080% |

**score médio 15m** (p-perm treino 0.2140, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 14 | 16 | 10 | 6 | 5 | 11 |
| ret. médio | 0.019% | -0.087% | -0.052% | -0.043% | 0.236% | -0.044% |

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
| retorno 15m (feature) | tercis | 1.8 | 0.8080 | 0.180 | 0.179% → 0.005% (n=9/10) | 1.6 | 1.0000 | 0.184% → -0.075% (n=4/6) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 7.6 | 0.2820 | 0.368 | 0.374% → 0.062% (n=5/5) | 5.0 | 0.5550 | -0.014% → 0.079% (n=1/8) | não |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 7.6 | 0.2730 | 0.368 | 0.374% → 0.062% (n=5/5) | 5.0 | 0.5280 | -0.014% → 0.079% (n=1/8) | não |
| OI médio 15m | tercis | 1.7 | 0.8570 | 0.176 | -0.074% → 0.052% (n=9/10) | 1.7 | 0.5310 | 0.012% → 0.200% (n=12/1) | sim |
| ΔOI médio 15m | tercis | 4.7 | 0.3460 | 0.289 | -0.036% → -0.025% (n=9/10) | 6.8 | 0.1050 | -0.024% → -0.099% (n=4/2) | não |
| book imbalance médio 15m | tercis | 1.8 | 0.8220 | 0.180 | -0.068% → 0.099% (n=9/10) | 11.5 | 0.0160 | 0.441% → 0.000% (n=2/6) | não |
| score médio 15m | tercis | 6.1 | 0.2200 | 0.329 | 0.193% → -0.111% (n=9/10) | 6.5 | 0.1950 | 0.088% → -0.058% (n=7/5) | sim |
| regime (agrupado) | regime agrupado | 2.0 | 0.5550 | 0.267 | -0.093% → 0.210% (n=21/7) | 1.0 | 0.7450 | -0.037% → 0.240% (n=10/3) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 5.8 | 0.0940 | 0.454 | -0.180% → 0.088% (n=11/17) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 5.7 | 0.0790 | 0.451 | -0.122% → 0.086% (n=14/14) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 10.7 | 0.0140⚠ | 0.438 | -0.168% → 0.119% (n=12/15) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.3 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 28 | -0.093% (n=21<30) | 0.210% (n=7<30) | -0.110% (n=9<30) | -0.080% (n=9<30) | 0.122% (n=10<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 13 | -0.037% (n=10<30) | 0.240% (n=3<30) | -0.042% (n=4<30) | 0.009% (n=4<30) | 0.096% (n=5<30) |

### 5.3 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.0140, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 9 | 1 | 11 | 3 | 4 |
| ret. médio | -0.166% | -0.271% | -0.018% | -0.173% | 0.497% |

**nº absorption_* 15m** (p-perm treino 0.0790, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 12 | 9 | 2 | 5 |
| ret. médio | -0.101% | -0.083% | -0.244% | 0.392% |

**nº flow_change 15m** (p-perm treino 0.0940, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 9 | 12 | 2 | 5 |
| ret. médio | -0.166% | -0.039% | -0.244% | 0.392% |

## 6. Whale events — seção separada (não contamina a comparação histórica)

A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.

- eventos: 16790 | span: 87.5 min (2026-08-25T23:07:40.768Z → 2026-08-26T00:35:10.808Z)
- volume whale compra: $223320922 | venda: $240328546

- análise bloqueada por N insuficiente: precisamos de ≥ 90 janelas de 15m com whale data (≥ 22.5 h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).
- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).

## 7. Veredito (critério de sucesso da Fase 1)

Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?
Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = 0.00152.
Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.

- Horizonte 5 min (treino 202 / teste 82):
   - sobrevivem Bonferroni no treino: nº absorption_* 15m
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 15 min (treino 62 / teste 27):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 30 min (treino 28 / teste 13):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma

CONCLUSÃO: NENHUMA evidência fora da amostra encontrada até aqui. Hipótese central NÃO suportada pelos dados atuais.
Nota de poder estatístico: o maior teste tem apenas ~77 observações (N<90 p/ 30/classe) — a ausência de evidência não é prova de ausência de efeito; o experimento precisa de mais dados (especialmente pós-ativação do saveEvent) antes de qualquer conclusão forte.

