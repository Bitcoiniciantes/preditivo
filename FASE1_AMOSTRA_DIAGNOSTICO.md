# FASE 1 — DIAGNÓSTICO DO FLUXO DE AMOSTRA (gerado por scripts/fase1-amostra-diagnostico.mjs)

Gerado em: 2026-08-26T00:41:59.023Z

Fluxo: **N bruto** (snapshots) → excluídos por **stride** → **candidatos** → excluídos por **janela** (gap/curta) → excluídos por **outcome** (segmento/sem snapshot/tolerância) → **N elegível** → excluídos pelo **split** (purging/embargo) → **treino + OOS**.

| Horizonte | N bruto | stride | candidatos | janela gap | janela curta | outcome segmento | outcome sem snap | outcome tol. | **N elegível** | treino | **OOS** | excluídos split |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 min | 1595 | 1105 | 490 | 54 | 127 | 17 | 1 | 0 | **291** | 203 | **82** | 6 |
| 15 min | 1595 | 1223 | 372 | 54 | 127 | 98 | 1 | 0 | **92** | 63 | **27** | 2 |
| 30 min | 1595 | 1163 | 432 | 54 | 127 | 193 | 16 | 0 | **42** | 28 | **13** | 1 |

Verificações aritméticas (devem ser verdadeiras):
- 5 min: bruto = stride+candidatos (OK) · candidatos = rejeições+elegíveis (OK) · elegíveis = treino+OOS+excluídos (OK)
- 15 min: bruto = stride+candidatos (OK) · candidatos = rejeições+elegíveis (OK) · elegíveis = treino+OOS+excluídos (OK)
- 30 min: bruto = stride+candidatos (OK) · candidatos = rejeições+elegíveis (OK) · elegíveis = treino+OOS+excluídos (OK)

Detalhe dos excluídos do split (faixa do meio — por construção satisfazem os dois critérios):

| Horizonte | fronteira B (UTC) | excluídos split | todos cruzam a fronteira (t+h > B)? | todos no embargo (B ≤ t < B+H_MAX)? |
|---|---:|---:|---|---|
| 5 min | 2026-08-24T21:55:57.536Z | 6 | sim | sim |
| 15 min | 2026-08-24T21:32:57.372Z | 2 | sim | sim |
| 30 min | 2026-08-24T21:17:57.224Z | 1 | sim | sim |

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
