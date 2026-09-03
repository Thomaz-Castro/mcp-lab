/* MCP Lab — front-end. Sem framework: WebSocket + SVG + DOM. */

const $ = (id) => document.getElementById(id);
const LANES = ['user', 'ollamaA', 'host', 'server', 'ollamaB'];
const LANE_COLOR = { user: '#4ade80', ollamaA: '#22d3ee', host: '#fbbf24', server: '#a78bfa', ollamaB: '#60a5fa' };
const KIND_COLOR = {
  user: '#4ade80', assistant: '#4ade80', 'llm.request': '#22d3ee', 'llm.response': '#22d3ee',
  'mcp.request': '#fbbf24', 'mcp.response': '#a78bfa', 'mcp.error': '#f87171', 'mcp.notification': '#8b95a7',
  'server.llm.request': '#60a5fa', 'server.llm.response': '#60a5fa', 'server.log': '#8b95a7', phase: '#8b95a7',
};
const KIND_NAME = {
  user: 'você → host', assistant: 'resposta final', 'llm.request': 'HTTP → Ollama A', 'llm.response': 'HTTP ← Ollama A',
  'mcp.request': 'MCP request', 'mcp.response': 'MCP response', 'mcp.error': 'MCP error', 'mcp.notification': 'MCP notification',
  'server.llm.request': 'HTTP → Ollama B', 'server.llm.response': 'HTTP ← Ollama B', 'server.log': 'stderr do servidor', phase: 'fase',
};

/* ─── Explicações por método/kind (o coração didático) ───────────── */
const EXPLAIN = {
  'initialize': `Primeira mensagem de toda sessão MCP, sempre enviada pelo cliente. Ele diz qual <code>protocolVersion</code> fala, quais <code>capabilities</code> tem (ex.: sampling, roots) e quem é (<code>clientInfo</code>). É a versão MCP do "alô, você me ouve?".`,
  'result ← initialize': `O servidor aceita (ou negocia) a versão, e anuncia SUAS capabilities: aqui <code>tools</code>, <code>resources</code>, <code>prompts</code> e <code>logging</code>. Também manda <code>serverInfo</code> e <code>instructions</code>, um texto que o host pode colocar no system prompt do modelo.`,
  'notifications/initialized': `Notificação (sem <code>id</code>, logo sem resposta). O cliente confirma que recebeu o result do initialize e está pronto. Só a partir daqui o servidor aceita requests normais. Esse "3-way handshake" evita que alguém mande <code>tools/call</code> antes de combinar as regras.`,
  'tools/list': `O host pergunta: "que ferramentas você tem?". Repare que isso é decisão do <b>host</b>, não do modelo: o modelo ainda nem entrou na conversa.`,
  'result ← tools/list': `A lista de tools. Cada uma tem <code>name</code>, <code>description</code> e <code>inputSchema</code> (JSON Schema gerado do <code>zod</code> no servidor). É exatamente isso que o host vai traduzir para o formato de "function" do Ollama. A <code>description</code> é o que o modelo lê para decidir quando usar.`,
  'resources/list': `O host pergunta quais recursos (dados por URI) existem. Diferente das tools, quem lê resources é o app, não o modelo.`,
  'result ← resources/list': `Resources fixos (<code>notas://todas</code>) e, se houver notas, os instanciados do template <code>nota://{id}</code>.`,
  'resources/read': `O host lê um resource pelo URI. Aqui você clicou em "Ler resource" e o modelo não participou: isso mostra que resources são controlados pelo app.`,
  'result ← resources/read': `O conteúdo do resource, em <code>contents[]</code> com <code>mimeType</code>. Um host real injetaria isso no contexto do modelo.`,
  'prompts/list': `O host pergunta quais templates de prompt o servidor oferece. Em hosts como o Claude Desktop, viram comandos de barra para o usuário escolher.`,
  'result ← prompts/list': `Lista de prompts com seus argumentos. Este servidor oferece <code>resumir_notas</code>.`,
  'tools/call': `A chamada de ferramenta. O modelo (Ollama A) disse "quero chamar X com estes argumentos" e o host transformou isso neste request MCP. O servidor valida os <code>arguments</code> contra o <code>inputSchema</code> antes de executar.`,
  'result ← tools/call': `O resultado da tool: <code>content[]</code> com blocos (texto, imagem, etc.) e opcionalmente <code>isError</code>. O host vai colocar esse texto numa mensagem <code>role: "tool"</code> e devolver ao Ollama A para ele continuar raciocinando.`,
  'error ← tools/call': `Erro de protocolo (código JSON-RPC). Diferente de <code>isError: true</code> no result, que é um erro "de negócio" que o modelo pode ler e tentar de novo.`,
  'notifications/message': `Log estruturado do servidor, via MCP (não via stderr). Tem <code>level</code>, <code>logger</code> e <code>data</code> livre. É uma notificação: o host não responde. Útil porque o servidor não tem tela: é a única forma dele "contar" o que está fazendo.`,
  'notifications/resources/list_changed': `O servidor avisa que a lista de resources mudou (uma nota nova virou um <code>nota://{id}</code> novo). Um host caprichado refaria <code>resources/list</code> ao receber isso.`,
  'llm.request': `<b>Não é MCP.</b> É um POST HTTP para <code>/api/chat</code> do Ollama. O host manda o histórico inteiro (<code>messages</code>) mais as <code>tools</code> traduzidas do <code>tools/list</code>. Olhe o campo <code>tools</code>: é a lista do servidor MCP no formato que o Ollama entende.`,
  'llm.response.tool': `O Ollama A decidiu usar ferramentas: veja <code>message.tool_calls</code>. Cada item tem <code>function.name</code> e <code>function.arguments</code>. Ele não executa nada. Só pede. Quem executa é o host, via MCP.`,
  'llm.response.text': `O Ollama A respondeu em texto, sem pedir ferramentas. Isso encerra o loop: o host devolve esse <code>message.content</code> a você.`,
  'server.llm.request': `<b>Não é MCP.</b> Dentro da tool <code>consultar_especialista</code>, o <b>servidor</b> chamou seu próprio modelo (Ollama B). O host não vê essa chamada HTTP; ele só fica esperando o result do <code>tools/call</code>. Sabemos disso porque o servidor mandou um <code>notifications/message</code> contando (esse é o payload abaixo).`,
  'server.llm.response': `O Ollama B respondeu ao servidor. O servidor vai embrulhar esse texto no <code>content</code> do result do <code>tools/call</code>. Para o host, foi só "uma tool que demorou uns segundos".`,
  'user.manual': `<b>Você fez o papel da IA.</b> Tudo que um modelo produz é este objeto <code>{name, arguments}</code>. Você o produziu na mão, e o resto do caminho é idêntico: o Host copia para um <code>tools/call</code>, o SDK acha a tool pelo nome, valida e chama o método. Repare que não existe seta para o Ollama A: a IA é opcional na arquitetura.`,
  'user': `Você digitou isso no browser. A ponte WebSocket entrega ao host, que adiciona como <code>role: "user"</code> no histórico e chama o Ollama A.`,
  'assistant': `A resposta final chega a você. Note quantas mensagens aconteceram no meio: essa é a parte que fica invisível em um chat normal.`,
  'assistant.semtool': `<b>⚠ Nenhuma tool foi chamada nesta pergunta.</b> O modelo respondeu direto em texto. Se a resposta afirma que algo foi criado, salvo ou calculado, isso é <b>invenção do modelo</b>: não há seta amarela nem <code>stderr</code>, logo o servidor nunca rodou. Isso costuma acontecer quando o histórico já tem uma resposta parecida e o modelo "continua o padrão". Use <b>Nova conversa</b> para zerar o histórico e repita.`,
  'server.log': `Texto que o servidor escreveu no <b>stderr</b>. É o canal certo para logs humanos, já que o stdout é o canal do protocolo. O host captura com <code>stderr: 'pipe'</code>.`,
  'phase': `Marcador de fase, só para organizar o diagrama. Não é uma mensagem.`,
};
function explainFor(ev) {
  if (ev.kind === 'user' && ev.payload?.name) return EXPLAIN['user.manual'];
  if (ev.kind === 'assistant' && ev.payload?.toolsUsadas && ev.payload.toolsUsadas.length === 0) return EXPLAIN['assistant.semtool'];
  if (ev.kind === 'llm.response') return EXPLAIN[ev.payload?.message?.tool_calls?.length ? 'llm.response.tool' : 'llm.response.text'];
  if (ev.kind.startsWith('mcp')) {
    const key = ev.label.replace(/ (\S+)$/, (m, a) => (ev.label.startsWith('tools/call') || ev.label.startsWith('resources/read')) ? '' : m);
    return EXPLAIN[key] ?? EXPLAIN[ev.label.split(' ')[0]] ?? `Método <code>${ev.label}</code>.`;
  }
  return EXPLAIN[ev.kind] ?? '';
}
function anatomyFor(ev) {
  if (!ev.kind.startsWith('mcp')) return [];
  const m = ev.payload || {};
  const has = (k) => k in m;
  const tipo = has('method') && has('id') ? 'Request' : has('method') ? 'Notification' : has('error') ? 'Error' : 'Response';
  return [
    [`jsonrpc: "2.0"`, true],
    [`id`, has('id')],
    [`method`, has('method')],
    [`params`, has('params')],
    [`result`, has('result')],
    [`error`, has('error')],
    [`= ${tipo}`, true],
  ];
}

/* ─── Estado ──────────────────────────────────────────────────────── */
const state = { events: [], rendered: 0, buffer: [], step: false, selected: null, connected: false, busy: false };
const ROW = 46, PHASE_ROW = 34, TOP = 12;
const svg = $('seq');
let width = 800;

function laneX(lane) {
  const i = LANES.indexOf(lane);
  return width / 5 * (i + 0.5);
}
function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}
function relayout() {
  width = $('scroll').clientWidth - 2;
  svg.setAttribute('width', width);
  // redesenha tudo (barato: poucas centenas de nós)
  [...svg.querySelectorAll('g, line.lifeline')].forEach((n) => n.remove());
  let y = TOP;
  for (const ev of state.events.slice(0, state.rendered)) y = drawEvent(ev, y, false);
  finish(y);
}
function finish(y) {
  svg.setAttribute('height', Math.max(y + 20, $('scroll').clientHeight));
  svg.querySelectorAll('line.lifeline').forEach((n) => n.remove());
  for (const l of LANES) {
    const line = svgEl('line', { class: 'lifeline', x1: laneX(l), x2: laneX(l), y1: 0, y2: Math.max(y + 20, $('scroll').clientHeight) });
    svg.insertBefore(line, svg.firstChild.nextSibling);
  }
}
let currentY = TOP;
function drawEvent(ev, y, animate) {
  const g = svgEl('g', { class: `ev k-${ev.kind.replace(/\./g, '-')} ${animate ? 'new' : ''} ${state.selected === ev.id ? 'selected' : ''}`, 'data-id': ev.id });
  if (ev.kind === 'phase') {
    g.setAttribute('class', `phase ph-${ev.payload.phase}`);
    g.appendChild(svgEl('rect', { x: 0, y: y, width, height: PHASE_ROW - 6 }));
    g.appendChild(svgEl('line', { x1: 0, x2: width, y1: y + PHASE_ROW - 6, y2: y + PHASE_ROW - 6 }));
    g.appendChild(svgEl('text', { x: 14, y: y + 18 }, ev.label));
    svg.appendChild(g);
    return y + PHASE_ROW;
  }
  const yy = y + ROW / 2 + 6;
  if (ev.kind === 'server.log') {
    const x = laneX('server');
    const txt = String(ev.payload).slice(0, 60);
    g.appendChild(svgEl('rect', { class: 'note', x: x - 240, y: yy - 14, width: 480, height: 22, rx: 4 }));
    g.appendChild(svgEl('text', { x, y: yy + 1, 'text-anchor': 'middle' }, `stderr: ${txt}`));
  } else {
    const x1 = laneX(ev.from), x2 = laneX(ev.to);
    const dir = x2 > x1 ? 1 : -1;
    g.appendChild(svgEl('path', { class: 'arrow', d: `M ${x1} ${yy} L ${x2 - dir * 4} ${yy}`, 'marker-end': 'url(#arrow)' }));
    const label = ev.label.length > 46 ? ev.label.slice(0, 44) + '…' : ev.label;
    const w = label.length * 7.2 + 14;
    const mx = (x1 + x2) / 2;
    g.appendChild(svgEl('rect', { class: 'lbl-bg', x: mx - w / 2, y: yy - 24, width: w, height: 19 }));
    g.appendChild(svgEl('text', { class: 'lbl', x: mx, y: yy - 10, 'text-anchor': 'middle' }, label));
    if (ev.latencyMs != null) g.appendChild(svgEl('text', { class: 'lat', x: mx, y: yy + 13, 'text-anchor': 'middle' }, `${ev.latencyMs} ms`));
  }
  g.addEventListener('click', () => select(ev.id));
  svg.appendChild(g);
  return y + ROW;
}
function appendRendered(ev, animate = true) {
  $('empty').hidden = true;
  currentY = drawEvent(ev, currentY, animate);
  finish(currentY);
  $('scroll').scrollTop = $('scroll').scrollHeight;
  if (animate && ev.kind !== 'phase') select(ev.id);
}

/* ─── Inspetor ────────────────────────────────────────────────────── */
function hlJson(obj) {
  const s = JSON.stringify(obj, null, 2) ?? String(obj);
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
      let cls = 'n';
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'k' : 's';
      else if (/true|false|null/.test(m)) cls = 'b';
      return `<span class="${cls}">${m}</span>`;
    });
}
function select(id) {
  state.selected = id;
  svg.querySelectorAll('.ev.selected').forEach((n) => n.classList.remove('selected'));
  svg.querySelector(`.ev[data-id="${id}"]`)?.classList.add('selected');
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  const kind = $('insp-kind');
  kind.textContent = KIND_NAME[ev.kind] ?? ev.kind;
  kind.style.background = KIND_COLOR[ev.kind] ?? '#8b95a7';
  $('insp-title').textContent = ev.label;
  const t = new Date(ev.ts).toLocaleTimeString('pt-BR', { hour12: false }) + '.' + String(ev.ts % 1000).padStart(3, '0');
  $('insp-meta').innerHTML = `<span style="color:${LANE_COLOR[ev.from]}">${ev.from}</span> → <span style="color:${LANE_COLOR[ev.to]}">${ev.to}</span> · ${t}${ev.latencyMs != null ? ` · ${ev.latencyMs} ms` : ''} · evento #${ev.id}`;
  $('anatomy').innerHTML = anatomyFor(ev).map(([k, hit]) => `<span class="${hit ? 'hit' : ''}">${k}</span>`).join('');
  $('explain').innerHTML = explainFor(ev);
  let payload = ev.payload;
  if (ev.kind === 'llm.request') {
    // resume o histórico pra não afogar; mostra tools inteiras
    payload = { model: payload.model, messages: payload.messages, tools: payload.tools };
  }
  $('json').innerHTML = hlJson(payload);
}

/* ─── Recebendo eventos ───────────────────────────────────────────── */
function onEvent(ev) {
  state.events.push(ev);
  if (state.step && ev.kind !== 'phase') {
    state.buffer.push(ev);
    updateStepUI();
  } else if (state.step) {
    // fases entram na fila também, para manter a ordem
    state.buffer.push(ev);
    updateStepUI();
  } else {
    state.rendered = state.events.length;
    appendRendered(ev);
  }
}
function updateStepUI() {
  $('buffered').hidden = state.buffer.length === 0;
  $('buffered').textContent = state.buffer.length;
  $('btn-next').disabled = state.buffer.length === 0;
}
function next() {
  const ev = state.buffer.shift();
  if (!ev) return;
  state.rendered++;
  appendRendered(ev);
  updateStepUI();
}
function clearScreen() {
  state.events = []; state.rendered = 0; state.buffer = []; state.selected = null; currentY = TOP;
  [...svg.querySelectorAll('g, line.lifeline')].forEach((n) => n.remove());
  svg.setAttribute('height', $('scroll').clientHeight);
  $('empty').hidden = false;
  updateStepUI();
}

/* ─── WebSocket ───────────────────────────────────────────────────── */
let ws;
function send(msg) {
  if (ws?.readyState !== 1) return toast('Ponte ainda conectando, tente de novo em 1 s');
  ws.send(JSON.stringify(msg));
}
function applyStatus(s) {
  state.connected = s.connected; state.busy = s.busy;
  $('pill-server').textContent = `servidor MCP: ${s.connected ? `conectado · ${s.tools.length} tools` : 'desconectado'}`;
  $('pill-server').className = `pill ${s.connected ? (s.busy ? 'busy' : 'on') : 'off'}`;
  $('pill-a').innerHTML = `Ollama A: <b>${s.model}</b>`;
  $('pill-b').innerHTML = `Ollama B: <b>${s.modelB}</b>`;
  $('lane-a').textContent = s.model; $('lane-b').textContent = s.modelB;
  $('btn-connect').disabled = s.connected;
  $('btn-disconnect').disabled = !s.connected || s.busy;
  $('btn-read').disabled = !s.connected || s.busy;
  $('btn-reset').disabled = !s.connected || s.busy;
  $('m-send').disabled = !s.connected || s.busy;
  if (JSON.stringify(s.toolDefs) !== JSON.stringify(toolDefs)) { toolDefs = s.toolDefs ?? []; manualRender(); }
  $('q').disabled = $('send').disabled = !s.connected || s.busy;
  $('q').placeholder = s.busy ? 'Pensando… acompanhe as setas' : 'Pergunte algo… (o Host manda ao Ollama A, que decide se chama uma tool do servidor MCP)';
}
function connectWs() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => { $('pill-ws').textContent = 'ponte: online'; $('pill-ws').className = 'pill on'; };
  ws.onclose = () => { $('pill-ws').textContent = 'ponte: offline (npm run dev?)'; $('pill-ws').className = 'pill off'; setTimeout(connectWs, 1500); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.type === 'hello') {
      clearScreen();
      for (const ev of msg.events) { state.events.push(ev); state.rendered++; appendRendered(ev, false); }
      $('scroll').scrollTop = $('scroll').scrollHeight;
      applyStatus(msg);
    } else if (msg.type === 'event') onEvent(msg.event);
    else if (msg.type === 'status') applyStatus(msg);
    else if (msg.type === 'error') toast(msg.message);
  };
}
function toast(text) {
  const t = $('toast'); t.textContent = text; t.style.display = 'block'; t.style.background = /zerado/.test(text) ? '#4ade80' : '#f87171';
  setTimeout(() => (t.style.display = 'none'), 4000);
}

/* ─── Modo manual: você faz o papel da IA ─────────────────────────── */
let toolDefs = [];
function manualRender() {
  const sel = $('m-tool');
  const atual = sel.value;
  sel.innerHTML = toolDefs.map((t) => `<option value="${t.name}">${t.name}</option>`).join('');
  if (toolDefs.some((t) => t.name === atual)) sel.value = atual;
  manualFields();
}
function manualFields() {
  const t = toolDefs.find((x) => x.name === $('m-tool').value);
  $('m-desc').textContent = t?.description ?? '';
  const props = (t?.inputSchema?.properties) ?? {};
  const req = new Set(t?.inputSchema?.required ?? []);
  $('m-fields').innerHTML = Object.entries(props).map(([k, p]) => {
    const tipo = p.type === 'array' ? 'array' : p.type === 'integer' || p.type === 'number' ? 'number' : p.enum ? 'enum' : 'string';
    let input;
    if (tipo === 'enum') input = `<select data-k="${k}" data-t="enum">${['', ...p.enum].map((e) => `<option>${e}</option>`).join('')}</select>`;
    else input = `<input data-k="${k}" data-t="${tipo}" placeholder="${tipo === 'array' ? 'itens separados por vírgula' : tipo === 'number' ? '123' : 'texto'}">`;
    return `<div class="f"><div><code>${k}</code>${req.has(k) ? ' *' : ''}<small>${p.type ?? ''}${p.description ? ' · ' + p.description : ''}</small></div>${input}</div>`;
  }).join('') || '<div class="m-desc">esta tool não tem argumentos</div>';
  manualPreview();
}
function manualArgs() {
  const args = {};
  for (const el of $('m-fields').querySelectorAll('[data-k]')) {
    const v = el.value.trim();
    if (v === '') continue;
    const t = el.dataset.t;
    args[el.dataset.k] = t === 'number' ? Number(v) : t === 'array' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v;
  }
  return args;
}
function manualPreview() {
  $('m-preview').innerHTML = hlJson({ name: $('m-tool').value, arguments: manualArgs() });
}
$('m-tool').onchange = manualFields;
$('m-fields').oninput = manualPreview;
$('m-fields').onchange = manualPreview;
$('manual-panel').onsubmit = (e) => { e.preventDefault(); send({ type: 'call', name: $('m-tool').value, arguments: manualArgs() }); };
$('manual').onchange = (e) => { const on = e.target.checked; $('manual-panel').hidden = !on; $('ask').hidden = on; $('chips').hidden = on; if (on) manualRender(); };

/* ─── UI wiring ───────────────────────────────────────────────────── */
$('btn-connect').onclick = () => send({ type: 'connect' });
$('btn-disconnect').onclick = () => send({ type: 'disconnect' });
$('btn-read').onclick = () => send({ type: 'read', uri: 'notas://todas' });
$('btn-clear').onclick = clearScreen;
$('btn-reset').onclick = () => { send({ type: 'reset' }); toast('Histórico da conversa zerado'); };
$('btn-next').onclick = next;
$('step').onchange = (e) => { state.step = e.target.checked; if (!state.step) while (state.buffer.length) next(); };
$('ask').onsubmit = (e) => { e.preventDefault(); const t = $('q').value.trim(); if (!t) return; send({ type: 'ask', text: t }); $('q').value = ''; };
$('chips').onclick = (e) => { if (e.target.tagName === 'BUTTON') { $('q').value = e.target.textContent; if (!$('q').disabled) $('ask').requestSubmit(); } };
document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  for (const id of ['live', 'guide', 'map']) $(id).hidden = id !== b.dataset.tab;
  if (b.dataset.tab === 'live') relayout();
}));
document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' && state.step && document.activeElement.tagName !== 'INPUT') next(); });
new ResizeObserver(() => { if (!$('live').hidden) relayout(); }).observe($('scroll'));
relayout();
connectWs();
