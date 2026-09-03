/**
 * Ponte entre o Host (Node) e o site (browser).
 *
 *   browser ⇄ WebSocket ⇄ Agent ⇄ MCP (stdio) ⇄ lab-server
 *
 * O browser NÃO fala MCP. Ele só recebe os LabEvents que o Agent emite e
 * manda comandos simples: connect, ask, reset. Isso mantém o MCP "puro"
 * entre os dois processos Node, que é o que queremos observar.
 *
 *   npm run dev  →  http://localhost:4321
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Agent } from '../host/agent.js';
import { OLLAMA_HOST } from '../shared/ollama.js';

const PORT = Number(process.env.PORT ?? 4321);
const WEB = path.resolve(import.meta.dirname, '../../web');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const agent = new Agent();

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) {
    res.writeHead(404).end('não encontrado');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: httpServer });

function status() {
  return {
    type: 'status',
    connected: agent.connected,
    busy: agent.isBusy,
    model: agent.model,
    modelB: process.env.OLLAMA_MODEL_B ?? 'llama3.1:8b',
    ollama: OLLAMA_HOST,
    tools: agent.toolNames,
    toolDefs: agent.toolDefs,
  };
}
function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}

agent.on('event', (event) => broadcast({ type: 'event', event }));
agent.on('status', () => broadcast(status()));

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ ...status(), type: 'hello', events: agent.events }));
  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString()) as { type: string; text?: string; uri?: string; name?: string; arguments?: Record<string, unknown> };
    try {
      if (msg.type === 'connect') await agent.connect();
      else if (msg.type === 'disconnect') await agent.disconnect();
      else if (msg.type === 'ask' && msg.text) await agent.ask(msg.text);
      else if (msg.type === 'read' && msg.uri) await agent.readResource(msg.uri);
      else if (msg.type === 'reset') agent.resetConversation();
      else if (msg.type === 'call' && msg.name) await agent.callToolManual(msg.name, msg.arguments ?? {});
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n  MCP Lab  →  http://localhost:${PORT}\n`);
  console.log(`  Ollama: ${OLLAMA_HOST}  |  modelo A: ${agent.model}  |  modelo B: ${process.env.OLLAMA_MODEL_B ?? 'llama3.1:8b'}\n`);
});
