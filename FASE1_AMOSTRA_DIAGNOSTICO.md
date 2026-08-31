# FASE 1 — DIAGNÓSTICO DO FLUXO DE AMOSTRA (gerado por scripts/fase1-amostra-diagnostico.mjs)

Gerado em: 2026-08-31T23:55:57.105Z

Fluxo: **N bruto** (snapshots) → excluídos por **stride** → **candidatos** → excluídos por **janela** (gap/curta) → excluídos por **outcome** (segmento/sem snapshot/tolerância) → **N elegível** → excluídos pelo **split** (purging/embargo) → **treino + OOS**.

| Horizonte | N bruto | stride | candidatos | janela gap | janela curta | outcome segmento | outcome sem snap | outcome tol. | **N elegível** | treino | **OOS** | excluídos split |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 min | 8775 | 6690 | 2085 | 78 | 186 | 24 | 0 | 0 | **1797** | 1257 | **534** | 6 |
| 15 min | 8775 | 7776 | 999 | 78 | 182 | 130 | 12 | 0 | **597** | 417 | **178** | 2 |
| 30 min | 8775 | 7918 | 857 | 78 | 182 | 303 | 1 | 0 | **293** | 204 | **88** | 1 |

Verificações aritméticas (devem ser verdadeiras):
- 5 min: bruto = stride+candidatos (OK) · candidatos = rejeições+elegíveis (OK) · elegíveis = treino+OOS+excluídos (OK)
- 15 min: bruto = stride+candidatos (OK) · candidatos = rejeições+elegíveis (OK) · elegíveis = treino+OOS+excluídos (OK)
- 30 min: bruto = stride+candidatos (OK) · candidatos = rejeições+elegíveis (OK) · elegíveis = treino+OOS+excluídos (OK)

Detalhe dos excluídos do split (faixa do meio — por construção satisfazem os dois critérios):

| Horizonte | fronteira B (UTC) | excluídos split | todos cruzam a fronteira (t+h > B)? | todos no embargo (B ≤ t < B+H_MAX)? |
|---|---:|---:|---|---|
| 5 min | 2026-08-29T20:40:25.652Z | 6 | sim | sim |
| 15 min | 2026-08-29T20:39:25.640Z | 2 | sim | sim |
| 30 min | 2026-08-29T21:24:25.954Z | 1 | sim | sim |

Definições:
- **N bruto**: total de snapshots no SQLite (base única para todos os horizontes).
- **stride**: âncoras descartadas por estarem a menos de h min da âncora aceita anterior (janelas de outcome sem sobreposição).
- **janela gap**: janela [t-15m, t] cruza um gap > 3 min (daemon offline) — janela rejeitada.
- **janela curta**: janela com < 10 snapshots.
- **outcome segmento**: sem snapshot de outcome porque o segmento quebrou (gap) antes de t+h.
- **outcome sem snap**: sem snapshot dentro de ±2.5 min de t+h.
- **outcome tol.**: snapshot encontrado, mas fora da tolerância de ±2.5 min.
- **N elegível**: observações que entram no experimento (== "Observações" do relatório da Fase 1).
- **treino**: elegíveis com t+h ≤ B (purging).
- **OOS**: elegíveis com t ≥ B + 30 min (embargo = maior horizonte).
- **excluídos split**: elegíveis que não são nem treino nem OOS (outcome cruza a fronteira e/ou caem no embargo).
