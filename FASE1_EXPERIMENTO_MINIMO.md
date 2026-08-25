# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)

Fonte: `C:\Users\joelh\Site Bitcoiniciantes\BACKUP\preditivo\services\market-ingestion\data\market.db`
Gerado em: 2026-08-25T23:19:46.628Z

## 0. Qualidade dos dados utilizados

- snapshots: 1518 (span 75.0h; cadência ~1/min quando online; uptime efetivo ≈ 25.3h em 22 segmentos)
- gaps > 3 min: 21 | maior: 988.0 min
- resets de CVD detectados (>50% em 1 passo): 72 → features de CVD usam Δ intra-janela; janelas com reset ficam NA
- regime_events: 6702 | whale events (events): 2062 (persistência ativada 2026-08-25T23:07:40.768Z — seção separada, §6)
- N de testes do experimento: 33 (11 features × 3 horizontes) → Bonferroni α = 0.00152
- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.
- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ 10 snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.

## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)

| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |
|---|---|---|---|---|
| 5 min | 275 | 191 | 78 | < -0.046% / ≤ 0.035% / > |
| | | | | fronteira: 2026-08-24T20:54:56.970Z |
| 15 min | 86 | 59 | 25 | < -0.135% / ≤ 0.056% / > |
| | | | | fronteira: 2026-08-24T20:32:56.823Z |
| 30 min | 39 | 26 | 12 | < -0.200% / ≤ -0.004% / > |
| | | | | fronteira: 2026-08-24T20:17:56.732Z |

## 2. Horizonte 5 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.046% ≤ RANGE ≤ 0.035% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 191 | 64 (33.508%) | 65 (34.031%) | 62 (32.461%) |
| Teste | 78 | 23 (29.487%) | 30 (38.462%) | 25 (32.051%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.1 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 3.0 | 0.5650 | 0.089 | 0.003% → 0.019% (n=63/64) | 5.3 | 0.2580 | 0.060% → 0.023% (n=10/33) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 2.1 | 0.9230 | 0.074 | 0.001% → 0.005% (n=37/37) | 5.7 | 0.4950 | 0.012% → -0.008% (n=3/26) | não |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 3.7 | 0.6970 | 0.099 | 0.001% → 0.011% (n=37/37) | 5.0 | 0.5840 | 0.016% → -0.014% (n=4/24) | não |
| OI médio 15m | tercis | 14.0 | 0.0060⚠ | 0.191 | -0.006% → 0.013% (n=63/64) | 1.0 | 0.5990 | 0.014% → 0.034% (n=61/17) | sim |
| ΔOI médio 15m | tercis | 2.7 | 0.5840 | 0.085 | 0.024% → 0.011% (n=63/64) | 1.7 | 0.7930 | 0.052% → 0.017% (n=23/25) | sim |
| book imbalance médio 15m | tercis | 2.2 | 0.6640 | 0.077 | -0.008% → 0.004% (n=63/64) | 2.3 | 0.6930 | 0.061% → -0.014% (n=25/25) | não |
| score médio 15m | tercis | 2.7 | 0.6130 | 0.084 | -0.006% → -0.003% (n=63/64) | 1.8 | 0.7700 | 0.014% → 0.041% (n=45/22) | sim |
| regime (agrupado) | regime agrupado | 10.5 | 0.0080⚠ | 0.235 | -0.004% → 0.012% (n=134/57) | 0.3 | 0.9090 | 0.013% → 0.032% (n=57/21) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 8.8 | 0.0120⚠ | 0.215 | -0.015% → 0.012% (n=78/113) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 11.9 | 0.0050⚠ | 0.250 | -0.014% → 0.015% (n=93/98) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 8.8 | 0.0220⚠ | 0.151 | -0.007% → 0.007% (n=87/103) | 4.0 | 0.6150 | 0.223% → 0.015% (n=1/76) | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.1 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 191 | -0.004% | 0.012% | -0.019% | -0.012% | 0.033% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 78 | 0.013% | 0.032% (n=21<30) | 0.009% (n=26<30) | -0.018% (n=26<30) | 0.064% (n=26<30) |

### 5.1 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº absorption_* 15m** (p-perm treino 0.0050, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 79 | 55 | 14 | 43 |
| ret. médio | -0.008% | 0.002% | -0.047% | 0.031% |

**OI médio 15m** (p-perm treino 0.0060, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 49 | 50 | 35 | 14 | 14 | 29 |
| ret. médio | 0.005% | -0.021% | 0.008% | -0.047% | 0.056% | 0.020% |

**nº flow_change 15m** (p-perm treino 0.0120, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 68 | 66 | 10 | 47 |
| ret. médio | -0.010% | 0.003% | -0.050% | 0.025% |

## 2. Horizonte 15 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.135% ≤ RANGE ≤ 0.056% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 59 | 20 (33.898%) | 21 (35.593%) | 18 (30.508%) |
| Teste | 25 | 8 (32.000%) | 15 (60.000%) | 2 (8.000%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.2 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 1.0 | 0.9010 | 0.092 | -0.003% → 0.019% (n=19/20) | 6.0 | 0.2020 | 0.050% → -0.088% (n=5/10) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 3.9 | 0.7060 | 0.182 | -0.001% → -0.045% (n=11/11) | 5.8 | 0.4320 | 0.116% → -0.062% (n=1/10) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 3.9 | 0.7230 | 0.182 | 0.001% → -0.045% (n=11/11) | 7.3 | 0.3140 | 0.116% → -0.086% (n=1/9) | sim |
| OI médio 15m | tercis | 6.4 | 0.1690 | 0.233 | -0.018% → 0.020% (n=19/20) | 0.9 | 0.7380 | 0.027% → 0.069% (n=21/4) | sim |
| ΔOI médio 15m | tercis | 5.4 | 0.2670 | 0.214 | -0.006% → -0.012% (n=19/20) | 3.3 | 0.5610 | -0.018% → 0.091% (n=4/8) | não |
| book imbalance médio 15m | tercis | 4.8 | 0.3150 | 0.202 | -0.025% → -0.034% (n=19/20) | 5.4 | 0.2690 | 0.014% → 0.075% (n=5/6) | não |
| score médio 15m | tercis | 7.8 | 0.1130 | 0.257 | -0.002% → -0.037% (n=19/20) | 2.9 | 0.6180 | 0.063% → -0.039% (n=14/6) | sim |
| regime (agrupado) | regime agrupado | 4.4 | 0.1100 | 0.273 | -0.046% → 0.008% (n=38/21) | 1.6 | 0.5500 | 0.036% → 0.030% (n=17/8) | não |
| nº flow_change 15m | contagem (0/1/2+) | 1.6 | 0.4930 | 0.166 | -0.075% → 0.006% (n=24/35) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 2.4 | 0.3300 | 0.203 | -0.056% → 0.001% (n=29/30) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 5.2 | 0.2360 | 0.211 | -0.075% → 0.014% (n=27/31) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.2 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 59 | -0.046% | 0.008% (n=21<30) | -0.028% (n=19<30) | -0.016% (n=20<30) | -0.037% (n=20<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 25 | 0.036% (n=17<30) | 0.030% (n=8<30) | -0.012% (n=8<30) | 0.162% (n=8<30) | -0.040% (n=9<30) |

### 5.2 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**score médio 15m** (p-perm treino 0.1130, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 13 | 15 | 10 | 6 | 5 | 10 |
| ret. médio | 0.017% | -0.097% | -0.052% | -0.043% | 0.129% | -0.022% |

**OI médio 15m** (p-perm treino 0.1690, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 13 | 13 | 12 | 6 | 7 | 8 |
| ret. médio | 0.028% | -0.153% | -0.011% | -0.116% | 0.049% | 0.066% |

**nº divergence* 15m** (p-perm treino 0.2360, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 20 | 1 | 17 | 7 | 14 |
| ret. médio | -0.064% | 0.016% | -0.029% | -0.108% | 0.066% |

## 2. Horizonte 30 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.200% ≤ RANGE ≤ -0.004% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 26 | 9 (34.615%) | 10 (38.462%) | 7 (26.923%) |
| Teste | 12 | 6 (50.000%) | 5 (41.667%) | 1 (8.333%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.3 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 3.6 | 0.4960 | 0.263 | 0.202% → -0.114% (n=8/9) | 1.2 | 1.0000 | 0.477% → -0.020% (n=2/6) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 7.0 | 0.3400 | 0.366 | 0.518% → -0.153% (n=4/5) | 1.4 | 1.0000 | 0.004% → 0.097% (n=2/9) | não |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 7.0 | 0.3750 | 0.366 | 0.518% → -0.153% (n=4/5) | 1.4 | 1.0000 | 0.004% → 0.097% (n=2/9) | não |
| OI médio 15m | tercis | 1.1 | 0.8910 | 0.145 | -0.082% → 0.024% (n=8/9) | 1.1 | 1.0000 | 0.065% → 0.200% (n=11/1) | sim |
| ΔOI médio 15m | tercis | 5.2 | 0.3290 | 0.317 | 0.034% → 0.002% (n=8/9) | 3.4 | 0.3450 | -0.087% → -0.014% (n=1/1) | não |
| book imbalance médio 15m | tercis | 1.1 | 0.9250 | 0.145 | -0.055% → 0.105% (n=8/9) | 4.9 | 0.4410 | 0.441% → 0.063% (n=2/3) | não |
| score médio 15m | tercis | 6.4 | 0.1770 | 0.352 | 0.178% → -0.139% (n=8/9) | 4.2 | 0.2950 | 0.133% → 0.018% (n=6/5) | sim |
| regime (agrupado) | regime agrupado | 2.2 | 0.3450 | 0.292 | -0.127% → 0.210% (n=19/7) | 0.2 | 1.0000 | -0.004% → 0.477% (n=10/2) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 2.8 | 0.3210 | 0.326 | -0.180% → 0.069% (n=11/15) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 2.6 | 0.2610 | 0.316 | -0.122% → 0.063% (n=14/12) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 7.3 | 0.0920 | 0.376 | -0.168% → 0.103% (n=12/13) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.3 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 26 | -0.127% (n=19<30) | 0.210% (n=7<30) | -0.142% (n=8<30) | -0.102% (n=9<30) | 0.123% (n=9<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 12 | -0.004% (n=10<30) | 0.477% (n=2<30) | -0.029% (n=4<30) | 0.078% (n=4<30) | 0.179% (n=4<30) |

### 5.3 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.0920, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 9 | 1 | 9 | 3 | 4 |
| ret. médio | -0.166% | -0.271% | -0.072% | -0.173% | 0.497% |

**score médio 15m** (p-perm treino 0.1770, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 7 | 7 | 5 | 1 | 2 | 4 |
| ret. médio | 0.064% | -0.222% | -0.261% | 0.979% | 0.218% | 0.014% |

**nº absorption_* 15m** (p-perm treino 0.2610, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 12 | 7 | 2 | 5 |
| ret. médio | -0.101% | -0.172% | -0.244% | 0.392% |

## 6. Whale events — seção separada (não contamina a comparação histórica)

A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.

- eventos: 2063 | span: 12.1 min (2026-08-25T23:07:40.768Z → 2026-08-25T23:19:46.077Z)
- volume whale compra: $32567111 | venda: $26054084

- análise bloqueada por N insuficiente: precisamos de ≥ 90 janelas de 15m com whale data (≥ 22.5 h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).
- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).

## 7. Veredito (critério de sucesso da Fase 1)

Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?
Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = 0.00152.
Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.

- Horizonte 5 min (treino 191 / teste 78):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 15 min (treino 59 / teste 25):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 30 min (treino 26 / teste 12):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma

CONCLUSÃO: NENHUMA evidência fora da amostra encontrada até aqui. Hipótese central NÃO suportada pelos dados atuais.
Nota de poder estatístico: o maior teste tem apenas ~77 observações (N<90 p/ 30/classe) — a ausência de evidência não é prova de ausência de efeito; o experimento precisa de mais dados (especialmente pós-ativação do saveEvent) antes de qualquer conclusão forte.

