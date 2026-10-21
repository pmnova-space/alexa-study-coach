// Dependency-free MCP server over Streamable HTTP (spec 2025-11-25).
// Implements: initialize (version negotiation + Mcp-Session-Id), notifications, ping,
// tools/list, tools/call, DELETE session termination, Origin validation, optional bearer token.
import crypto from 'node:crypto';
import { publicTools, callTool, toolByName } from './tools.mjs';

export const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST = SUPPORTED[0];
export const SERVER_INFO = { name: 'prakash-study-coach-mcp', title: 'Prakash Study Coach', version: '1.0.0' };
const INSTRUCTIONS = 'Study coach for a B.Sc Computer Science and Data Analysis student. Use the tools for reminders, focus timers, to-dos, progress, daily plans, physics and space facts, quizzes, a calculator and simulated smart-home control. Pass lang="hi" when the user speaks Hindi. Keep spoken replies short.';

const sessions = new Map();
export const sessionCount = () => sessions.size;

/* -------- traffic log (shown live in the web UI) -------- */
export const trafficLog = [];
let logSeq = 0;
function pushLog(dir, info) {
  trafficLog.push({ id: ++logSeq, t: Date.now(), dir, ...info });
  if (trafficLog.length > 200) trafficLog.shift();
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function originAllowed(req, allowed = []) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients send no Origin
  let host; try { host = new URL(origin).hostname; } catch { return false; }
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) return true;
  if (allowed.includes(origin)) return true;
  const reqHost = String(req.headers.host || '').replace(/:\d+$/, '');
  return host === reqHost && reqHost !== '';
}

function sendJson(res, status, obj, headers = {}) {
  const body = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
  return { status, body: obj, headers };
}

async function dispatch(msg, sessionId) {
  const { method, params, id } = msg;
  switch (method) {
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: publicTools() } };
    case 'tools/call': {
      const name = params && params.name;
      if (!name || !toolByName.has(name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const result = await callTool(name, params.arguments);
      return { jsonrpc: '2.0', id, result };
    }
    case 'logging/setLevel': return { jsonrpc: '2.0', id, result: {} };
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** Handle one HTTP request to /mcp. */
export async function handleMcp(req, res, opts = {}) {
  const sid = req.headers['mcp-session-id'];
  const logIn = { http: `${req.method} /mcp`, headers: pick(req.headers, ['mcp-session-id', 'mcp-protocol-version', 'accept', 'origin']) };
  const reply = (status, obj, headers = {}) => {
    const r = sendJson(res, status, obj, headers);
    pushLog('out', { http: `HTTP ${status}`, headers: pick(headers, ['Mcp-Session-Id', 'Content-Type']), body: obj });
    return r;
  };

  if (opts.token && (req.headers.authorization || '') !== `Bearer ${opts.token}`) {
    pushLog('in', logIn); return reply(401, rpcError(null, -32001, 'Unauthorized'), { 'WWW-Authenticate': 'Bearer' });
  }
  if (!originAllowed(req, opts.allowedOrigins)) { pushLog('in', logIn); return reply(403, rpcError(null, -32000, 'Forbidden origin')); }

  if (req.method === 'DELETE') {
    pushLog('in', logIn);
    if (!sid || !sessions.has(sid)) return reply(404, rpcError(null, -32001, 'Unknown session'));
    sessions.delete(sid); res.writeHead(200); res.end(); pushLog('out', { http: 'HTTP 200', headers: {}, body: null }); return;
  }
  if (req.method === 'GET') { // no server-initiated stream in this server
    pushLog('in', logIn); res.writeHead(405, { Allow: 'POST, DELETE' }); res.end(); pushLog('out', { http: 'HTTP 405', headers: { Allow: 'POST, DELETE' }, body: null }); return;
  }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST, DELETE' }); res.end(); return; }

  if (!String(req.headers['content-type'] || '').includes('application/json')) { pushLog('in', logIn); return reply(415, rpcError(null, -32600, 'Content-Type must be application/json')); }

  let raw; try { raw = await readBody(req); } catch (e) { return reply(413, rpcError(null, -32600, e.message)); }
  let body; try { body = JSON.parse(raw); } catch { pushLog('in', { ...logIn, body: raw.slice(0, 500) }); return reply(400, rpcError(null, -32700, 'Parse error')); }
  pushLog('in', { ...logIn, body });

  const msgs = Array.isArray(body) ? body : [body];
  if (!msgs.length || msgs.some((m) => !m || m.jsonrpc !== '2.0')) return reply(400, rpcError(null, -32600, 'Invalid Request'));

  const isInit = msgs.length === 1 && msgs[0].method === 'initialize';
  const ph = req.headers['mcp-protocol-version'];
  if (!isInit && ph && !SUPPORTED.includes(ph)) return reply(400, rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${ph}`));

  if (isInit) {
    const m = msgs[0];
    const asked = m.params && m.params.protocolVersion;
    const version = SUPPORTED.includes(asked) ? asked : LATEST;
    const newSid = crypto.randomUUID();
    sessions.set(newSid, { created: Date.now(), version, client: m.params && m.params.clientInfo });
    return reply(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS } }, { 'Mcp-Session-Id': newSid });
  }

  if (!sid) return reply(400, rpcError(null, -32600, 'Missing Mcp-Session-Id header (send initialize first)'));
  if (!sessions.has(sid)) return reply(404, rpcError(null, -32001, 'Session not found; re-initialize'));

  const out = [];
  for (const m of msgs) {
    if (m.method && m.id === undefined) continue; // notification
    if (!m.method) continue; // a response from the client; nothing to do
    try { out.push(await dispatch(m, sid)); } catch (e) { out.push(rpcError(m.id, -32603, e.message)); }
  }
  if (!out.length) { res.writeHead(202); res.end(); pushLog('out', { http: 'HTTP 202 Accepted', headers: {}, body: null }); return; }

  const payload = Array.isArray(body) ? out : out[0];
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Mcp-Session-Id': sid });
    res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    pushLog('out', { http: 'HTTP 200', headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': sid }, body: payload });
    return;
  }
  reply(200, payload, { 'Mcp-Session-Id': sid });
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) { const hit = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase()); if (hit && obj[hit] !== undefined) o[k] = obj[hit]; }
  return o;
}
