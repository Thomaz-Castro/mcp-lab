/**
 * TapTransport — um "grampo" no transporte MCP.
 *
 * O SDK do MCP separa duas coisas:
 *   - Protocol/Client/Server: sabem o que é initialize, tools/call, etc.
 *   - Transport: só sabe mandar e receber `JSONRPCMessage` (stdio, HTTP...).
 *
 * Como Transport é só uma interface com start/send/close/onmessage, dá para
 * embrulhar um transporte real em outro que apenas observa as mensagens
 * passando. É exatamente isso que fazemos aqui, e é assim que o site
 * consegue mostrar cada byte do protocolo sem alterar o SDK.
 */
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';

export type TapDirection = 'send' | 'recv';
export type TapFn = (dir: TapDirection, msg: JSONRPCMessage) => void;

export class TapTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

  private inner: Transport;
  private tap: TapFn;

  constructor(inner: Transport, tap: TapFn) {
    this.inner = inner;
    this.tap = tap;
  }

  get sessionId() {
    return this.inner.sessionId;
  }

  setProtocolVersion(version: string) {
    this.inner.setProtocolVersion?.(version);
  }

  async start() {
    // Tudo que CHEGA do servidor passa por aqui antes de ir ao Client.
    this.inner.onmessage = (message, extra) => {
      this.tap('recv', message);
      this.onmessage?.(message, extra);
    };
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (err) => this.onerror?.(err);
    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    // Tudo que SAI do Client para o servidor passa por aqui.
    this.tap('send', message);
    await this.inner.send(message, options);
  }

  async close() {
    await this.inner.close();
  }
}
