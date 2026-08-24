# Avaliação de Coerência — `GlobalAlertContext.tsx`

**Metodologia:** o código foi lido linha a linha de forma independente. A revisão anterior (documento 2) foi usada como ponto de partida, mas cada afirmação dela foi checada contra o código real — algumas se confirmam, uma está **factualmente errada**, e um bug adicional (não citado antes) foi encontrado.

---

## Veredito geral

O planejamento arquitetural está sólido (separação Config/State, `frozenUntil` como fonte temporal, motor sem `alertStates` nas dependências, crossover direcional). Mas **a Fase 1 não está pronta para implementação final** — há inconsistências reais entre a intenção documentada ("derivado", "autoridade única", "card some mas fica no histórico") e o que o código de fato faz.

---

## 1. Bugs confirmados (verificados no código)

### 🔴 1.1 `acknowledgeAlert` redispara o mesmo evento
```ts
const acknowledgeAlert = useCallback((symbol) => {
  setAlertStates(...);           // só grava acknowledgedAt
  setAlertEvents(prev => prev.filter(e => e.symbol !== symbol)); // remove o evento
}, []);
```
`triggered` e `triggeredAt` **não são resetados**. O efeito de dispatch (`3b`) decide se deve criar um novo evento comparando `triggeredAt` com o último evento em `alertEvents`:
```ts
const lastEvent = alertEvents.find(e => e.symbol === symbol);
if (lastEvent && lastEvent.timestamp === state.triggeredAt) continue;
```
Como `acknowledgeAlert` acabou de apagar esse evento, `lastEvent` vira `undefined` → a condição de skip falha → o efeito **recria o mesmo evento imediatamente**. Reconhecer o alerta, na prática, faz ele reaparecer.

**Correção:** `acknowledgeAlert` precisa também resetar `triggered: false` (ou o dispatch precisa usar `acknowledgedAt` como terceiro critério de skip, não só a presença em `alertEvents`).

### 🔴 1.2 `frozen` não é derivado — é armazenado em paralelo a `frozenUntil`
O comentário no código diz `// derivado` em várias linhas, mas na prática:
```ts
frozen: true,   // gravado explicitamente
...
frozen: false,  // gravado explicitamente
```
Isso é exatamente a duplicação de estado que a "regra de ouro" do documento (`frozenUntil` como autoridade única) queria evitar. Hoje existem dois lugares que podem divergir (ex.: se algum código futuro atualizar `frozenUntil` sem atualizar `frozen`, ou vice-versa).

**Correção:** remover o campo `frozen` do `AlertState` e calculá-lo sob demanda onde for exibido:
```ts
const isFrozen = state.frozenUntil !== null && Date.now() < state.frozenUntil;
```

### 🔴 1.3 `alertEvents` mistura "eventos ativos" com "histórico"
O mesmo array serve para os dois propósitos:
- Fila de cards ativos (usada pelo Renderer)
- Histórico persistido (`.slice(0, 50)` salvo em `localStorage`)

Como `acknowledgeAlert` e `removeAlert` fazem `filter()` removendo o item **do array inteiro**, o evento desaparece também do histórico — contradizendo a regra "card desaparece da tela, mas continua no histórico".

**Correção:** separar em dois estados: `activeAlertEvents` (fila de cards, pode remover) e `alertHistory` (append-only, nunca removido por acknowledge).

### 🟡 1.4 Status do WebSocket não é modelado
`GlobalAlertProvider` só recebe `livePrices`. Não há um `status: "live" | "reconnecting" | "disconnected"`. Funciona por "ausência de atualização" (o motor só roda quando `livePrices` muda), mas isso é implícito, não a especificação formal descrita no planejamento. Não bloqueia a Fase 1, mas deveria ser adicionado explicitamente se o comportamento de pausa precisa ser auditável/testável.

---

## 2. Correção a um ponto da revisão anterior (documento 2 errou aqui)

### ✅ Ponto 5 do doc anterior ("persistência duplicada do histórico") — **não procede como descrito**
O documento afirma que existe um `useEffect` dedicado a persistir `alertEvents` **e** também uma gravação direta dentro do `setAlertEvents`. Isso é **incorreto**: no bloco "4. Persistir configs e states" só existem dois efeitos, para `alertConfigs` e `alertStates` — **não há nenhum `useEffect` separado para `alertEvents`/histórico**:
```ts
useEffect(() => { localStorage.setItem(STORAGE_KEYS.config, ...) }, [alertConfigs]);
useEffect(() => { localStorage.setItem(STORAGE_KEYS.state, ...) }, [alertStates]);
// não existe um terceiro useEffect para alertEvents
```
A única gravação em `STORAGE_KEYS.history` acontece dentro do `setAlertEvents` no efeito `3b`.

**Só que isso revela um bug real, diferente do apontado:** como só existe esse único ponto de persistência, `removeAlert` e `acknowledgeAlert` chamam `setAlertEvents(prev => prev.filter(...))` **sem nunca gravar o resultado filtrado no `localStorage`**. Ou seja, o histórico salvo em disco pode ficar **dessincronizado** do estado em memória (um evento removido em memória continua no `localStorage` até o próximo disparo). Isso é o problema real de persistência a corrigir — não duplicação, e sim ausência de sincronização em alguns caminhos.

---

## 3. Ponto que precisa de nuance (não é tão grave quanto parece)

### 🟡 Crossover falso ao expirar o `frozenUntil`
O código, ao detectar expiração, atualiza `nextStates[symbol]` mas **não dá `continue`**, deixando o fluxo cair em `const previousPrice = state.lastPrice`. Como `state` é a referência capturada no início da iteração (antes da sobrescrita), `previousPrice` é o `lastPrice` salvo no ciclo anterior — que, **enquanto congelado, já vinha sendo atualizado a cada tick** (branch "ainda congelado → atualizar lastPrice"). Ou seja, na maioria dos casos `previousPrice` já reflete o preço do tick imediatamente anterior, não o preço do disparo original — o exemplo do documento anterior (`28.600 → 28.300`) não reproduz fielmente o comportamento normal.

**Porém existe um cenário real de risco:** se `livePrices` não mudar durante todo o congelamento (WS lento, símbolo pouco líquido, reconexão demorada), o efeito inteiro não roda (está nas dependências `[livePrices, alertConfigs]`), então `lastPrice` fica **parado no valor de quando o congelamento começou**. Quando o preço finalmente atualizar após a expiração, a comparação pode usar um `previousPrice` desatualizado por até 1 hora, criando um crossover "fantasma".

**Correção recomendada (mais simples que reescrever a lógica de comparação):** ao expirar, resetar `lastPrice` e sair do ciclo sem detectar neste tick:
```ts
} else {
  nextStates[symbol] = {
    ...state,
    lastPrice: currentPrice,
    frozen: false,
    frozenUntil: null,
    triggered: false,
    triggeredType: null,
    triggeredLevel: null,
    triggeredAt: null,
  };
  changed = true;
  continue; // <-- não detectar neste mesmo tick
}
```

---

## 4. Não são problemas (decisões de design válidas)

| Item | Avaliação |
|---|---|
| `lastPrice` atualizado durante o congelamento | Correto e intencional — evita comparar contra o preço do disparo original ao descongelar |
| Empilhamento de múltiplos eventos / limite de 3 cards | Pertence à Fase 2; o contrato `AlertEvent[]` já é suficiente para não travar a Fase 1 |
| Uso de `alertConfigsRef` + `alertConfigs` nas deps ao mesmo tempo | Padrão válido: a dependência dispara o efeito quando configs mudam; o ref evita fechamento (closure) desatualizado dentro do `setAlertStates` funcional |

---

## 5. Tabela resumo

| Área | Status | Origem da verificação |
|---|---|---|
| Arquitetura geral (Config/State/Events) | ✅ Correta | Confirmado no código |
| Motor sem `alertStates` nas deps | ✅ Correto | Confirmado no código |
| Crossover direcional (suporte/resistência) | ✅ Correto | Confirmado no código |
| `acknowledgeAlert` redispara evento | 🔴 Bug real | Confirmado, mecanismo exato mapeado |
| `frozen` duplicado vs `frozenUntil` | 🔴 Bug real | Confirmado |
| Eventos ativos = histórico (mesmo array) | 🔴 Bug real | Confirmado |
| "useEffect duplicado" de persistência do histórico | ❌ Não existe tal duplicação | Documento anterior estava incorreto |
| Falta de persistência ao remover/reconhecer evento | 🔴 Bug real (não citado antes) | Encontrado nesta revisão |
| Crossover falso pós-expiração do freeze | 🟡 Risco real, mas só em cenário de WS parado | Nuance adicionada nesta revisão |
| Status do WebSocket não modelado | 🟡 Gap de especificação, não bloqueante | Confirmado |
| Empilhamento de múltiplos eventos | ⏳ Fase 2 | Confirmado |

---

## 6. Ordem recomendada de correção antes de fechar a Fase 1

1. Resetar `triggered`/`triggeredAt` em `acknowledgeAlert` (bug de redisparo — maior risco, quebra a UX principal)
2. Separar `activeAlertEvents` de `alertHistory`, e persistir a versão filtrada em `remove`/`acknowledge`
3. Remover o campo `frozen` do estado; calcular via `frozenUntil` onde for exibido
4. Adicionar `continue` após a expiração do freeze para não detectar no mesmo tick
5. (Opcional para Fase 1, recomendado antes da Fase 3) formalizar `livePriceStatus` no provider
