# Testes futuros — após 5 dias de coleta com Factor 5

## O que eu faria agora

Não alteraria mais nada.

Deixaria o daemon rodando e depois compararia:

| Métrica | Baseline | Factor 5 |
|---|---|---|
| Mudanças de regime/h | 55,5 | ? |
| Duração média | 65s | ? |
| Reversões <30s | 68,3% | ? |
| Divergências válidas ≥60s | 7,7% | ? |
| Divergências <60s | 95% | ? |
| Taxa válida divergência | 7,7% | ? |
| Absorção | 73,4%* | ? |

\* Não tratar 73,4% como taxa preditiva. Atualmente significa apenas "atingiu ±0,05%".

## O principal critério para a próxima decisão

Eu não escolheria Factor 5 porque a taxa de acerto subir.

Primeiro verificaria se ele realmente reduziu o flapping:

- 55,5 mudanças de regime/h → quanto?
- 68,3% de reversões <30s → quanto?

Se o Factor 5 reduzir significativamente essas duas métricas, mas a divergência continuar com taxa válida próxima de 7,7%, então teremos descoberto algo importante:

> **o problema de estabilidade do regime e o problema de capacidade preditiva da divergência são problemas diferentes.**

Nesse caso, a Etapa 3 (histerese 3 → 5) passa a ser um teste lógico.

Se, por outro lado, o Factor 5 aumentar mudanças/reversões, devemos rejeitar essa alteração e voltar ao baseline.

## Minha recomendação neste momento

- Não faça nenhuma nova alteração de código.
- Deixe acumular alguns dias e execute:

```bash
node scripts/metricas-calibracao.mjs
```

- Depois compare com o baseline.

**O resultado que mais interessa ver:**

1. mudanças/h
2. reversões <30s
3. duração média
4. divergências ≥60s

Esses quatro números vão dizer se a Etapa 2 realmente melhorou o motor ou apenas mudou a aparência da taxa de acerto.

---

## Checkpoint intermediário — 24/08/2026 (22,7h de coleta com Factor 5)

**Decisão: NÃO alterar nada. Aguardar os 5 dias completos antes de julgar a Etapa 2.**

| Métrica | Baseline | Factor 5 (22,7h) | Δ |
|---|---|---|---|
| Mudanças de regime/h | 55,5 | 66,7 | 🔴 +11,2 |
| Duração média | 65s | 54s | 🔴 −11s |
| Reversões <10s | 35,4% | 32,8% | 🟢 −2,6pp |
| Reversões <30s | 68,3% | 66,0% | 🟢 −2,3pp |
| Divergências válidas ≥60s | 7,7% | 20,8% | 🟢 +13,1pp |
| Divergências <60s | 95% | 85,3% | 🟢 |
| Taxa válida divergência | 7,7% | 20,8% | 🟢 +13,1pp |
| Absorção ("atingiu ±0,05%") | 73,4%* | 84,4%* | 🟢 (NÃO é preditiva) |

\* Não tratar como taxa preditiva. Significa apenas "atingiu ±0,05%".

### Leitura intermediária (não conclusiva — aguardar 5 dias)

- **Divergência melhorou de verdade**: `valid_resolved ≥60s` saltou de 2 → 16 (8× mais acertos reais). Taxa válida 20,8% vs. 7,7% do baseline.
- **Flapping ainda alto**: mudanças/h SUBIU (55,5 → 66,7) e duração média caiu (65s → 54s), embora as % de reversões <10s/<30s tenham melhorado marginalmente.
- **Sinal de independência dos problemas** (como previsto): a divergência ganhou capacidade preditiva real enquanto o regime continua instável — reforça que a **Etapa 3 (histerese 3→5)** é o teste lógico seguinte, independentemente do destino do Factor 5.

### Próximo passo (aguardar ~5 dias de coleta, depois rodar)

```bash
node scripts/metricas-calibracao.mjs
```

Comparar com esta tabela. Critério de decisão mantido do documento acima: se o Factor 5 **aumentar** mudanças/reversões no total, rejeitar e voltar ao baseline (2.0); se **reduzir**, mantê-lo; e avaliar a Etapa 3 (histerese) como teste separado para o flapping.
