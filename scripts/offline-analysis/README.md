# Análise offline do `market.db` (retrospectiva, descritiva, manual)

Trilha independente do produto ao vivo. Tudo aqui é **offline, manual, somente leitura**.

## Regras

- Os scripts abrem o banco com `new DatabaseSync(dbPath, { readOnly: true })`.
- Nenhum script escreve no `market.db`, altera schema/parâmetros, ou roda em cron/scheduler.
- Nenhum resultado é conectado ao dashboard ou ao Indicador Único.
- Nada aqui é previsão, sinal ou recomendação. Não criar V2 a partir destes relatórios.

## Execução manual

```text
node scripts/offline-analysis/coverage-report.mjs [--db <path>] [--out <dir>]
node scripts/offline-analysis/regime-report.mjs [--db <path>] [--out <dir>]
node scripts/offline-analysis/whale-study.mjs --threshold <valor> [--db <path>] [--out <dir>] [--side all|buy|sell]
node scripts/offline-analysis/metric-redundancy.mjs [--db <path>] [--out <dir>]
```

- `--db` padrão: `services/market-ingestion/data/market.db`
- `--out` padrão: `reports/offline-analysis/`
- `--threshold` é **obrigatório** no `whale-study` (limiar mínimo de magnitude; nunca fixado no código).

## Saídas (`reports/offline-analysis/`)

- `coverage-report.md`, `coverage-daily.csv`, `coverage-gaps.csv`
- `regime-report.md`, `regime-episodes.csv`, `regime-transitions.csv`
- `whale-study-threshold-<valor>[-lado].md`, `whale-study-threshold-<valor>[-lado]-summary.csv`
- `metric-redundancy.md`, `correlations-level.csv`, `correlations-diff.csv`,
  `cooccurrence-{flow,regime,absorption,divergence}.csv`, `contradictions.csv`, `transitions.csv`

## Teste mínimo

```text
node --test tests/offline-analysis.test.mjs
node --test tests/metric-redundancy.test.mjs
```

Verifica: scripts iniciam, abrem o banco em somente leitura, consultas funcionam
contra um `market.db` sintético temporário, relatórios são gerados com valores
coerentes, `whale-study` exige/aceita `--threshold`, e o arquivo do banco não é
modificado.
