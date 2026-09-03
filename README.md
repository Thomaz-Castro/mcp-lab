# MCP Lab

Laboratório para **aprender o Model Context Protocol (MCP) vendo o protocolo acontecer**.
Um Host com cliente MCP, um servidor MCP na frente de um "sistema legado", e um micro site
que desenha cada mensagem JSON-RPC como uma seta num diagrama de sequência. Tudo local:
Node + Ollama, sem nenhuma API paga.

![MCP Lab: diagrama de sequência ao vivo com inspetor de JSON-RPC](docs/screenshot.jpg)

```
 🧑 Você ──► 🖥️ Host + Cliente MCP ──(JSON-RPC por stdio)──► 🧰 Servidor MCP ──► 📦 Sistema legado
                │                                                  │              (sem IA, sem MCP)
                └─► 🧠 Ollama A (decide qual tool chamar)            └─► 🧠 Ollama B (só numa tool)
             Sistema A · src/host                               Sistema B · src/server · src/legado
```

## A ideia em três linhas

1. O servidor MCP publica um **catálogo de tools** (nome, descrição, schema dos argumentos) e executa `tools/call`.
2. A IA **não executa nada**. Ela só escreve um JSON `{name, arguments}` escolhendo uma tool do catálogo.
3. O Host copia esse JSON para um `tools/call`, o SDK acha a tool pelo nome, valida os argumentos e chama o **seu método**.

Por isso qualquer sistema pode ganhar um MCP com um adaptador de poucas linhas, sem rodar IA dentro dele.

## Pré-requisitos

- Node 22 ou mais novo.
- [Ollama](https://ollama.com) rodando em `http://localhost:11434` com dois modelos que suportem tool calling:

```bash
ollama pull qwen2.5:7b-instruct   # Ollama A, o "cérebro" do host
ollama pull llama3.1:8b           # Ollama B, usado só pela tool consultar_especialista
```

Os dois modelos somam uns 10 GB em disco e o Ollama alterna entre eles na memória. Para usar um só, exporte `OLLAMA_MODEL_B` com o mesmo nome do `OLLAMA_MODEL`.

## Rodando

```bash
npm install
npm run dev        # abre http://localhost:4321
```

### No site

| Controle | O que faz |
|---|---|
| **Conectar ao servidor MCP** | O Host sobe o servidor como processo filho. Você vê o handshake (`initialize` → `initialized`) e a descoberta (`tools/list`, `resources/list`, `prompts/list`) ao vivo. |
| **Modo manual** | Você faz o papel da IA: escolhe a tool, preenche os argumentos (campos gerados do `inputSchema`) e manda o `tools/call`. Nenhum modelo envolvido. **Comece por aqui** para entender a arquitetura sem depender do modelo. |
| Caixa de pergunta | Modo com IA. O Host manda sua pergunta ao Ollama A junto com o catálogo de tools; se ele pedir uma tool, vira `tools/call`. |
| **Passo a passo** | Segura cada mensagem e libera uma por vez (botão Próximo ou seta → do teclado). |
| **Ler resource notas://todas** | O Host lê um resource sem passar pelo modelo. Mostra que resources são decisão do app. |
| **Nova conversa** | Zera o histórico que o Ollama A recebe. |
| Clique em qualquer seta | O inspetor mostra o JSON bruto, qual dos três formatos JSON-RPC é (request, response, notification) e uma explicação em português. |

### O que observar

- **Setas amarelas e roxas** são MCP (JSON-RPC por stdio). **Cianas e azuis** são HTTP para o Ollama e não fazem parte do MCP.
- Depois de um `tools/call` que bate no sistema legado aparece uma caixinha cinza `stderr: [SistemaDePedidos] criar(...) executado`. É o `console.error` de dentro do método. Prova de que a IA chegou lá.
- Se a resposta final vier marcada com **⚠ sem tool**, o modelo respondeu em texto sem chamar nada. Se ele afirma que criou ou salvou algo, é invenção: não há seta amarela nem `stderr`. O diagrama existe para pegar isso no flagra. Use **Nova conversa** e repita.

### Outros modos

| Comando | O que faz |
|---|---|
| `npm run cli` | Mesmo lab no terminal. `VERBOSE=1 npm run cli` imprime o JSON de cada mensagem. |
| `npm run server` | Só o servidor, lendo JSON-RPC no stdin. Cole um `initialize` na mão (roteiro em `docs/anotacoes.md`). |
| `npm run inspector` | MCP Inspector oficial apontando para este servidor. |
| `npm run typecheck` | `tsc --noEmit`. |
| `OLLAMA_MODEL=… OLLAMA_MODEL_B=… npm run dev` | Troca os modelos. `OLLAMA_HOST` troca o endereço do Ollama. `PORT` troca a porta do site. |

## O que o servidor expõe

| Tool | O que chama |
|---|---|
| `pedidos_listar`, `pedidos_criar`, `pedidos_atualizar_status` | Métodos de `SistemaDePedidos` em `src/legado/pedidos.ts`, via `src/server/adaptador-pedidos.ts`. É o caso real: um sistema que já existia ganhando uma porta MCP. |
| `calcular`, `hora_atual`, `salvar_nota`, `listar_notas` | Código puro dentro do servidor. |
| `consultar_especialista` | Chama o Ollama B. Mostra que do outro lado de um `tools/call` pode haver qualquer coisa, inclusive outra IA. O Host não sabe disso. |

Também há 2 resources (`notas://todas` e o template `nota://{id}`), 1 prompt (`resumir_notas`) e logging via `notifications/message`.

## Colocando MCP num sistema que já existe

Olhe `src/legado/pedidos.ts` (uma classe comum) e `src/server/adaptador-pedidos.ts` (o adaptador). A receita:

```ts
server.registerTool('pedidos_criar', {
  description: 'Cria um pedido novo para um cliente com uma lista de itens.', // a IA lê isto
  inputSchema: { cliente: z.string().min(1), itens: z.array(z.string()).min(1) }, // o SDK valida isto
}, async ({ cliente, itens }) => {
  const p = sistema.criar(cliente, itens); // ← seu método, intacto
  return { content: [{ type: 'text', text: `Pedido #${p.id} criado` }] };
});
```

Regras que valem na prática:

- Exponha **poucas tools bem descritas**, orientadas a tarefa de negócio, não um espelho 1:1 dos endpoints. A `description` é o que o modelo lê para decidir.
- O `inputSchema` é validado antes do seu código rodar. Argumento errado nunca chega no método.
- Credenciais ficam no servidor. O modelo nunca vê token.
- Se o sistema é em outra linguagem (PHP, Java...), o adaptador vira um **cliente HTTP** da API que já existe, carregando a autenticação do usuário. Uma collection do Postman ou um OpenAPI é um bom inventário de partida.
- Nunca use `console.log` num servidor stdio: stdout é o canal do protocolo. Logs vão para `console.error` ou `notifications/message`.

## Estrutura

```
src/
├── legado/pedidos.ts            sistema que já existe: classe comum, sem IA, sem MCP
├── server/
│   ├── index.ts                 servidor MCP: tools, resources, prompt, logging, boot stdio
│   └── adaptador-pedidos.ts     a porta MCP do legado: uma tool por método
├── host/
│   ├── agent.ts                 Client do SDK + loop com Ollama A + modo manual
│   └── cli.ts                   versão terminal
├── shared/
│   ├── tap-transport.ts         o "grampo": embrulha o transporte stdio e observa cada JSON-RPC
│   ├── ollama.ts                fetch para /api/chat com tools
│   └── events.ts                tipos do LabEvent (raias, fases, kinds)
└── bridge/index.ts              HTTP + WebSocket que serve web/ e retransmite os eventos
web/                             site estático: index.html, app.js, style.css (sem framework)
docs/                            anotações de estudo e screenshot
```

## O que dá para aprender aqui

1. **Papéis**: Host, Client e Server. O modelo nunca fala MCP; o Client fala por ele.
2. **Transporte stdio**: o servidor é um processo filho, um JSON por linha.
3. **JSON-RPC 2.0**: request (id + method), response (id + result ou error), notification (method sem id).
4. **Ciclo de vida**: `initialize` → `notifications/initialized` → descoberta → uso.
5. **Primitivas**: tools (modelo decide), resources (app decide), prompts (usuário decide).
6. **Onde o LLM entra**: a tradução MCP ⇄ function calling que o Host faz, e que o Modo manual substitui por você.
7. **MCP é uma fronteira**: do outro lado de um `tools/call` pode haver um método, uma API, um banco ou outra IA.

O guia ilustrado dentro do site (aba **Guia ilustrado**) tem um diagrama para cada um desses pontos.

## Usando este servidor em outros hosts

O mesmo `src/server/index.ts` funciona em qualquer host MCP. No Claude Code:

```bash
claude mcp add lab -- node --import tsx /caminho/para/mcp-lab/src/server/index.ts
```

No Claude Desktop, adicione ao `claude_desktop_config.json` um servidor com `command: "node"` e
`args: ["--import", "tsx", "/caminho/para/mcp-lab/src/server/index.ts"]`.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `EADDRINUSE :4321` | Já tem uma ponte rodando. `lsof -ti:4321 \| xargs kill` ou use `PORT=4322`. |
| "Ollama respondeu 404" | Modelo não baixado. `ollama pull <modelo>`. |
| `fetch failed` ao perguntar | Ollama não está rodando. Abra o app ou `ollama serve`. |
| Modelo responde sem chamar tool | Normal em modelos pequenos. Use **Nova conversa**, reformule, ou use o **Modo manual**. |
| Pill "ponte: offline" | O `npm run dev` caiu. Suba de novo; a página reconecta sozinha. |

## Próximos experimentos

- Adicione uma tool nova no adaptador. Ela aparece no `tools/list` sem mexer no host.
- Troque stdio por Streamable HTTP e compare os eventos.
- Faça o servidor usar `sampling/createMessage` (pedir ao modelo do host) em vez de ter o próprio Ollama B.
- Escreva um adaptador para uma API sua a partir de uma collection do Postman.

## Licença

MIT.
