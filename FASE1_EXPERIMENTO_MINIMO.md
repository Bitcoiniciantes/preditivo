# FASE 1 — EXPERIMENTO MÍNIMO (relatório gerado por scripts/fase1-experimento-minimo.mjs)

Fonte: `C:\Users\joelh\Site Bitcoiniciantes\BACKUP\preditivo\services\market-ingestion\data\market.db`
Gerado em: 2026-08-26T11:53:01.763Z

## 0. Qualidade dos dados utilizados

- snapshots: 2157 (span 87.5h; cadência ~1/min quando online; uptime efetivo ≈ 36.0h em 22 segmentos)
- gaps > 3 min: 21 | maior: 988.0 min
- resets de CVD detectados (>50% em 1 passo): 86 → features de CVD usam Δ intra-janela; janelas com reset ficam NA
- regime_events: 12311 | whale events (events): 114628 (persistência ativada 2026-08-25T23:07:40.768Z — seção separada, §6)
- N de testes do experimento: 33 (11 features × 3 horizontes) → Bonferroni α = 0.00152
- funding_rate está disponível nos snapshots mas está FORA do escopo definido para a Fase 1 — não incluído como feature.
- amostragem: âncoras em timestamps de snapshot com stride = horizonte (janelas de outcome sem sobreposição); janela de features [t-15m, t] íntegra (≥ 10 snaps, sem gap > 3 min); outcome = snapshot mais próximo de t+H (tolerância ±2.5 min) no mesmo segmento.

## 1. Observações por horizonte (janela 15m íntegra + outcome disponível, stride = horizonte)

| Horizonte | Observações | Treino (pós purging) | Teste (pós embargo) | Tercis do treino (DOWN/RANGE/UP) |
|---|---|---|---|---|
| 5 min | 419 | 292 | 121 | < -0.045% / ≤ 0.036% / > |
| | | | | fronteira: 2026-08-26T00:46:39.395Z |
| 15 min | 136 | 94 | 40 | < -0.096% / ≤ 0.062% / > |
| | | | | fronteira: 2026-08-26T01:11:39.522Z |
| 30 min | 64 | 44 | 19 | < -0.173% / ≤ 0.030% / > |
| | | | | fronteira: 2026-08-26T01:25:39.599Z |

## 2. Horizonte 5 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.045% ≤ RANGE ≤ 0.036% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 292 | 98 (33.562%) | 98 (33.562%) | 96 (32.877%) |
| Teste | 121 | 33 (27.273%) | 53 (43.802%) | 35 (28.926%) |


### 3.1 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 2.1 | 0.7410 | 0.060 | 0.006% → 0.015% (n=97/98) | 4.9 | 0.2910 | 0.001% → -0.003% (n=24/30) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 7.0 | 0.3230 | 0.109 | -0.003% → -0.005% (n=65/65) | 9.9 | 0.1260 | 0.001% → -0.027% (n=41/19) | sim |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 7.5 | 0.2850 | 0.113 | 0.002% → -0.006% (n=65/65) | 13.5 | 0.0380 | 0.001% → -0.046% (n=41/19) | sim |
| OI médio 15m | tercis | 14.0 | 0.0120⚠ | 0.155 | -0.009% → 0.018% (n=97/98) | 2.0 | 0.3920 | -0.010% → 0.030% (n=106/15) | sim |
| ΔOI médio 15m | tercis | 2.1 | 0.7250 | 0.061 | 0.030% → 0.012% (n=97/98) | 4.8 | 0.3180 | -0.015% → 0.001% (n=43/33) | não |
| book imbalance médio 15m | tercis | 2.7 | 0.6020 | 0.068 | 0.009% → 0.003% (n=97/98) | 1.4 | 0.8440 | -0.002% → -0.012% (n=36/52) | sim |
| score médio 15m | tercis | 5.3 | 0.2540 | 0.095 | 0.005% → 0.010% (n=98/98) | 10.1 | 0.0410 | 0.009% → -0.023% (n=62/26) | não |
| regime (agrupado) | regime agrupado | 8.5 | 0.0060⚠ | 0.171 | 0.001% → 0.018% (n=204/88) | 3.3 | 0.2310 | -0.013% → 0.018% (n=91/30) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 6.7 | 0.0320⚠ | 0.151 | -0.015% → 0.014% (n=78/214) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 8.5 | 0.0180⚠ | 0.171 | -0.014% → 0.015% (n=93/199) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 5.4 | 0.2180 | 0.096 | -0.004% → 0.010% (n=88/202) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.1 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 292 | 0.001% | 0.018% | -0.022% | -0.001% | 0.041% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 121 | -0.013% | 0.018% | -0.007% | 0.000% | -0.008% |

### 5.1 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**OI médio 15m** (p-perm treino 0.0120, bins: tercis)

| Estrato | lat|0 | lat|1 | lat|2 | trend|0 | trend|1 | trend|2 |
| --- | --- | --- | --- | --- | --- | --- |
| N | 78 | 66 | 60 | 19 | 31 | 38 |
| ret. médio | 0.000% | -0.009% | 0.012% | -0.049% | 0.049% | 0.027% |

**nº absorption_* 15m** (p-perm treino 0.0180, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 79 | 125 | 14 | 74 |
| ret. médio | -0.008% | 0.006% | -0.047% | 0.031% |

**nº flow_change 15m** (p-perm treino 0.0320, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 68 | 136 | 10 | 78 |
| ret. médio | -0.010% | 0.006% | -0.050% | 0.027% |

## 2. Horizonte 15 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.096% ≤ RANGE ≤ 0.062% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 94 | 32 (34.043%) | 32 (34.043%) | 30 (31.915%) |
| Teste | 40 | 8 (20.000%) | 20 (50.000%) | 12 (30.000%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.2 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 3.1 | 0.5660 | 0.129 | 0.021% → -0.013% (n=31/32) | 2.5 | 0.6580 | 0.033% → -0.002% (n=6/11) | sim |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 3.1 | 0.8190 | 0.128 | 0.012% → -0.025% (n=21/21) | 4.2 | 0.7060 | -0.036% → 0.038% (n=10/5) | não |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 1.1 | 0.9850 | 0.077 | -0.001% → -0.008% (n=21/21) | 4.3 | 0.6740 | -0.042% → 0.038% (n=11/5) | não |
| OI médio 15m | tercis | 5.1 | 0.3100 | 0.164 | -0.036% → 0.051% (n=31/32) | 0.1 | 1.0000 | -0.012% → 0.087% (n=36/4) | sim |
| ΔOI médio 15m | tercis | 0.9 | 0.9440 | 0.068 | -0.017% → 0.016% (n=31/32) | 2.4 | 0.6880 | -0.027% → 0.000% (n=18/11) | sim |
| book imbalance médio 15m | tercis | 4.4 | 0.3630 | 0.153 | -0.019% → -0.033% (n=31/32) | 1.1 | 0.8970 | -0.014% → -0.006% (n=12/21) | não |
| score médio 15m | tercis | 0.7 | 0.9410 | 0.060 | 0.024% → -0.039% (n=31/32) | 3.7 | 0.4600 | 0.022% → -0.034% (n=18/8) | sim |
| regime (agrupado) | regime agrupado | 2.5 | 0.2900 | 0.164 | -0.015% → 0.028% (n=62/32) | 0.6 | 0.7710 | -0.005% → 0.007% (n=31/9) | sim |
| nº flow_change 15m | contagem (0/1/2+) | 4.9 | 0.1100 | 0.227 | -0.075% → 0.025% (n=24/70) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 3.5 | 0.1930 | 0.193 | -0.056% → 0.025% (n=29/65) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 8.8 | 0.0400⚠ | 0.216 | -0.075% → 0.030% (n=27/66) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.2 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 94 | -0.015% | 0.028% | -0.005% | 0.027% | -0.022% |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 40 | -0.005% | 0.007% (n=9<30) | -0.015% (n=13<30) | 0.051% (n=13<30) | -0.040% (n=14<30) |

### 5.2 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.0400, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 20 | 1 | 41 | 7 | 25 |
| ret. médio | -0.064% | 0.016% | 0.008% | -0.108% | 0.066% |

**nº flow_change 15m** (p-perm treino 0.1100, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 19 | 43 | 5 | 27 |
| ret. médio | -0.058% | 0.004% | -0.137% | 0.058% |

**nº absorption_* 15m** (p-perm treino 0.1930, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 23 | 39 | 6 | 26 |
| ret. médio | -0.040% | 0.000% | -0.116% | 0.061% |

## 2. Horizonte 30 min — classes (tercis do retorno à frente; fronteiras SÓ do treino)

Fronteiras: DOWN < -0.173% ≤ RANGE ≤ 0.030% < UP

| Conjunto | N | UP | RANGE | DOWN |
|---|---|---|---|---|
| Treino | 44 | 15 (34.091%) | 16 (36.364%) | 13 (29.545%) |
| Teste | 19 | 6 (31.579%) | 10 (52.632%) | 3 (15.789%) |

> Teste com N < 90 → probabilidades por classe no teste NÃO exibidas (regra N≥30).

### 3.3 Associação feature × classe — TREINO (χ² por permutação) e replicação no TESTE

| Feature | Bins | Treino χ² | p-perm | Cramér V | Lift treino (alto−baixo) | Teste χ² | p-perm | Lift teste | Sinal igual? |
|---|---|---|---|---|---|---|---|---|---|
| retorno 15m (feature) | tercis | 1.4 | 0.8940 | 0.124 | 0.155% → -0.012% (n=14/15) | 4.4 | 0.4010 | 0.039% → 0.103% (n=4/3) | não |
| ΔCVD 15m | tercis (NA = reset CVD na janela) | 1.2 | 0.9890 | 0.115 | 0.152% → 0.013% (n=9/9) | 6.1 | 0.4480 | -0.046% → -0.021% (n=7/3) | não |
| ΔCVD large 15m | tercis (NA = reset CVD na janela) | 1.2 | 0.9860 | 0.115 | 0.157% → 0.013% (n=9/9) | 4.6 | 0.6920 | -0.037% → -0.021% (n=6/3) | não |
| OI médio 15m | tercis | 7.0 | 0.1530 | 0.282 | -0.095% → 0.028% (n=14/15) | 0.6 | 1.0000 | -0.040% → 0.103% (n=17/2) | sim |
| ΔOI médio 15m | tercis | 8.6 | 0.0670 | 0.313 | -0.034% → -0.001% (n=14/15) | 3.0 | 0.7250 | -0.021% → 0.038% (n=6/7) | sim |
| book imbalance médio 15m | tercis | 0.6 | 0.9480 | 0.085 | -0.015% → 0.068% (n=14/15) | 4.4 | 0.3920 | 0.056% → -0.035% (n=3/13) | não |
| score médio 15m | tercis | 3.7 | 0.4460 | 0.204 | 0.191% → -0.090% (n=14/15) | 4.1 | 0.4590 | -0.026% → -0.090% (n=8/4) | sim |
| regime (agrupado) | regime agrupado | 2.8 | 0.2490 | 0.251 | -0.067% → 0.217% (n=33/11) | 1.4 | 0.6590 | -0.013% → -0.046% (n=12/7) | não |
| nº flow_change 15m | contagem (0/1/2+) | 5.8 | 0.0420⚠ | 0.363 | -0.180% → 0.066% (n=11/33) | 0.0 | 1.0000 | — | não |
| nº absorption_* 15m | contagem (0/1/2+) | 5.3 | 0.0640 | 0.346 | -0.122% → 0.063% (n=14/30) | 0.0 | 1.0000 | — | não |
| nº divergence* 15m | contagem (0/1/2+) | 8.7 | 0.0330⚠ | 0.315 | -0.168% → 0.079% (n=12/31) | 0.0 | 1.0000 | — | não |

> ★ = p < 0.00152 (Bonferroni). ⚠ = p < 0.05 sem sobreviver Bonferroni. p-perm = permutação de rótulos (999 iterações, seed fixo).

### 4.3 Treino vs teste por regime e volatilidade — retorno à frente médio (%)

| Treino | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Treino | 44 | -0.067% | 0.217% (n=11<30) | -0.071% (n=14<30) | 0.008% (n=15<30) | 0.069% (n=15<30) |

| Teste | N | lateral | trending | vol baixa | vol média | vol alta |
|---|---|---|---|---|---|---|
| Teste | 19 | -0.013% (n=12<30) | -0.046% (n=7<30) | 0.072% (n=6<30) | -0.070% (n=6<30) | -0.069% (n=7<30) |

### 5.3 Top-3 features por sinal no treino — retorno à frente médio por regime×bin (treino)

**nº divergence* 15m** (p-perm treino 0.0330, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|1 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- | --- |
| N | 9 | 1 | 23 | 3 | 8 |
| ret. médio | -0.166% | -0.271% | -0.019% | -0.173% | 0.363% |

**nº flow_change 15m** (p-perm treino 0.0420, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 9 | 24 | 2 | 9 |
| ret. médio | -0.166% | -0.030% | -0.244% | 0.319% |

**nº absorption_* 15m** (p-perm treino 0.0640, bins: contagem (0/1/2+))

| Estrato | lat|0 | lat|2+ | trend|0 | trend|2+ |
| --- | --- | --- | --- | --- |
| N | 12 | 21 | 2 | 9 |
| ret. médio | -0.101% | -0.047% | -0.244% | 0.319% |

## 6. Whale events — seção separada (não contamina a comparação histórica)

A persistência de whale events foi ativada em 2026-08-25T23:07Z (schema v2, commit 1bf6425). O histórico anterior NÃO possui whale events — tratados como ausentes, nunca como zero.

- eventos: 114628 | span: 765.3 min (2026-08-25T23:07:40.768Z → 2026-08-26T11:52:58.659Z)
- volume whale compra: $1628856947 | venda: $1745813664

- análise bloqueada por N insuficiente: precisamos de ≥ 90 janelas de 15m com whale data (≥ 22.5 h de uptime pós-ativação para o horizonte de 15 min com stride 15 min).
- enquanto isso, whale features ficam EXCLUÍDAS do experimento principal (evita contaminação).

## 7. Veredito (critério de sucesso da Fase 1)

Critério: existe evidência estatística FORA da amostra de que as features carregam informação sobre o outcome futuro?
Regra conservadora por feature: (a) p-perm < 0.05 no treino E (b) p-perm < 0.05 no teste E (c) lift com o mesmo sinal em treino e teste. (d) Bonferroni sobre as 33 comparações: α = 0.00152.
Observação metodológica: p-valor e N não são "confidence" — nenhuma estimativa de qualidade subjetiva é atribuída aos resultados.

- Horizonte 5 min (treino 292 / teste 121):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 15 min (treino 94 / teste 40):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma
- Horizonte 30 min (treino 44 / teste 19):
   - sobrevivem Bonferroni no treino: nenhuma
   - evidência fora da amostra (a+b+c): nenhuma

CONCLUSÃO: NENHUMA evidência fora da amostra encontrada até aqui. Hipótese central NÃO suportada pelos dados atuais.
Nota de poder estatístico: o maior teste tem apenas ~77 observações (N<90 p/ 30/classe) — a ausência de evidência não é prova de ausência de efeito; o experimento precisa de mais dados (especialmente pós-ativação do saveEvent) antes de qualquer conclusão forte.

