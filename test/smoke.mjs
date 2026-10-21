// End-to-end smoke test: starts the real server on a random port and talks to it over HTTP.
// Run: node test/smoke.mjs
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coach-')), 'data.json');
delete process.env.ANTHROPIC_API_KEY; // test the offline rules brain

const { start, server } = await import('../server.mjs');
const { state } = await import('../lib/tools.mjs');
const port = await start(0, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra); } };

let sid = null, rid = 0;
async function rpc(method, params, { session = true, headers = {}, notif = false, raw } = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers };
  if (session && sid) { h['Mcp-Session-Id'] = sid; h['MCP-Protocol-Version'] = '2025-11-25'; }
  Object.assign(h, headers); // explicit per-test headers win
  const msg = raw ?? (notif ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rid, method, params });
  const r = await fetch(base + '/mcp', { method: 'POST', headers: h, body: JSON.stringify(msg) });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* sse */ }
  return { status: r.status, json, text, headers: r.headers };
}
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const agent = async (text, history = [], lang = 'auto') => (await (await fetch(base + '/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, history, lang }) })).json());

console.log('\nProtocol');
let r = await (await fetch(base + '/healthz')).json();
ok(r.ok && r.protocol === '2025-11-25', 'healthz reports protocol 2025-11-25');

r = await rpc('tools/list', {}, { session: false });
ok(r.status === 400, 'request without session is rejected (400)', r.status);

r = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, { session: false });
sid = r.headers.get('mcp-session-id');
ok(r.status === 200 && !!sid, 'initialize returns Mcp-Session-Id');
ok(r.json.result.protocolVersion === '2025-11-25', 'negotiates 2025-11-25');
ok(r.json.result.capabilities.tools && r.json.result.serverInfo.name === 'prakash-study-coach-mcp', 'declares tools capability + serverInfo');

r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }, { session: false });
ok(r.json.result.protocolVersion === '2025-06-18', 'echoes an older supported version');
r = await rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 't', version: '1' } }, { session: false });
ok(r.json.result.protocolVersion === '2025-11-25', 'unknown version falls back to latest');

r = await rpc('notifications/initialized', undefined, { notif: true });
ok(r.status === 202, 'notification → 202 Accepted');

r = await rpc('ping', {});
ok(r.status === 200 && r.json.result && Object.keys(r.json.result).length === 0, 'ping → {}');

r = await rpc('tools/list', {});
const tools = r.json.result.tools;
ok(tools.length === 18, `tools/list returns 18 tools (got ${tools.length})`);
ok(tools.every((t) => t.name && t.description && t.inputSchema && t.inputSchema.type === 'object'), 'every tool has name, description and an object inputSchema');

r = await rpc('nope/method', {});
ok(r.json.error && r.json.error.code === -32601, 'unknown method → -32601');
r = await call('does_not_exist', {});
ok(r.json.error && r.json.error.code === -32602, 'unknown tool → -32602');

r = await rpc('tools/list', {}, { headers: { 'MCP-Protocol-Version': '1999-01-01' } });
ok(r.status === 400, 'unsupported MCP-Protocol-Version header → 400');

r = await rpc('tools/list', {}, { headers: { Origin: 'https://evil.example' } });
ok(r.status === 403, 'foreign Origin is rejected (DNS-rebinding protection)');

r = await rpc('tools/list', {}, { headers: { Accept: 'text/event-stream' } });
ok(r.status === 200 && r.headers.get('content-type').includes('text/event-stream') && r.text.startsWith('event: message'), 'SSE-only Accept gets an event stream response');

r = await fetch(base + '/mcp', { method: 'GET', headers: { 'Mcp-Session-Id': sid } });
ok(r.status === 405, 'GET /mcp → 405 (no server-initiated stream)');

r = await fetch(base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': sid }, body: '{bad json' });
ok(r.status === 400, 'malformed JSON → 400');

console.log('\nTools');
r = await call('calculate', { expression: '245 * 18' });
ok(r.json.result.structuredContent.value === 4410, 'calculate 245*18 = 4410');
r = await call('calculate', { expression: '(12+8)/5 - -2' });
ok(r.json.result.structuredContent.value === 6, 'calculate handles parentheses and unary minus');
r = await call('calculate', { expression: 'process.exit(1)' });
ok(r.json.result.isError === true, 'calculate rejects code (no eval)');
r = await call('calculate', { expression: '1/0' });
ok(r.json.result.isError === true, 'calculate rejects division by zero');
r = await call('calculate', {});
ok(r.json.result.isError === true && /missing required/.test(r.json.result.content[0].text), 'missing required arg → isError tool result');
r = await call('smart_home', { device: 'toaster', state: 'on' });
ok(r.json.result.isError === true, 'enum validation on smart_home.device');
r = await call('set_reminder', { text: 'x', minutes: 0 });
ok(r.json.result.isError === true, 'set_reminder rejects 0 minutes');

r = await call('add_todo', { item: 'Practice DSA' });
ok(r.json.result.structuredContent.pending === 1, 'add_todo');
await call('add_todo', { item: 'Read ISRO article' });
r = await call('list_todos', {});
ok(r.json.result.structuredContent.items.length === 2, 'list_todos shows 2');
r = await call('complete_todo', { item: '1' });
ok(r.json.result.structuredContent.found === true, 'complete_todo by number');
r = await call('list_todos', { lang: 'hi' });
ok(r.json.result.structuredContent.items.length === 1 && /टास्क/.test(r.json.result.content[0].text), 'list_todos in Hindi');

r = await call('smart_home', { device: 'fan', state: 'on' });
ok(r.json.result.structuredContent.devices.fan === true, 'smart_home turns fan on');
r = await call('track_topic', { topic: 'Newton laws' });
r = await call('get_progress', {});
ok(r.json.result.structuredContent.total === 1, 'track_topic + get_progress');
r = await call('space_fact', { topic: 'black hole', lang: 'hi' });
ok(/ब्लैक होल/.test(r.json.result.content[0].text), 'space_fact black hole (Hindi)');
r = await call('physics_explain', { concept: 'relativity' });
ok(/E = mc/.test(r.json.result.content[0].text), 'physics_explain relativity');
r = await call('quiz_me', { subject: 'cs' });
ok(r.json.result.structuredContent.options.length === 4, 'quiz_me returns 4 options');
r = await call('check_quiz_answer', { choice: 1 });
ok(typeof r.json.result.structuredContent.right === 'boolean', 'check_quiz_answer returns a verdict');
r = await call('check_quiz_answer', { choice: 1 });
ok(r.json.result.isError === true, 'check_quiz_answer with no pending quiz → isError');

console.log('\nReminders');
r = await call('set_reminder', { text: 'revise physics', minutes: 5, lang: 'en' });
state.reminders.forEach((x) => { x.due = Date.now() - 1000; });
let due = await (await fetch(base + '/api/due')).json();
ok(due.items.length === 1 && /revise physics/.test(due.items[0].message), 'due reminder is delivered by /api/due');
due = await (await fetch(base + '/api/due')).json();
ok(due.items.length === 0, 'reminder is delivered only once');

console.log('\nAgent (offline rules brain → real MCP calls)');
let a = await agent('10 मिनट बाद पढ़ाई याद दिलाओ');
ok(a.lang === 'hi' && a.trace[0].tool === 'set_reminder' && a.trace[0].args.minutes === 10, 'Hindi reminder → set_reminder(10)', JSON.stringify(a.trace));
a = await agent('Remind me in 2 hours to revise DSA');
ok(a.trace[0].args.minutes === 120 && /revise dsa/i.test(a.trace[0].args.text), 'English reminder, 2 hours = 120 min', JSON.stringify(a.trace[0]?.args));
a = await agent('Add DSA practice to my todo list');
ok(a.trace[0].tool === 'add_todo' && /DSA practice/i.test(a.trace[0].args.item), 'add to todo', JSON.stringify(a.trace[0]?.args));
a = await agent('लाइट चालू करो');
ok(a.trace[0].tool === 'smart_home' && a.state.devices.light === true, 'Hindi light on');
a = await agent('turn off the light');
ok(a.state.devices.light === false, 'light off');
a = await agent('245 * 18');
ok(/4410/.test(a.reply), 'calculator via agent');
a = await agent('ब्लैक होल के बारे में बताओ');
ok(a.trace[0].tool === 'space_fact' && /ब्लैक होल/.test(a.reply), 'Hindi space fact');
a = await agent('Explain relativity');
ok(a.trace[0].tool === 'physics_explain', 'English physics');
a = await agent('quiz me on physics');
ok(a.trace[0].tool === 'quiz_me' && a.state.quizPending, 'quiz starts');
a = await agent('b');
ok(a.trace[0].tool === 'check_quiz_answer' && a.trace[0].args.choice === 1, 'next message "b" answers the quiz');
a = await agent('आज मैंने न्यूटन के नियम पढ़ लिए');
ok(a.trace[0].tool === 'track_topic', 'Hindi study-completed → track_topic', JSON.stringify(a.trace[0]?.args));
a = await agent('आज का स्टडी प्लान बताओ');
ok(a.trace[0].tool === 'daily_plan' && /•/.test(a.reply), 'daily plan');
a = await agent('hello there');
ok(a.trace.length === 0 && /reminders/.test(a.reply), 'unknown → help text, no tool');

r = await (await fetch(base + '/api/tools')).json();
ok(r.tools.length === 18, '/api/tools mirrors tools/list');
const lg = await (await fetch(base + '/api/log?since=0')).json();
ok(lg.items.some((e) => e.dir === 'in' && e.body && e.body.method === 'tools/call') && lg.items.some((e) => e.dir === 'out' && e.http.startsWith('HTTP 200')), 'traffic log captured real JSON-RPC in/out');

console.log('\nSession end');
r = await fetch(base + '/mcp', { method: 'DELETE', headers: { 'Mcp-Session-Id': sid } });
ok(r.status === 200, 'DELETE ends the session');
r = await rpc('tools/list', {});
ok(r.status === 404, 'ended session → 404');

console.log(`\n${pass} passed, ${fail} failed`);
server.close();
process.exit(fail ? 1 : 0);
