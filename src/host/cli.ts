/**
 * Versão terminal do laboratório: mesma lógica do site, mas imprime
 * cada evento como uma linha. Útil para ver o protocolo sem browser.
 *
 *   npm run cli
 */
import readline from 'node:readline/promises';
import { Agent } from './agent.js';
import type { LabEvent } from '../shared/events.js';

const cores: Record<string, string> = {
  phase: '\x1b[1;35m', user: '\x1b[1;32m', assistant: '\x1b[1;32m',
  'llm.request': '\x1b[36m', 'llm.response': '\x1b[36m',
  'mcp.request': '\x1b[33m', 'mcp.response': '\x1b[33m', 'mcp.error': '\x1b[31m', 'mcp.notification': '\x1b[2;33m',
  'server.llm.request': '\x1b[34m', 'server.llm.response': '\x1b[34m', 'server.log': '\x1b[2m',
};
const reset = '\x1b[0m';

function print(e: LabEvent) {
  const cor = cores[e.kind] ?? '';
  if (e.kind === 'phase') return console.log(`\n${cor}══ ${e.label} ══${reset}`);
  const seta = `${e.from} → ${e.to}`.padEnd(18);
  const lat = e.latencyMs ? ` (${e.latencyMs} ms)` : '';
  console.log(`${cor}${seta} ${e.kind.padEnd(19)} ${e.label}${lat}${reset}`);
  if (process.env.VERBOSE && (e.kind.startsWith('mcp') || e.kind === 'server.llm.request')) {
    console.log('   ' + JSON.stringify(e.payload));
  }
}

const agent = new Agent();
agent.on('event', print);
await agent.connect();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log(`\nModelo A: ${agent.model} | tools: ${agent.toolNames.join(', ')}`);
console.log('Digite uma pergunta (ou "sair"). VERBOSE=1 mostra o JSON bruto.\n');
process.stdout.write('você › ');
for await (const linha of rl) {
  const q = linha.trim();
  if (q === 'sair') break;
  if (q) {
    const a = await agent.ask(q);
    console.log(`\n\x1b[1massistente ›\x1b[0m ${a}\n`);
  }
  process.stdout.write('você › ');
}
await agent.disconnect();
rl.close();
