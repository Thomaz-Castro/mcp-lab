/**
 * Cliente mínimo do Ollama (API /api/chat) com suporte a "tools"
 * (function calling). Não usa nenhuma lib: só `fetch`.
 *
 * Ollama fala JSON puro em http://localhost:11434 — nada de MCP aqui.
 * O MCP entra em OUTRA camada: é o Host que traduz as ferramentas do
 * servidor MCP para o formato que o Ollama entende, e vice-versa.
 */

export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

export interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  /** Em mensagens role=tool: qual ferramenta gerou esse conteúdo */
  tool_name?: string;
}

/** Formato de ferramenta que o Ollama aceita (igual ao da OpenAI). */
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown; // JSON Schema
  };
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export async function ollamaChat(opts: {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  host?: string;
}): Promise<OllamaChatResponse> {
  const res = await fetch(`${opts.host ?? OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      stream: false,
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama respondeu ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as OllamaChatResponse;
}
