/**
 * Eventos do laboratório.
 *
 * Tudo que acontece (mensagens MCP, chamadas ao Ollama, fala do usuário)
 * vira um `LabEvent`. O site desenha cada evento como uma seta entre duas
 * "raias" (lanes) de um diagrama de sequência.
 */

/** As cinco raias do diagrama, da esquerda para a direita. */
export type Lane = 'user' | 'ollamaA' | 'host' | 'server' | 'ollamaB';

export type EventKind =
  | 'phase'               // marcador de fase (handshake, descoberta, raciocínio...)
  | 'user'                // você → host
  | 'assistant'           // host → você (resposta final)
  | 'llm.request'         // host → Ollama A
  | 'llm.response'        // Ollama A → host
  | 'mcp.request'         // host → servidor (JSON-RPC com id)
  | 'mcp.response'        // servidor → host (result)
  | 'mcp.error'           // servidor → host (error)
  | 'mcp.notification'    // sem id, em qualquer direção
  | 'server.llm.request'  // servidor → Ollama B (contado via notifications/message)
  | 'server.llm.response' // Ollama B → servidor
  | 'server.log';         // stderr do servidor

export interface LabEvent {
  id: number;
  ts: number;
  kind: EventKind;
  from: Lane;
  to: Lane;
  /** Texto curto da seta, ex.: "tools/call calcular" */
  label: string;
  /** Fase em que o evento aconteceu (para colorir/agrupar) */
  phase: Phase;
  /** Conteúdo bruto: a mensagem JSON-RPC, o body do Ollama, etc. */
  payload: unknown;
  /** Para respostas: quantos ms desde a requisição */
  latencyMs?: number;
}

export type Phase = 'boot' | 'handshake' | 'discovery' | 'reasoning' | 'tool' | 'answer';
