/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  O ADAPTADOR MCP — a única coisa que você escreve                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Para "colocar MCP" num sistema que já existe, você escreve isto:
 * uma tool por método que quer expor. Cada tool tem três partes:
 *
 *   1. name + description  → o que a IA LÊ para decidir chamar
 *   2. inputSchema (zod)   → o que o SDK VALIDA antes de executar
 *   3. callback            → a linha que chama o SEU método
 *
 * Nada do seu sistema muda. O caminho da IA até o método é:
 *
 *   IA escreve {"name":"pedidos_criar","arguments":{...}}
 *     → Host manda tools/call pelo stdio
 *       → SDK acha "pedidos_criar" no Map de tools registradas
 *         → SDK valida arguments com o inputSchema
 *           → chama o callback abaixo
 *             → callback chama sistema.criar(...)   ← SEU MÉTODO
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SistemaDePedidos } from '../legado/pedidos.js';

export function registrarPedidos(server: McpServer, sistema: SistemaDePedidos) {
  server.registerTool(
    'pedidos_listar',
    {
      title: 'Listar pedidos',
      description: 'Lista os pedidos do sistema. Pode filtrar por status.',
      inputSchema: {
        status: z.enum(['aberto', 'em_preparo', 'entregue', 'cancelado']).optional(),
      },
    },
    async ({ status }) => {
      const pedidos = sistema.listar(status); // ← SEU MÉTODO
      return { content: [{ type: 'text', text: JSON.stringify(pedidos, null, 2) }] };
    }
  );

  server.registerTool(
    'pedidos_criar',
    {
      title: 'Criar pedido',
      description: 'Cria um pedido novo para um cliente com uma lista de itens.',
      inputSchema: {
        cliente: z.string().min(1).describe('Nome do cliente'),
        itens: z.array(z.string()).min(1).describe('Itens do pedido, ex.: ["café", "pão de queijo"]'),
      },
    },
    async ({ cliente, itens }) => {
      try {
        const pedido = sistema.criar(cliente, itens); // ← SEU MÉTODO
        return { content: [{ type: 'text', text: `Pedido #${pedido.id} criado para ${pedido.cliente}: ${pedido.itens.join(', ')}` }] };
      } catch (err) {
        // Erro "de negócio": volta como isError para a IA ler e reagir.
        return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
      }
    }
  );

  server.registerTool(
    'pedidos_atualizar_status',
    {
      title: 'Atualizar status do pedido',
      description: 'Muda o status de um pedido existente.',
      inputSchema: {
        id: z.number().int().describe('Id do pedido'),
        status: z.enum(['aberto', 'em_preparo', 'entregue', 'cancelado']),
      },
    },
    async ({ id, status }) => {
      try {
        const pedido = sistema.atualizarStatus(id, status); // ← SEU MÉTODO
        return { content: [{ type: 'text', text: `Pedido #${pedido.id} agora está "${pedido.status}"` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
      }
    }
  );
}
