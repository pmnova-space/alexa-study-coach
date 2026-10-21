// The "Alexa+ brain": an MCP client + two reasoning modes.
//  - Claude mode  (ANTHROPIC_API_KEY set): Claude chooses tools from the live tools/list and calls them over MCP.
//  - Rules mode   (default, offline): a bilingual intent router picks the tool. Still goes through real MCP.
import { LATEST } from './mcp.mjs';
import { state } from './tools.mjs';

/* ---------------- minimal MCP client (Streamable HTTP) ---------------- */
export class McpClient {
  constructor(url, token) { this.url = url; this.token = token; this.sid = null; this.id = 0; this.tools = null; this.version = null; }

  async post(msg) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.sid) { headers['Mcp-Session-Id'] = this.sid; headers['MCP-Protocol-Version'] = this.version || LATEST; }
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const r = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(msg) });
    const sid = r.headers.get('mcp-session-id');
    if (r.status === 404) { this.sid = null; this.tools = null; const e = new Error('session expired'); e.expired = true; throw e; }
    const text = await r.text();
    if (!text) return { status: r.status, sid, json: null };
    let json;
    if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
      const line = text.split('\n').find((l) => l.startsWith('data:'));
      json = line ? JSON.parse(line.slice(5)) : null;
    } else json = JSON.parse(text);
    return { status: r.status, sid, json };
  }

  async ensure() {
    if (this.sid && this.tools) return;
    const init = await this.post({ jsonrpc: '2.0', id: ++this.id, method: 'initialize', params: { protocolVersion: LATEST, capabilities: {}, clientInfo: { name: 'alexa-plus-sim', title: 'Simulated Alexa+', version: '1.0.0' } } });
    if (!init.json || init.json.error) throw new Error('initialize failed: ' + JSON.stringify(init.json));
    this.sid = init.sid; this.version = init.json.result.protocolVersion;
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await this.post({ jsonrpc: '2.0', id: ++this.id, method: 'tools/list' });
    this.tools = list.json.result.tools;
  }

  async callTool(name, args, retry = true) {
    try {
      await this.ensure();
      const r = await this.post({ jsonrpc: '2.0', id: ++this.id, method: 'tools/call', params: { name, arguments: args } });
      if (r.json.error) return { content: [{ type: 'text', text: r.json.error.message }], isError: true };
      return r.json.result;
    } catch (e) {
      if (e.expired && retry) return this.callTool(name, args, false);
      throw e;
    }
  }
}

/* ---------------- language ---------------- */
export function detectLang(t, pref = 'auto') {
  if (pref === 'hi' || pref === 'en') return pref;
  if (/[ऀ-ॿ]/.test(t)) return 'hi';
  if (/\b(mujhe|mera|meri|kya|batao|bata|karo|kar do|yaad|dila|dikhao|chalu|band|kitna|padhai|baad|kaise)\b/i.test(t)) return 'hi';
  return 'en';
}

/* ---------------- rules brain ---------------- */
const num = (t) => { const m = t.match(/(\d+(\.\d+)?)/); return m ? parseFloat(m[1]) : null; };
function minutesFrom(t) {
  let m = 0, f = false;
  const h = t.match(/(\d+)\s*(hour|hours|hr|hrs|घंटे|घंटा|ghante|ghanta)/i); if (h) { m += parseInt(h[1], 10) * 60; f = true; }
  const mi = t.match(/(\d+)\s*(min|mins|minute|minutes|मिनट|minat)/i); if (mi) { m += parseInt(mi[1], 10); f = true; }
  return f ? m : null;
}

export function plan(rawIn, lang, quizPending) {
  const raw = String(rawIn).normalize('NFD'); // speech/keyboards may send precomposed nukta letters
  const t = raw.toLowerCase().replace(/^(alexa|एलेक्सा|अलेक्सा)[,\s]*/, '').trim();
  const L = { lang };
  if (quizPending) {
    const m = t.match(/^(?:option\s*|ऑप्शन\s*)?([a-d1-4])\b/i);
    if (m) { const c = 'abcd'.indexOf(m[1].toLowerCase()); return { why: 'A quiz is pending, so this message is treated as the answer.', steps: [['check_quiz_answer', { choice: c >= 0 ? c : parseInt(m[1], 10) - 1, ...L }]] }; }
  }
  if (/(remind|reminder|yaad|याद|रिमाइंड)/.test(t)) {
    if (/(show|list|my|pending|कौन|दिखा|बाकी)/.test(t) && !/\d/.test(t)) return { why: "'reminder' + list words → list_reminders.", steps: [['list_reminders', L]] };
    const mins = minutesFrom(t) ?? 10;
    let txt = t.replace(/(\d+)\s*(hour|hours|hr|hrs|घंटे|घंटा|ghante|min|mins|minute|minutes|मिनट)/g, ' ').replace(/(remind me|remind|reminder|yaad dila|yaad dilao|याद दिलाओ|याद दिला|रिमाइंड|बाद|में|after|in|to|कि|के लिए|ke liye|करो|set)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!txt) txt = lang === 'hi' ? 'पढ़ाई करना' : 'study';
    return { why: `'remind' → set_reminder (${mins} min).`, steps: [['set_reminder', { text: txt, minutes: mins, ...L }]] };
  }
  if (/(timer|pomodoro|focus|टाइमर|फोकस)/.test(t)) return { why: 'Timer/focus → start_focus_timer.', steps: [['start_focus_timer', { minutes: minutesFrom(t) || num(t) || 25, ...L }]] };
  if (/(light|lights|बत्ती|लाइट|\bfan\b|पंखा|पंखे|\bac\b|एसी)/.test(t)) {
    const device = /(fan|पंखा|पंखे)/.test(t) ? 'fan' : /(\bac\b|एसी)/.test(t) ? 'ac' : 'light';
    const on = /(\bon\b|चालू|ऑन|चला|जला|खोल|start)/.test(t); const off = /(\boff\b|बंद|ऑफ|बुझा|stop)/.test(t);
    return { why: 'Device keyword → smart_home.', steps: [['smart_home', { device, state: off && !on ? 'off' : 'on', ...L }]] };
  }
  if (/(done|complete|completed|finished|हो गया|पूरा)/.test(t) && /(todo|to-do|task|टास्क)/.test(t)) {
    const item = t.replace(/(mark|task|todo|to-do|as|done|completed|complete|finished|हो गया|पूरा|टास्क|नंबर|number|my|the)/g, ' ').replace(/\s+/g, ' ').trim() || '1';
    return { why: 'task + done → complete_todo.', steps: [['complete_todo', { item, ...L }]] };
  }
  if (/(add|जोड़|ऐड)/.test(t) && /(todo|to-do|task|list|टास्क|लिस्ट|काम)/.test(t)) {
    let item = raw.replace(/^(alexa|एलेक्सा)[,\s]*/i, '').replace(/\b(add|to my|to-do|todo|task|list|in|please)\b|मेरी|मेरे|में|जोड़ो|जोड़ दो|जोड़|ऐड करो|ऐड|टास्क|लिस्ट/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!item) item = 'new task';
    return { why: "'add' + list → add_todo.", steps: [['add_todo', { item, ...L }]] };
  }
  if (/(todo|to-do|task|टास्क|लिस्ट|my list)/.test(t)) return { why: 'List request → list_todos.', steps: [['list_todos', L]] };
  if (/(progress|प्रगति|कितना पढ़ा|kitna padha)/.test(t)) return { why: 'Progress → get_progress.', steps: [['get_progress', L]] };
  if (/(padh liya|पढ़ (लिया|ली|लिए|लिये)|पढ़ा|completed|finished|studied|done with|खत्म)/.test(t)) {
    const topic = t.replace(/\b(i have|i|just|studied|finished|completed|done with|padh liya)\b|पढ़ (लिया|ली|लिए|लिये)|मैंने|आज का|आज|पढ़ा|खत्म|कर लिया|कर ली|\./g, ' ').replace(/\s+/g, ' ').trim() || 'general study';
    return { why: 'Study-completed phrase → track_topic.', steps: [['track_topic', { topic, ...L }]] };
  }
  if (/(plan|schedule|routine|roadmap|प्लान|रूटीन|टाइमटेबल|टाइम टेबल)/.test(t)) return { why: 'Plan → daily_plan.', steps: [['daily_plan', { hours: num(t) || 6, ...L }]] };
  if (/(quiz|test me|क्विज|सवाल पूछ)/.test(t)) {
    const subject = /(physics|फिजिक्स|भौतिकी)/.test(t) ? 'physics' : /(data|डेटा|stat)/.test(t) ? 'data' : /(cs|dsa|coding|कोडिंग|computer)/.test(t) ? 'cs' : undefined;
    return { why: 'Quiz → quiz_me (answer expected next turn).', steps: [['quiz_me', { ...(subject ? { subject } : {}), ...L }]] };
  }
  if (/(weather|मौसम|temperature|तापमान)/.test(t)) {
    const m = t.match(/(?:in|at)\s+([a-z ]+)/i) || t.match(/([ऀ-ॿ]+)\s*(?:का|की)\s*मौसम/);
    return { why: 'Weather → get_weather (mock).', steps: [['get_weather', { ...(m ? { city: m[1].trim() } : {}), ...L }]] };
  }
  if (/(physics|newton|relativity|quantum|entropy|gravity|फिजिक्स|भौतिकी|न्यूटन|गुरुत्व|क्वांटम|आपेक्ष|एन्ट्रॉपी)/.test(t)) return { why: 'Physics keyword → physics_explain.', steps: [['physics_explain', { concept: t, ...L }]] };
  if (/(space|planet|black hole|isro|chandrayaan|moon|mars|galaxy|milky|\bsun\b|अंतरिक्ष|ग्रह|ब्लैक|चाँद|चांद|चंद्र|मंगल|इसरो|आकाशगंगा|सूरज|सूर्य)/.test(t)) return { why: 'Space keyword → space_fact.', steps: [['space_fact', { topic: t, ...L }]] };
  if (/(\d+\s*[+\-*/x×÷%]\s*\d+|calculate|calc|plus|minus|कितना होता|गुणा)/.test(t)) {
    const ex = t.replace(/plus/g, '+').replace(/minus/g, '-').replace(/times|multiplied by|गुणा/g, '*').replace(/divided by|भाग/g, '/').replace(/[^0-9+\-*/().%x×÷\s]/g, '').trim();
    return { why: 'Arithmetic → calculate.', steps: [['calculate', { expression: ex }]] };
  }
  if (/(time|date|समय|टाइम|तारीख|कितने बजे)/.test(t)) return { why: 'Time/date → get_time.', steps: [['get_time', {}]] };
  return { why: 'No tool matched → help.', steps: [] };
}

const HELP = {
  hi: 'मैं ये कर सकती हूँ:\n• रिमाइंडर / फोकस टाइमर\n• टू-डू लिस्ट और पढ़ाई का प्रोग्रेस\n• डेली स्टडी प्लान\n• फिजिक्स और अंतरिक्ष के तथ्य\n• क्विज़, कैलकुलेशन\n• लाइट / पंखा / AC (सिम्युलेटेड)\n• मौसम (नकली डेटा) और समय\nकोई एक आज़माओ!',
  en: 'I can help with:\n• reminders and focus timers\n• to-dos and study progress\n• a daily study plan\n• physics and space facts\n• quizzes and calculations\n• light / fan / AC (simulated)\n• weather (mock data) and time\nTry one!',
};

async function rulesBrain({ text, lang }, mcp) {
  const p = plan(text, lang, state.quiz != null);
  const trace = []; const parts = [];
  for (const [name, args] of p.steps) {
    const result = await mcp.callTool(name, args);
    trace.push({ tool: name, args, isError: !!result.isError, structured: result.structuredContent ?? null });
    parts.push(result.content?.[0]?.text ?? '');
  }
  return { reply: p.steps.length ? parts.join('\n') : HELP[lang], trace, why: p.why, brain: 'rules' };
}

/* ---------------- Claude brain ---------------- */
const SYSTEM = (lang) => `You are Alexa+, a warm, concise voice assistant acting as a study coach for a B.Sc Computer Science and Data Analysis student. Use the provided tools for anything they cover; never invent reminders, to-dos, weather or live data. Weather is mock data, say so. Reply in the user's language (${lang === 'hi' ? 'Hindi, Devanagari' : 'English'}); when you call a tool that has a "lang" argument pass "${lang}". Keep replies short enough to be spoken aloud (under three sentences unless listing). After a quiz question, treat the next A/B/C/D message as the answer via check_quiz_answer.`;

async function claudeBrain({ text, lang, history }, mcp) {
  await mcp.ensure();
  const tools = mcp.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const messages = [...(history || []).slice(-10).filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content).map((h) => ({ role: h.role, content: String(h.content) })), { role: 'user', content: text }];
  const trace = [];
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
  for (let i = 0; i < 6; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, system: SYSTEM(lang), tools, messages }),
    });
    if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    messages.push({ role: 'assistant', content: j.content });
    if (j.stop_reason !== 'tool_use') {
      return { reply: j.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), trace, why: `Claude (${model}) chose ${trace.length} tool call(s).`, brain: 'claude' };
    }
    const results = [];
    for (const b of j.content.filter((x) => x.type === 'tool_use')) {
      const res = await mcp.callTool(b.name, b.input);
      trace.push({ tool: b.name, args: b.input, isError: !!res.isError, structured: res.structuredContent ?? null });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: res.content?.[0]?.text ?? '', is_error: !!res.isError });
    }
    messages.push({ role: 'user', content: results });
  }
  throw new Error('too many tool rounds');
}

export function brainMode() { return process.env.ANTHROPIC_API_KEY ? 'claude' : 'rules'; }

export async function runAgent({ text, history, langPref }, mcp) {
  const lang = detectLang(text, langPref);
  await mcp.ensure();
  if (process.env.ANTHROPIC_API_KEY) {
    try { return { lang, ...(await claudeBrain({ text, lang, history }, mcp)) }; }
    catch (e) { const r = await rulesBrain({ text, lang }, mcp); return { lang, ...r, why: `Claude call failed (${e.message}); used offline rules. ${r.why}` }; }
  }
  return { lang, ...(await rulesBrain({ text, lang }, mcp)) };
}
