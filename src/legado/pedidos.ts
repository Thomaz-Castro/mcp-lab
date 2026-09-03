/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SEU SISTEMA DE HOJE (sem IA, sem MCP)                           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Imagine que isto é um pedaço de um sistema que já existe: uma classe
 * de serviço com métodos normais. Pode ser um repositório que fala com
 * Postgres, um client de API REST, o que for. Ela NÃO importa nada de
 * MCP, NÃO sabe que existe IA. É só código.
 *
 * Os `console.error` aqui são a "prova de vida": quando aparecerem na
 * raia do servidor no site (stderr), é porque a IA chegou neste método.
 */

export type StatusPedido = 'aberto' | 'em_preparo' | 'entregue' | 'cancelado';

export interface Pedido {
  id: number;
  cliente: string;
  itens: string[];
  status: StatusPedido;
  criadoEm: string;
}

export class SistemaDePedidos {
  private pedidos: Pedido[] = [
    { id: 1, cliente: 'Ana', itens: ['café', 'pão de queijo'], status: 'entregue', criadoEm: '2026-09-01T09:00:00Z' },
    { id: 2, cliente: 'Bruno', itens: ['suco de laranja'], status: 'aberto', criadoEm: '2026-09-03T08:30:00Z' },
  ];

  listar(status?: StatusPedido): Pedido[] {
    console.error(`[SistemaDePedidos] listar(${status ?? ''}) executado`);
    return status ? this.pedidos.filter((p) => p.status === status) : [...this.pedidos];
  }

  buscar(id: number): Pedido | undefined {
    console.error(`[SistemaDePedidos] buscar(${id}) executado`);
    return this.pedidos.find((p) => p.id === id);
  }

  criar(cliente: string, itens: string[]): Pedido {
    console.error(`[SistemaDePedidos] criar("${cliente}", [${itens.join(', ')}]) executado`);
    if (!cliente.trim()) throw new Error('cliente é obrigatório');
    if (itens.length === 0) throw new Error('pedido precisa de pelo menos um item');
    const pedido: Pedido = {
      id: this.pedidos.length + 1,
      cliente,
      itens,
      status: 'aberto',
      criadoEm: new Date().toISOString(),
    };
    this.pedidos.push(pedido);
    return pedido;
  }

  atualizarStatus(id: number, status: StatusPedido): Pedido {
    console.error(`[SistemaDePedidos] atualizarStatus(${id}, ${status}) executado`);
    const pedido = this.buscar(id);
    if (!pedido) throw new Error(`pedido ${id} não existe`);
    pedido.status = status;
    return pedido;
  }
}
