/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SISTEMA B — Servidor MCP ("lab-server")                          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Um servidor MCP é um processo que EXPÕE capacidades para um Host:
 *   - tools      → funções que o modelo pode chamar
 *   - resources  → dados que o Host pode ler (como arquivos/URLs)
 *   - prompts    → templates de conversa reutilizáveis
 *
 * Este servidor usa o transporte STDIO: ele é iniciado como processo
 * filho pelo Host e conversa por stdin/stdout, uma mensagem JSON-RPC
 * por linha. Por isso a REGRA DE OURO: nunca use console.log aqui —
 * stdout é o canal do protocolo. Logs vão para stderr (console.error)
 * ou, melhor ainda, pelo próprio MCP com `notifications/message`.
 *
 * Para ser "o segundo sistema com Ollama", a ferramenta
 * `consultar_especialista` chama um modelo do Ollama por conta própria.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ollamaChat } from '../shared/ollama.js';
import { SistemaDePedidos } from '../legado/pedidos.js';
import { registrarPedidos } from './adaptador-pedidos.js';

const MODEL_B = process.env.OLLAMA_MODEL_B ?? 'llama3.1:8b';

const server = new McpServer(
  { name: 'lab-server', version: '0.1.0' },
  {
    // O que este servidor sabe fazer. Isso é anunciado na resposta do
    // `initialize` e o Host usa para decidir o que pode pedir.
    capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
    instructions:
      'Servidor de laboratório. Use consultar_especialista para perguntas ' +
      'conceituais, calcular para contas, as notas para memória e pedidos_* para o sistema de pedidos.',
  }
);

/** Helper: manda um log estruturado ao Host via `notifications/message`. */
async function log(level: 'debug' | 'info' | 'warning' | 'error', data: unknown) {
  await server.server.sendLoggingMessage({ level, logger: 'lab-server', data });
}

// ─── Estado em memória ───────────────────────────────────────────────
const notas: { id: number; texto: string; criadaEm: string }[] = [];

// ─── TOOLS ───────────────────────────────────────────────────────────
// Cada registerTool vira um item na resposta de `tools/list`, e o Host
// entrega essa lista ao Ollama como "functions" disponíveis.

server.registerTool(
  'calcular',
  {
    title: 'Calculadora',
    description: 'Calcula uma expressão aritmética simples, ex.: "17 * 23 + 5".',
    inputSchema: { expressao: z.string().describe('Expressão com + - * / % ( )') },
  },
  async ({ expressao }) => {
    if (!/^[\d\s+\-*/%().]+$/.test(expressao)) {
      return { isError: true, content: [{ type: 'text', text: `Expressão inválida: ${expressao}` }] };
    }
    const resultado = Function(`"use strict"; return (${expressao});`)();
    await log('info', { tool: 'calcular', expressao, resultado });
    return { content: [{ type: 'text', text: `${expressao} = ${resultado}` }] };
  }
);

server.registerTool(
  'hora_atual',
  {
    title: 'Hora atual',
    description: 'Retorna a data e hora atuais do computador onde o servidor MCP roda.',
    inputSchema: {},
  },
  async () => {
    const agora = new Date();
    return {
      content: [
        {
          type: 'text',
          text: `${agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (ISO ${agora.toISOString()})`,
        },
      ],
    };
  }
);

server.registerTool(
  'salvar_nota',
  {
    title: 'Salvar nota',
    description: 'Guarda uma nota de texto na memória do servidor.',
    inputSchema: { texto: z.string().min(1) },
  },
  async ({ texto }) => {
    const nota = { id: notas.length + 1, texto, criadaEm: new Date().toISOString() };
    notas.push(nota);
    // Avisamos o Host que a lista de resources mudou (uma nota nova
    // significa um `nota://{id}` novo). É uma notificação: sem id, sem resposta.
    await server.server.sendResourceListChanged();
    return { content: [{ type: 'text', text: `Nota #${nota.id} salva: "${texto}"` }] };
  }
);

server.registerTool(
  'listar_notas',
  {
    title: 'Listar notas',
    description: 'Lista todas as notas salvas.',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: notas.length
          ? notas.map((n) => `#${n.id} ${n.texto}`).join('\n')
          : 'Nenhuma nota salva ainda.',
      },
    ],
  })
);

server.registerTool(
  'consultar_especialista',
  {
    title: 'Consultar especialista',
    description:
      'Pergunta a um segundo modelo de IA (especialista em protocolos e sistemas) ' +
      'e devolve uma explicação curta. Use para perguntas conceituais.',
    inputSchema: {
      pergunta: z.string().describe('A pergunta, em português'),
    },
  },
  async ({ pergunta }) => {
    // Aqui o SERVIDOR chama o Ollama. O Host não vê essa chamada HTTP —
    // então contamos para ele via logging, e o site desenha a raia "Ollama B".
    await log('info', { type: 'ollama', stage: 'request', model: MODEL_B, pergunta });
    const t0 = Date.now();
    const res = await ollamaChat({
      model: MODEL_B,
      messages: [
        {
          role: 'system',
          content:
            'Você é um especialista em protocolos de comunicação e sistemas distribuídos. ' +
            'Responda em português, em no máximo 3 frases, sem enrolação.',
        },
        { role: 'user', content: pergunta },
      ],
    });
    const resposta = res.message.content.trim();
    await log('info', {
      type: 'ollama',
      stage: 'response',
      model: MODEL_B,
      ms: Date.now() - t0,
      tokens: res.eval_count,
      resposta,
    });
    return { content: [{ type: 'text', text: resposta }] };
  }
);

// ─── SISTEMA QUE JÁ EXISTE + ADAPTADOR ───────────────────────────────
// Este é o caso real: um sistema seu, sem IA, ganhando uma "porta" MCP.
// Veja src/legado/pedidos.ts (o sistema) e ./adaptador-pedidos.ts (a porta).
registrarPedidos(server, new SistemaDePedidos());

// ─── RESOURCES ───────────────────────────────────────────────────────
// Resources são "coisas para ler", identificadas por URI. Diferente das
// tools, quem decide ler é o Host/usuário, não o modelo.

server.registerResource(
  'todas-as-notas',
  'notas://todas',
  { title: 'Todas as notas', description: 'Todas as notas salvas, em texto', mimeType: 'text/plain' },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'text/plain',
        text: notas.map((n) => `#${n.id} [${n.criadaEm}] ${n.texto}`).join('\n') || '(vazio)',
      },
    ],
  })
);

server.registerResource(
  'nota',
  new ResourceTemplate('nota://{id}', {
    list: async () => ({
      resources: notas.map((n) => ({ uri: `nota://${n.id}`, name: `Nota #${n.id}`, mimeType: 'text/plain' })),
    }),
  }),
  { title: 'Uma nota', description: 'Uma nota específica pelo id' },
  async (uri, { id }) => {
    const nota = notas.find((n) => String(n.id) === String(id));
    return {
      contents: [{ uri: uri.href, mimeType: 'text/plain', text: nota ? nota.texto : 'nota não encontrada' }],
    };
  }
);

// ─── PROMPTS ─────────────────────────────────────────────────────────
// Prompts são templates que o servidor oferece e o Host pode "puxar".

server.registerPrompt(
  'resumir_notas',
  {
    title: 'Resumir notas',
    description: 'Gera um pedido de resumo de todas as notas salvas',
    argsSchema: { estilo: z.string().optional().describe('ex.: "em tópicos", "uma frase"') },
  },
  ({ estilo }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Resuma estas notas ${estilo ?? 'brevemente'}:\n` +
            (notas.map((n) => `- ${n.texto}`).join('\n') || '(nenhuma nota)'),
        },
      },
    ],
  })
);

// ─── BOOT ────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[lab-server] pronto (stdio). Ollama B = ${MODEL_B}`);
