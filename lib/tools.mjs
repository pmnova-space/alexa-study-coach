// Tool definitions + state for the Prakash Study Coach MCP server.
// Every tool returns { text, data }. `text` is what an assistant should say; `data` is structuredContent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || path.join(here, '..', 'data.json');

/* ---------------- persistent state ---------------- */
function load() {
  const d = { todos: [], topics: [], reminders: [], devices: { light: false, fan: false, ac: false }, quiz: null, nextId: 1 };
  try { Object.assign(d, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch { /* first run */ }
  return d;
}
export const state = load();
let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch { /* read-only fs is fine */ } }, 150);
}
export function flushSave() { clearTimeout(saveTimer); try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2)); } catch { /* ignore */ } }

const T = (lang, en, hi) => (lang === 'hi' ? hi : en);
const LANG = { type: 'string', enum: ['en', 'hi'], description: 'Language of the spoken reply text: "hi" for Hindi, "en" for English (default en).' };
const secsLeft = (r) => Math.max(0, Math.ceil((r.due - Date.now()) / 1000));

/* ---------------- content banks ---------------- */
const SPACE = {
  blackhole: { en: "A black hole is a region where gravity is so strong that even light can't escape. Its boundary is the event horizon. The first image of one (M87*) was released in 2019.", hi: 'ब्लैक होल अंतरिक्ष का वह हिस्सा है जहाँ गुरुत्वाकर्षण इतना तेज़ है कि प्रकाश भी बाहर नहीं निकल पाता। इसकी सीमा को इवेंट होराइज़न कहते हैं। 2019 में पहली बार M87* की तस्वीर आई थी।' },
  mars: { en: 'Mars has Olympus Mons, the tallest volcano in the solar system at about 22 km high. A day there lasts 24 hours 37 minutes.', hi: 'मंगल ग्रह पर ओलिंपस मॉन्स है, जो सौर मंडल का सबसे ऊँचा ज्वालामुखी है (लगभग 22 किमी)। वहाँ एक दिन 24 घंटे 37 मिनट का होता है।' },
  moon: { en: "India's Chandrayaan-3 landed near the Moon's south pole in August 2023, a first for any country. The Moon drifts about 3.8 cm farther from Earth every year.", hi: 'भारत का चंद्रयान-3 अगस्त 2023 में चाँद के दक्षिणी ध्रुव के पास उतरा। ऐसा करने वाला भारत पहला देश बना। चाँद हर साल लगभग 3.8 सेमी पृथ्वी से दूर जा रहा है।' },
  sun: { en: "The Sun holds 99.86% of the solar system's mass. Its light takes about 8 minutes 20 seconds to reach Earth.", hi: 'सौर मंडल के कुल द्रव्यमान का 99.86% हिस्सा सूरज में है। सूरज की रोशनी को पृथ्वी तक पहुँचने में लगभग 8 मिनट 20 सेकंड लगते हैं।' },
  galaxy: { en: 'The Milky Way has 100 to 400 billion stars. The Andromeda galaxy is approaching us and may merge with the Milky Way in about 4 to 5 billion years.', hi: 'हमारी आकाशगंगा में 100 से 400 अरब तारे हैं। एंड्रोमेडा आकाशगंगा हमारी ओर आ रही है और लगभग 4 से 5 अरब साल में हमसे मिल सकती है।' },
  isro: { en: 'In February 2017 ISRO launched 104 satellites on a single PSLV rocket, a world record at that time.', hi: 'फरवरी 2017 में इसरो ने एक ही PSLV रॉकेट से 104 सैटेलाइट छोड़े थे। उस समय यह विश्व रिकॉर्ड था।' },
};
const SPACE_ALIAS = { black: 'blackhole', 'ब्लैक': 'blackhole', 'मंगल': 'mars', 'चाँद': 'moon', 'चांद': 'moon', 'चंद्र': 'moon', 'सूरज': 'sun', 'सूर्य': 'sun', 'आकाशगंगा': 'galaxy', milky: 'galaxy', 'इसरो': 'isro', chandrayaan: 'moon' };
const PHYS = {
  newton: { en: "Newton's laws: (1) an object keeps its state of motion unless a force acts on it; (2) F equals m times a; (3) every action has an equal and opposite reaction.", hi: 'न्यूटन के नियम: (1) बल न लगे तो वस्तु अपनी गति की अवस्था नहीं बदलती; (2) F = m·a; (3) हर क्रिया की बराबर और विपरीत प्रतिक्रिया होती है।' },
  relativity: { en: 'Special relativity: the speed of light is the same for every observer, so at high speed time slows down and lengths contract. The famous result is E = mc squared.', hi: 'विशेष आपेक्षिकता: प्रकाश की चाल सभी प्रेक्षकों के लिए समान रहती है, इसलिए तेज़ गति पर समय धीमा और लंबाई कम हो जाती है। प्रसिद्ध समीकरण: E = mc²।' },
  quantum: { en: "In quantum mechanics particles also behave like waves and we can only predict probabilities. Heisenberg's principle says position and momentum can't both be known perfectly.", hi: 'क्वांटम यांत्रिकी में कण तरंग की तरह भी व्यवहार करते हैं और हम सिर्फ़ संभावनाएँ बता सकते हैं। हाइज़ेनबर्ग: स्थिति और संवेग दोनों एक साथ पूरी सटीकता से नहीं जाने जा सकते।' },
  entropy: { en: 'Entropy measures disorder. The second law says the total entropy of an isolated system never decreases, which gives time its direction.', hi: 'एन्ट्रॉपी अव्यवस्था की माप है। दूसरे नियम के अनुसार अलग-थलग तंत्र की कुल एन्ट्रॉपी कभी घटती नहीं। इसी से समय की दिशा तय होती है।' },
  gravity: { en: "Newton: F equals G m1 m2 over r squared. Einstein: gravity is the curvature of spacetime caused by mass and energy.", hi: 'न्यूटन: F = G·m1·m2 / r²। आइंस्टीन: गुरुत्वाकर्षण द्रव्यमान और ऊर्जा से बनी दिक्-काल की वक्रता है।' },
};
const PHYS_ALIAS = { 'न्यूटन': 'newton', 'आपेक्ष': 'relativity', einstein: 'relativity', 'क्वांटम': 'quantum', 'एन्ट्रॉपी': 'entropy', 'गुरुत्व': 'gravity' };
const QUIZ = [
  { s: 'cs', q: { en: 'What is the time complexity of binary search?', hi: 'बाइनरी सर्च की टाइम कॉम्प्लेक्सिटी क्या है?' }, o: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], a: 1, e: { en: 'It halves the search space at every step.', hi: 'यह हर कदम पर खोज का दायरा आधा कर देता है।' } },
  { s: 'cs', q: { en: 'Which data structure follows LIFO?', hi: 'कौन सा डेटा स्ट्रक्चर LIFO पर चलता है?' }, o: ['Queue', 'Stack', 'Heap', 'Graph'], a: 1, e: { en: 'Stack: last in, first out.', hi: 'स्टैक: जो आख़िर में आया वही पहले निकलता है।' } },
  { s: 'physics', q: { en: "About what is Earth's escape velocity?", hi: 'पृथ्वी का पलायन वेग लगभग कितना है?' }, o: ['7.9 km/s', '11.2 km/s', '3 km/s', '29.8 km/s'], a: 1, e: { en: 'About 11.2 km/s.', hi: 'लगभग 11.2 किमी/सेकंड।' } },
  { s: 'data', q: { en: 'Which measure is the middle value of sorted data?', hi: 'क्रम में रखे डेटा का बीच वाला मान क्या कहलाता है?' }, o: ['Mean', 'Mode', 'Median', 'Range'], a: 2, e: { en: 'The median.', hi: 'माध्यिका (Median)।' } },
  { s: 'data', q: { en: 'Which pandas function reads a CSV file?', hi: 'pandas का कौन सा फ़ंक्शन CSV फ़ाइल पढ़ता है?' }, o: ['pd.open_csv', 'pd.load()', 'pd.read_csv', 'pd.csv_read'], a: 2, e: { en: 'pd.read_csv().', hi: 'pd.read_csv()।' } },
  { s: 'physics', q: { en: 'What is the SI unit of force?', hi: 'बल का SI मात्रक क्या है?' }, o: ['Joule', 'Newton', 'Pascal', 'Watt'], a: 1, e: { en: 'Newton (N).', hi: 'न्यूटन (N)।' } },
];

function pickKey(t, bank, alias) {
  t = String(t || '').normalize('NFD').toLowerCase();
  for (const k of Object.keys(bank)) if (t.includes(k)) return k;
  for (const a of Object.keys(alias)) if (t.includes(a)) return alias[a];
  return null;
}

/* ---------------- safe calculator (no eval) ---------------- */
export function evalExpr(src) {
  const t = String(src).replace(/[x×]/gi, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  let i = 0;
  const peek = () => t[i];
  const num = () => { const m = /^\d+(\.\d+)?/.exec(t.slice(i)); if (!m) throw new Error('number expected'); i += m[0].length; return parseFloat(m[0]); };
  const factor = () => {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('")" expected'); i++; return v; }
    return num();
  };
  const term = () => { let v = factor(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = t[i++]; const r = factor(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = t[i++]; const r = term(); v = o === '+' ? v + r : v - r; } return v; };
  const v = expr();
  if (i !== t.length) throw new Error('unexpected character');
  return v;
}

/* ---------------- tool table ---------------- */
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const TOOLS = [
  {
    name: 'set_reminder', title: 'Set a reminder', annotations: RW,
    description: 'Set a spoken reminder that fires after N minutes (for example to study a topic).',
    inputSchema: obj({ text: { type: 'string', description: 'What to remind the student about.' }, minutes: { type: 'number', description: 'Minutes from now (1 to 10080).' }, lang: LANG }, ['text', 'minutes']),
    run({ text, minutes, lang }) {
      if (!(minutes >= 1 && minutes <= 10080)) throw new Error('minutes must be between 1 and 10080');
      const r = { id: state.nextId++, kind: 'reminder', text: String(text).slice(0, 200), due: Date.now() + minutes * 60000, delivered: false, lang: lang || 'en' };
      state.reminders.push(r); save();
      return { text: T(lang, `Okay, I'll remind you in ${minutes} minutes: ${r.text}.`, `ठीक है, ${minutes} मिनट बाद मैं तुम्हें याद दिलाऊँगी: ${r.text}।`), data: { id: r.id, text: r.text, minutes, dueAt: new Date(r.due).toISOString() } };
    },
  },
  {
    name: 'start_focus_timer', title: 'Start a focus timer', annotations: RW,
    description: 'Start a Pomodoro-style focus timer. Announces when time is up.',
    inputSchema: obj({ minutes: { type: 'number', description: 'Length in minutes (1 to 180). Default 25.' }, lang: LANG }),
    run({ minutes = 25, lang }) {
      if (!(minutes >= 1 && minutes <= 180)) throw new Error('minutes must be between 1 and 180');
      const r = { id: state.nextId++, kind: 'focus', text: 'focus', due: Date.now() + minutes * 60000, delivered: false, lang: lang || 'en' };
      state.reminders.push(r); save();
      return { text: T(lang, `Focus timer started for ${minutes} minutes. Stay locked in!`, `${minutes} मिनट का फोकस टाइमर शुरू। पूरा ध्यान पढ़ाई पर!`), data: { id: r.id, minutes, dueAt: new Date(r.due).toISOString() } };
    },
  },
  {
    name: 'list_reminders', title: 'List pending reminders', annotations: RO,
    description: 'List reminders and timers that have not fired yet.',
    inputSchema: obj({ lang: LANG }),
    run({ lang }) {
      const items = state.reminders.filter((r) => !r.delivered).map((r) => ({ id: r.id, kind: r.kind, text: r.text, secondsLeft: secsLeft(r) }));
      const line = items.map((r) => `${r.kind === 'focus' ? 'focus timer' : r.text} (${Math.ceil(r.secondsLeft / 60)} min)`).join(', ');
      return { text: items.length ? T(lang, `Pending: ${line}.`, `बाकी रिमाइंडर: ${line}।`) : T(lang, 'No pending reminders.', 'कोई रिमाइंडर बाकी नहीं है।'), data: { items } };
    },
  },
  {
    name: 'get_due_reminders', title: 'Collect due reminders', annotations: RW,
    description: 'Return reminders/timers whose time has come and mark them delivered. A device polls this to speak them aloud.',
    inputSchema: obj({}),
    run() { const items = takeDue(); return { text: items.length ? items.map((r) => r.message).join(' ') : 'Nothing due.', data: { items } }; },
  },
  {
    name: 'add_todo', title: 'Add a to-do', annotations: RW,
    description: 'Add a task to the student to-do list.',
    inputSchema: obj({ item: { type: 'string', description: 'Task text.' }, lang: LANG }, ['item']),
    run({ item, lang }) {
      const t = { id: state.nextId++, item: String(item).slice(0, 200), done: false };
      state.todos.push(t); save();
      const n = state.todos.filter((x) => !x.done).length;
      return { text: T(lang, `Added "${t.item}". You now have ${n} pending task${n === 1 ? '' : 's'}.`, `"${t.item}" लिस्ट में जोड़ दिया। अब ${n} टास्क बाकी हैं।`), data: { id: t.id, item: t.item, pending: n } };
    },
  },
  {
    name: 'list_todos', title: 'List to-dos', annotations: RO,
    description: 'List pending tasks.',
    inputSchema: obj({ lang: LANG }),
    run({ lang }) {
      const items = state.todos.filter((t) => !t.done);
      return { text: items.length ? T(lang, 'Your tasks: ', 'तुम्हारे टास्क: ') + items.map((t, i) => `${i + 1}. ${t.item}`).join('; ') : T(lang, 'Your list is empty.', 'लिस्ट खाली है।'), data: { items: items.map((t) => ({ id: t.id, item: t.item })) } };
    },
  },
  {
    name: 'complete_todo', title: 'Complete a to-do', annotations: RW,
    description: 'Mark a pending task as done, by its position number (1 = first pending) or by words from its text.',
    inputSchema: obj({ item: { type: 'string', description: 'Position number or part of the task text.' }, lang: LANG }, ['item']),
    run({ item, lang }) {
      const pending = state.todos.filter((t) => !t.done);
      const s = String(item).trim().toLowerCase();
      const byNum = /^\d+$/.test(s) ? pending[parseInt(s, 10) - 1] : null;
      const hit = byNum || pending.find((t) => t.item.toLowerCase().includes(s));
      if (!hit) return { text: T(lang, `I couldn't find a pending task matching "${item}".`, `"${item}" से मिलता कोई टास्क नहीं मिला।`), data: { found: false }, isError: true };
      hit.done = true; save();
      return { text: T(lang, `Marked "${hit.item}" as done.`, `"${hit.item}" पूरा हुआ।`), data: { found: true, item: hit.item } };
    },
  },
  {
    name: 'track_topic', title: 'Log a studied topic', annotations: RW,
    description: 'Record that the student finished studying a topic today.',
    inputSchema: obj({ topic: { type: 'string', description: 'Topic name, e.g. "Newton laws".' }, lang: LANG }, ['topic']),
    run({ topic, lang }) {
      state.topics.push({ topic: String(topic).slice(0, 120), at: new Date().toISOString() }); save();
      const total = state.topics.length;
      return { text: T(lang, `Nice! Logged "${topic}". Total topics so far: ${total}.`, `बढ़िया! "${topic}" पूरा हुआ। अब तक कुल ${total} टॉपिक हो गए।`), data: { topic, total } };
    },
  },
  {
    name: 'get_progress', title: 'Study progress', annotations: RO,
    description: 'Summarize completed topics and pending tasks.',
    inputSchema: obj({ lang: LANG }),
    run({ lang }) {
      const topics = state.topics.map((t) => t.topic); const pending = state.todos.filter((t) => !t.done).length;
      return { text: T(lang, `${topics.length} topic(s) done${topics.length ? ': ' + topics.slice(-8).join(', ') : ''}. ${pending} task(s) pending.`, `अब तक ${topics.length} टॉपिक पूरे हुए${topics.length ? ': ' + topics.slice(-8).join(', ') : ''}। ${pending} टास्क बाकी हैं।`), data: { total: topics.length, topics, pending } };
    },
  },
  {
    name: 'daily_plan', title: 'Daily study plan', annotations: RO,
    description: 'A daily study plan for a B.Sc Computer Science and Data Analysis student: physics, maths, DSA, data analysis, revision, space reading.',
    inputSchema: obj({ hours: { type: 'number', description: 'Total study hours (default 6).' }, lang: LANG }),
    run({ hours = 6, lang }) {
      const blocks = [['06:30-08:30', 'Physics + Maths', 'भौतिकी + गणित'], ['09:00-11:00', 'CS: DSA and coding practice', 'CS: DSA और कोडिंग'], ['15:00-16:30', 'Data analysis: Python, pandas, statistics', 'डेटा एनालिसिस: Python, pandas, सांख्यिकी'], ['19:00-20:00', 'Revision and notes', 'रिवीज़न और नोट्स'], ['21:00-21:30', 'Space reading (ISRO, astronomy)', 'अंतरिक्ष पढ़ाई (इसरो, खगोल)']];
      return { text: T(lang, `Plan for about ${hours} hours:\n`, `लगभग ${hours} घंटे का प्लान:\n`) + blocks.map((b) => `• ${b[0]}  ${lang === 'hi' ? b[2] : b[1]}`).join('\n'), data: { hours, blocks: blocks.map((b) => ({ time: b[0], en: b[1], hi: b[2] })) } };
    },
  },
  {
    name: 'space_fact', title: 'Space fact', annotations: RO,
    description: 'Tell an astronomy / space / ISRO fact. Topics: black hole, mars, moon (Chandrayaan), sun, galaxy, isro. Random if no topic.',
    inputSchema: obj({ topic: { type: 'string', description: 'Optional topic keyword.' }, lang: LANG }),
    run({ topic, lang }) {
      const k = pickKey(topic, SPACE, SPACE_ALIAS) || Object.keys(SPACE)[Math.floor(Math.random() * Object.keys(SPACE).length)];
      return { text: '🚀 ' + SPACE[k][lang === 'hi' ? 'hi' : 'en'], data: { topic: k, en: SPACE[k].en, hi: SPACE[k].hi } };
    },
  },
  {
    name: 'physics_explain', title: 'Explain physics', annotations: RO,
    description: 'Explain a physics concept briefly. Concepts: newton, relativity, quantum, entropy, gravity.',
    inputSchema: obj({ concept: { type: 'string', description: 'Concept keyword.' }, lang: LANG }),
    run({ concept, lang }) {
      const k = pickKey(concept, PHYS, PHYS_ALIAS) || Object.keys(PHYS)[Math.floor(Math.random() * Object.keys(PHYS).length)];
      return { text: '⚛️ ' + PHYS[k][lang === 'hi' ? 'hi' : 'en'], data: { concept: k, en: PHYS[k].en, hi: PHYS[k].hi } };
    },
  },
  {
    name: 'quiz_me', title: 'Start a quiz question', annotations: RW,
    description: 'Ask one multiple-choice question. The next user message that is A, B, C or D answers it via check_quiz_answer.',
    inputSchema: obj({ subject: { type: 'string', enum: ['cs', 'physics', 'data'], description: 'Optional subject.' }, lang: LANG }),
    run({ subject, lang }) {
      const pool = QUIZ.map((q, i) => ({ q, i })).filter((x) => !subject || x.q.s === subject);
      const pick = pool[Math.floor(Math.random() * pool.length)] || { q: QUIZ[0], i: 0 };
      state.quiz = pick.i; save();
      const q = pick.q;
      return { text: T(lang, 'Quiz time!\n', 'क्विज़ टाइम!\n') + q.q[lang === 'hi' ? 'hi' : 'en'] + '\n' + q.o.map((o, i) => `${'ABCD'[i]}) ${o}`).join('\n') + T(lang, '\nAnswer with A, B, C or D.', '\nजवाब बोलो: A, B, C या D।'), data: { index: pick.i, options: q.o } };
    },
  },
  {
    name: 'check_quiz_answer', title: 'Check quiz answer', annotations: RW,
    description: 'Check the answer to the pending quiz question. choice is 0 for A, 1 for B, 2 for C, 3 for D.',
    inputSchema: obj({ choice: { type: 'number', description: '0-3 (A-D).' }, lang: LANG }, ['choice']),
    run({ choice, lang }) {
      if (state.quiz == null) return { text: T(lang, "There's no quiz running. Say 'quiz me' to start one.", "अभी कोई क्विज़ नहीं चल रहा। 'क्विज़' बोलो।"), data: { pending: false }, isError: true };
      const q = QUIZ[state.quiz]; const right = choice === q.a; state.quiz = null; save();
      const ex = q.e[lang === 'hi' ? 'hi' : 'en'];
      return { text: right ? T(lang, 'Correct! 🎉 ', 'सही जवाब! 🎉 ') + ex : T(lang, `Not quite. The answer is ${q.o[q.a]}. `, `गलत। सही जवाब: ${q.o[q.a]}। `) + ex, data: { right, answer: q.o[q.a] } };
    },
  },
  {
    name: 'calculate', title: 'Calculator', annotations: RO,
    description: 'Evaluate an arithmetic expression with + - * / % and parentheses.',
    inputSchema: obj({ expression: { type: 'string', description: 'e.g. "245 * 18" or "(12+8)/5".' } }, ['expression']),
    run({ expression }) {
      if (!/^[\d+\-*/().%xX×÷\s]+$/.test(expression)) throw new Error('only numbers and + - * / % ( ) are allowed');
      const v = evalExpr(expression);
      if (!Number.isFinite(v)) throw new Error('result is not a finite number');
      const value = Math.round(v * 1e8) / 1e8;
      return { text: `${String(expression).trim()} = ${value}`, data: { expression, value } };
    },
  },
  {
    name: 'smart_home', title: 'Control a (simulated) device', annotations: RW,
    description: 'Turn a simulated home device on or off: light, fan or ac. Simulation only, no real hardware.',
    inputSchema: obj({ device: { type: 'string', enum: ['light', 'fan', 'ac'] }, state: { type: 'string', enum: ['on', 'off'] }, lang: LANG }, ['device', 'state']),
    run({ device, state: st, lang }) {
      state.devices[device] = st === 'on'; save();
      const n = { light: T(lang, 'light', 'लाइट'), fan: T(lang, 'fan', 'पंखा'), ac: 'AC' }[device];
      return { text: T(lang, `Turning ${st} the ${n}.`, `${n} ${st === 'on' ? 'चालू' : 'बंद'} कर दिया।`), data: { device, state: st, devices: { ...state.devices } } };
    },
  },
  {
    name: 'get_weather', title: 'Weather (simulated)', annotations: RO,
    description: 'Deterministic MOCK weather for a city. Not real data.',
    inputSchema: obj({ city: { type: 'string', description: 'City name (default Patna).' }, lang: LANG }),
    run({ city = 'Patna', lang }) {
      let h = 0; for (const c of city) h = (h * 31 + c.charCodeAt(0)) % 97;
      const en = ['Sunny', 'Partly cloudy', 'Hazy', 'Light rain'][h % 4]; const hi = ['धूप', 'आंशिक बादल', 'धुंध', 'हल्की बारिश'][h % 4]; const temp = 22 + (h % 14);
      return { text: T(lang, `${city}: about ${temp}°C, ${en} (simulated data).`, `${city} में लगभग ${temp}°C, ${hi} (सिम्युलेटेड डेटा)।`), data: { city, temp, condition: en, simulated: true } };
    },
  },
  {
    name: 'get_time', title: 'Current date and time', annotations: RO,
    description: 'Current date and time on the server (Asia/Kolkata unless TZ is set).',
    inputSchema: obj({ tz: { type: 'string', description: 'IANA time zone, default Asia/Kolkata.' } }),
    run({ tz = process.env.TZ || 'Asia/Kolkata' }) {
      let local; try { local = new Date().toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }); } catch { throw new Error('unknown time zone'); }
      return { text: local, data: { iso: new Date().toISOString(), local, tz } };
    },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

export function publicTools() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

/* minimal JSON-schema validation: required, type, enum */
export function validateArgs(schema, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  for (const k of schema.required || []) if (args[k] === undefined || args[k] === null || args[k] === '') return `missing required argument "${k}"`;
  for (const [k, v] of Object.entries(args)) {
    const p = schema.properties[k];
    if (!p) return `unknown argument "${k}"`;
    if (p.type === 'string' && typeof v !== 'string') return `"${k}" must be a string`;
    if (p.type === 'number' && (typeof v !== 'number' || Number.isNaN(v))) return `"${k}" must be a number`;
    if (p.enum && !p.enum.includes(v)) return `"${k}" must be one of ${p.enum.join(', ')}`;
  }
  return null;
}

/* Execute a tool and produce an MCP CallToolResult. Tool errors are reported with isError, not JSON-RPC errors. */
export async function callTool(name, args) {
  const tool = toolByName.get(name);
  if (!tool) return null;
  const bad = validateArgs(tool.inputSchema, args);
  if (bad) return { content: [{ type: 'text', text: `Invalid arguments: ${bad}` }], isError: true };
  try {
    const out = await tool.run(args || {});
    return { content: [{ type: 'text', text: out.text }], structuredContent: out.data, isError: !!out.isError };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

/* due reminders, shared by the tool and the device poll endpoint */
export function takeDue() {
  const now = Date.now(); const out = [];
  for (const r of state.reminders) {
    if (!r.delivered && r.due <= now) {
      r.delivered = true;
      const hi = r.lang === 'hi';
      out.push({ id: r.id, kind: r.kind, lang: r.lang, message: r.kind === 'focus' ? (hi ? 'फोकस टाइमर पूरा! थोड़ा ब्रेक लो।' : 'Focus timer done! Take a short break.') : (hi ? 'याद दिलाना था: ' : 'Reminder: ') + r.text });
    }
  }
  if (out.length) save();
  return out;
}

export function snapshot() {
  return {
    todos: state.todos.filter((t) => !t.done).map((t) => t.item),
    doneTodos: state.todos.filter((t) => t.done).length,
    topics: state.topics.map((t) => ({ topic: t.topic, at: t.at })),
    reminders: state.reminders.filter((r) => !r.delivered).map((r) => ({ id: r.id, kind: r.kind, text: r.text, secondsLeft: secsLeft(r) })),
    devices: { ...state.devices },
    quizPending: state.quiz != null,
  };
}
