# Anotações de estudo

Espaço para o que você for descobrindo. Sugestão de roteiro:

## Dia 1 — sentir o protocolo na mão
- [ ] `npm run server` e colar, linha a linha:
  ```json
  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"eu","version":"0"}}}
  {"jsonrpc":"2.0","method":"notifications/initialized"}
  {"jsonrpc":"2.0","id":2,"method":"tools/list"}
  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"calcular","arguments":{"expressao":"2+2"}}}
  ```
- [ ] O que acontece se mandar `tools/list` antes do `initialize`?
- [ ] O que acontece se mandar `arguments` errados?

## Dia 2 — o site
- [ ] Conectar em modo passo a passo e ler a explicação de cada seta.
- [ ] Comparar o `tools/list` (MCP) com o campo `tools` do `llm.request` (Ollama).
- [ ] Ver a raia do Ollama B aparecer ao perguntar algo ao especialista.

## Dia 3 — mexer
- [ ] Criar uma tool nova. Ex.: `clima_fake` que retorna um clima inventado.
- [ ] Criar um resource novo e ler pelo botão "Ler resource".
