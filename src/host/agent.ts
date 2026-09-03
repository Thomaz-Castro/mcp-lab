/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SISTEMA A — Host MCP ("lab-host") + Ollama A                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * O Host é o programa que o usuário usa (Claude Desktop, Cursor, este
 * laboratório...). Ele tem DOIS lados:
 *
 *   1. Lado do modelo: fala com o Ollama (HTTP puro, sem MCP).
 *   2. Lado MCP: um `Client` do SDK conectado a um servidor via Transport.
 *
 * O trabalho do Host é ser o tradutor entre os dois:
 *   tools/list (MCP)  ──►  "tools" no /api/chat do Ollama
 *   tool_calls (Ollama) ──►  tools/call (MCP)
 *   result (MCP)      ──►  mensagem role=tool de volta pro Ollama
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { TapTransport } from '../shared/tap-transport.js';
import { ollamaChat, type OllamaMessage, type OllamaTool } from '../shared/ollama.js';
import type { LabEvent, Lane, Phase } from '../shared/events.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

export interface AgentOptions {
  model?: string;
  serverArgs?: string[];
}

export class Agent extends EventEmitter {
  readonly model: string;
  readonly events: LabEvent[] = [];
  private seq = 0;
  private phase: Phase = 'boot';
  private client: Client | null = null;
  private tools: OllamaTool[] = [];
  /** Definições cruas vindas do tools/list (para o modo manual do site) */
  toolDefs: { name: string; description?: string; inputSchema: unknown }[] = [];
  private messages: OllamaMessage[] = [];
  private busy = false;
  /** id JSON-RPC → {method, ts} para casar respostas com requisições */
  private pending = new Map<string | number, { method: string; ts: number }>();
  private serverArgs: string[];

  constructor(opts: AgentOptions = {}) {
    super();
    this.model = opts.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
    this.serverArgs = opts.serverArgs ?? ['--import', 'tsx', path.join(ROOT, 'src/server/index.ts')];
    this.resetConversation();
  }

  get connected() {
    return this.client !== null;
  }
  get isBusy() {
    return this.busy;
  }
  get toolNames() {
    return this.tools.map((t) => t.function.name);
  }

  // ─── Emissão de eventos ───────────────────────────────────────────
  private emitEvent(e: Omit<LabEvent, 'id' | 'ts' | 'phase'> & { phase?: Phase }): LabEvent {
    const ev: LabEvent = { id: ++this.seq, ts: Date.now(), phase: this.phase, ...e };
    this.events.push(ev);
    this.emit('event', ev);
    return ev;
  }

  private setPhase(phase: Phase, label: string) {
    this.phase = phase;
    this.emitEvent({ kind: 'phase', from: 'user', to: 'ollamaB', label, payload: { phase } });
  }

  /**
   * Chamado pelo TapTransport para CADA mensagem JSON-RPC, nas duas direções.
   * Aqui classificamos: request (tem id + method), notification (method sem id)
   * ou response (id + result/error).
   */
  private onRpc(dir: 'send' | 'recv', msg: JSONRPCMessage) {
    const m = msg as Record<string, unknown>;
    const from: Lane = dir === 'send' ? 'host' : 'server';
    const to: Lane = dir === 'send' ? 'server' : 'host';

    if ('method' in m && 'id' in m) {
      const method = String(m.method);
      this.pending.set(m.id as string | number, { method, ts: Date.now() });
      const params = m.params as Record<string, unknown> | undefined;
      const extra = method === 'tools/call' ? ` ${params?.name}` : method === 'resources/read' ? ` ${params?.uri}` : '';
      this.emitEvent({ kind: 'mcp.request', from, to, label: `${method}${extra}`, payload: msg });
      return;
    }

    if ('method' in m) {
      const method = String(m.method);
      const params = m.params as Record<string, unknown> | undefined;
      const data = params?.data as Record<string, unknown> | undefined;

      // O servidor nos conta que está falando com o Ollama B via logging.
      // Desenhamos isso como uma seta servidor ↔ Ollama B.
      if (method === 'notifications/message' && data?.type === 'ollama') {
        if (data.stage === 'request') {
          this.emitEvent({ kind: 'server.llm.request', from: 'server', to: 'ollamaB', label: `chat ${data.model}`, payload: msg });
        } else {
          this.emitEvent({ kind: 'server.llm.response', from: 'ollamaB', to: 'server', label: 'resposta', payload: msg, latencyMs: Number(data.ms) });
        }
        return;
      }
      this.emitEvent({ kind: 'mcp.notification', from, to, label: method, payload: msg });
      return;
    }

    if ('id' in m) {
      const req = this.pending.get(m.id as string | number);
      this.pending.delete(m.id as string | number);
      const latencyMs = req ? Date.now() - req.ts : undefined;
      const isError = 'error' in m;
      this.emitEvent({
        kind: isError ? 'mcp.error' : 'mcp.response',
        from,
        to,
        label: `${isError ? 'error' : 'result'} ← ${req?.method ?? `#${m.id}`}`,
        payload: msg,
        latencyMs,
      });
    }
  }

  // ─── Conexão (handshake + descoberta) ─────────────────────────────
  async connect() {
    if (this.client) return;
    this.resetConversation(); // servidor novo, memória nova
    this.setPhase('handshake', 'Handshake: initialize → initialized');

    // 1. Transporte real: sobe o servidor como processo filho e fala por stdio.
    const stdio = new StdioClientTransport({
      command: process.execPath, // o mesmo `node` que está rodando o host
      args: this.serverArgs,
      cwd: ROOT,
      stderr: 'pipe', // capturamos o stderr do servidor para mostrar como log
      env: { ...process.env } as Record<string, string>,
    });
    stdio.stderr?.on('data', (chunk: Buffer) => {
      const texto = chunk.toString().trim();
      this.emitEvent({ kind: 'server.log', from: 'server', to: 'server', label: texto, payload: texto });
    });

    // 2. Grampo: tudo que passar pelo transporte vira evento.
    const transport = new TapTransport(stdio, (dir, msg) => this.onRpc(dir, msg));

    // 3. O Client do SDK. `connect` faz o handshake sozinho:
    //    envia `initialize`, espera o result, manda `notifications/initialized`.
    const client = new Client({ name: 'lab-host', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    this.client = client;

    // 4. Descoberta: perguntamos o que o servidor oferece.
    this.setPhase('discovery', 'Descoberta: tools/list, resources/list, prompts/list');
    const { tools } = await client.listTools();
    await client.listResources().catch(() => undefined);
    await client.listPrompts().catch(() => undefined);

    this.toolDefs = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

    // 5. Tradução MCP → formato de "function" do Ollama.
    this.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
    }));
    this.emit('status');
  }

  async disconnect() {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.tools = [];
    this.toolDefs = [];
    this.pending.clear();
    this.emit('status');
  }

  resetConversation() {
    this.messages = [
      {
        role: 'system',
        content:
          'Você é um assistente em português com ferramentas de um servidor MCP. ' +
          'Regra absoluta: você NÃO consegue criar, salvar, calcular ou consultar nada sozinho. ' +
          'Toda ação (pedidos, notas, cálculo, hora, especialista) só acontece se você chamar a ferramenta ' +
          'correspondente NESTA resposta. Nunca afirme que algo foi feito sem ter chamado a ferramenta agora. ' +
          'Cada pedido do usuário exige uma chamada nova, mesmo que pareça repetido. ' +
          'Depois do resultado, responda em uma frase curta.',
      },
    ];
  }

  /** Lê um resource pelo URI (o Host decide, não o modelo). */
  async readResource(uri: string) {
    if (!this.client) throw new Error('não conectado');
    this.setPhase('discovery', `Leitura de resource: ${uri}`);
    return this.client.readResource({ uri });
  }

  /**
   * MODO MANUAL: você faz o papel da IA.
   * A IA só produz {name, arguments}. Aqui é você quem produz. O resto do
   * caminho (tools/call → SDK → seu método → result) é idêntico.
   */
  async callToolManual(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error('Conecte ao servidor antes.');
    if (this.busy) throw new Error('Ainda processando.');
    this.busy = true;
    this.emit('status');
    try {
      this.setPhase('tool', `Modo manual: você escolheu ${name}`);
      this.emitEvent({ kind: 'user', from: 'user', to: 'host', label: `(você como IA) ${name} ${JSON.stringify(args)}`, payload: { name, arguments: args } });
      const result = await this.client.callTool({ name, arguments: args });
      const content = (result.content as { type: string; text?: string }[]) ?? [];
      const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
      this.phase = 'answer';
      this.emitEvent({ kind: 'assistant', from: 'host', to: 'user', label: (result.isError ? 'isError: ' : '') + text.slice(0, 80), payload: { text, isError: !!result.isError, result } });
      return text;
    } finally {
      this.busy = false;
      this.emit('status');
    }
  }

  // ─── O loop agentico ──────────────────────────────────────────────
  async ask(text: string): Promise<string> {
    if (!this.client) throw new Error('Conecte ao servidor antes de perguntar.');
    if (this.busy) throw new Error('Ainda processando a pergunta anterior.');
    this.busy = true;
    this.emit('status');
    try {
      this.setPhase('reasoning', `Pergunta: "${text}"`);
      this.emitEvent({ kind: 'user', from: 'user', to: 'host', label: text, payload: { text } });
      this.messages.push({ role: 'user', content: text });

      const toolsUsadas: string[] = [];
      for (let rodada = 1; rodada <= 6; rodada++) {
        // Pergunta ao Ollama A, oferecendo as tools do servidor MCP.
        this.phase = 'reasoning';
        const t0 = Date.now();
        this.emitEvent({
          kind: 'llm.request',
          from: 'host',
          to: 'ollamaA',
          label: `chat ${this.model} (${this.tools.length} tools)`,
          payload: { model: this.model, messages: this.messages, tools: this.tools },
        });
        const res = await ollamaChat({ model: this.model, messages: this.messages, tools: this.tools });
        const calls = res.message.tool_calls ?? [];
        this.emitEvent({
          kind: 'llm.response',
          from: 'ollamaA',
          to: 'host',
          label: calls.length ? `quer chamar: ${calls.map((c) => c.function.name).join(', ')}` : 'resposta em texto',
          payload: res,
          latencyMs: Date.now() - t0,
        });
        this.messages.push(res.message);

        if (calls.length === 0) {
          const answer = res.message.content.trim();
          this.phase = 'answer';
          this.emitEvent({
            kind: 'assistant',
            from: 'host',
            to: 'user',
            label: (toolsUsadas.length ? '' : '⚠ sem tool: ') + answer.slice(0, 80),
            payload: { text: answer, toolsUsadas },
          });
          return answer;
        }

        // O modelo pediu ferramentas → cada uma vira um `tools/call` no MCP.
        this.setPhase('tool', `Rodada ${rodada}: ${calls.length} chamada(s) de ferramenta`);
        for (const call of calls) {
          toolsUsadas.push(call.function.name);
          const result = await this.client.callTool({
            name: call.function.name,
            arguments: call.function.arguments,
          });
          const content = (result.content as { type: string; text?: string }[]) ?? [];
          const textOut = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
          this.messages.push({ role: 'tool', content: textOut || JSON.stringify(result), tool_name: call.function.name });
        }
      }
      return '(limite de rodadas atingido)';
    } finally {
      this.busy = false;
      this.emit('status');
    }
  }
}
