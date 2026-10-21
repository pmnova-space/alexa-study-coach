// Prakash Study Coach — self-hosted MCP server + simulated Alexa+ web experience.
// Run: node server.mjs   → http://127.0.0.1:3000  (MCP endpoint: /mcp)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMcp, trafficLog, originAllowed, sessionCount, SERVER_INFO, LATEST } from './lib/mcp.mjs';
import { McpClient, runAgent, brainMode } from './lib/brain.mjs';
import { takeDue, snapshot, flushSave } from './lib/tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.MCP_TOKEN || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

let internal = null; // MCP client used by the in-app agent (talks to our own /mcp over HTTP)

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 200_000) throw new Error('body too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    if (p === '/mcp') return await handleMcp(req, res, { token: TOKEN, allowedOrigins: ALLOWED_ORIGINS });
    if (p === '/healthz') return json(res, 200, { ok: true, server: SERVER_INFO, protocol: LATEST, sessions: sessionCount(), brain: brainMode() });

    if (p.startsWith('/api/')) {
      if (!originAllowed(req, ALLOWED_ORIGINS)) return json(res, 403, { error: 'forbidden origin' });
      if (p === '/api/agent' && req.method === 'POST') {
        const b = await readJson(req);
        const text = String(b.text || '').trim().slice(0, 500);
        if (!text) return json(res, 400, { error: 'text required' });
        const out = await runAgent({ text, history: b.history, langPref: b.lang }, internal);
        return json(res, 200, { ...out, state: snapshot() });
      }
      if (p === '/api/state') { await internal.ensure().catch(() => {}); return json(res, 200, { ...snapshot(), session: internal.sid, protocol: internal.version, brain: brainMode(), server: SERVER_INFO, sessions: sessionCount() }); }
      if (p === '/api/due') return json(res, 200, { items: takeDue() });
      if (p === '/api/tools') { await internal.ensure(); return json(res, 200, { tools: internal.tools }); }
      if (p === '/api/log') { const since = parseInt(url.searchParams.get('since') || '0', 10); return json(res, 200, { items: trafficLog.filter((e) => e.id > since).slice(-60), last: trafficLog.length ? trafficLog[trafficLog.length - 1].id : 0 }); }
      if (p === '/api/skill') { res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); return res.end(fs.readFileSync(path.join(here, 'skills', 'prakash-study-coach', 'SKILL.md'))); }
      return json(res, 404, { error: 'not found' });
    }

    // static files
    let rel = p === '/' ? '/index.html' : p;
    const file = path.normalize(path.join(here, 'public', rel));
    if (!file.startsWith(path.join(here, 'public'))) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: e.message }); else res.end();
  }
});

export function start(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = server.address().port;
      internal = new McpClient(`http://127.0.0.1:${actual}/mcp`, TOKEN);
      resolve(actual);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  start().then((port) => {
    console.log(`\n  Prakash Study Coach — MCP server ready`);
    console.log(`  Web (simulated Alexa+):  http://${HOST}:${port}/`);
    console.log(`  MCP endpoint:            http://${HOST}:${port}/mcp   (Streamable HTTP, spec ${LATEST})`);
    console.log(`  Brain: ${brainMode() === 'claude' ? 'Claude via Anthropic API' : 'offline rules (set ANTHROPIC_API_KEY for Claude)'}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !TOKEN) console.log('  WARNING: bound to a public interface without MCP_TOKEN. Set MCP_TOKEN and ALLOWED_ORIGINS.');
    console.log('');
  });
  const bye = () => { flushSave(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
