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
