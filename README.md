# Preditivo

Painel técnico para leitura de criptoativos e ativos selecionados. O site público é publicado pelo GitHub Pages em `https://bitcoiniciantes.github.io/preditivo/`.

## O que o painel faz

- Consulta candles públicos da Binance para BTC, ETH, LINK, AVAX e PAXG.
- Atualiza dados de MSTR, SPCX, QBTS, Brent, prata, cobre e urânio por Yahoo Finance.
- Calcula MM20, MM50, RSI 14, volume relativo, ATR, compressão e nota de -100 a +100.
- Atualiza fatos relevantes por meio do Worker `bitcoiniciantes-ia`; a tela renova as notícias a cada cinco minutos.
- Envia alertas do Telegram conforme os sinais e preferências dos assinantes.

## Publicação e atualização

O workflow `.github/workflows/deploy-pages.yml` publica o site ao receber alterações na `main` e atualiza os dados de mercado em dias úteis, das 13h às 22h UTC, a cada 15 minutos.

Antes de uma publicação, ele executa:

```bash
npm test
npm run lint
npm run build
```

O workflow `.github/workflows/telegram-alerts.yml` verifica o mercado a cada cinco minutos. O disparo manual desse workflow envia uma mensagem de configuração a todos os assinantes ativos; não o use apenas para teste rotineiro.

## Desenvolvimento local

Requer Node.js 22.13 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Verificação antes de publicar

```bash
npm test
npm run lint
npm run build
```

A correção deve ser enviada para a branch `main`; o GitHub Pages publica automaticamente.

## Recuperação rápida

1. Confira os resultados em `Actions` no repositório `Bitcoiniciantes/preditivo`.
2. Se a publicação falhar, leia o log do workflow `Deploy GitHub Pages`; a validação falha antes de alterar o site público.
3. Se o Telegram parar, confira o workflow `Alertas Telegram` e se o segredo `TELEGRAM_BOT_TOKEN` continua presente nas configurações do repositório.
4. Se as notícias pararem, teste `https://bitcoiniciantes-ia.bitcoiniciantes.workers.dev/api/asset-news?asset=BTC`. O código do Worker está em `estudebitcoin/cloudflare/bitcoiniciantes-ia`.
5. Não publique chaves, tokens, arquivos `.env` ou credenciais no Git.

## Limites conhecidos

- SPCX ainda não tem histórico diário e semanal suficiente para cálculos de RSI de 55 candles; os alertas desse ativo usam 15 minutos, 1 hora e 4 horas.
- O estado dos alertas do Telegram é salvo em cache do GitHub Actions. O histórico permanente em Firebase só será gravado após configurar o segredo `FIREBASE_SERVICE_ACCOUNT_JSON` no repositório.
- Workflows agendados do GitHub podem ser desativados após 60 dias sem atividade no repositório. Um commit periódico ou a migração dessa agenda para outro serviço evita essa interrupção.