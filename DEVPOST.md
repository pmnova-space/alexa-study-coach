# Devpost submission kit — Prakash Study Coach

Deadline: **Oct 23, 2026, 12:00 PM PDT** (= Oct 24, 12:30 AM IST). Submit early.
Track: **Alexa+**. Optional mini challenge: **Open Source** (MIT, new project built in the window). Do **not** enter AWS Builder unless you add a documented AWS service.

---

## 1. Project name and tagline

**Prakash Study Coach**
A bilingual (Hindi + English) voice study coach for Alexa+, delivered as a self-hosted MCP server, an Agent Skill, and a simulated Alexa+ experience.

## 2. Text description (paste into Devpost)

### Inspiration
Most students in India study in a mix of Hindi and English, but voice assistants handle that mix poorly, and study tools live in separate apps. I wanted a coach I can simply talk to: "10 मिनट बाद पढ़ाई याद दिलाओ", "explain relativity", "क्विज़ लो", and have it actually remember my tasks and progress.

### What it does
Prakash Study Coach exposes 18 tools over MCP so Alexa+ (or any MCP client) can:
- set spoken reminders and Pomodoro focus timers that really fire later,
- manage a to-do list and log studied topics with a progress summary,
- build a daily study plan for a B.Sc Computer Science and Data Analysis student,
- explain physics concepts and share space / ISRO facts,
- run multiple-choice quizzes (the next "A/B/C/D" is treated as the answer),
- calculate safely (own parser, no eval) and control simulated lights, fan and AC.

Every tool replies in Hindi or English depending on the user. An included **Agent Skill** (`SKILL.md`) teaches an agent when to call each tool and how to keep replies short enough to be spoken.

### How I built it
- **Self-hosted MCP server, Streamable HTTP, spec 2025-11-25**, written from the protocol with no dependencies: `initialize` with version negotiation and `Mcp-Session-Id`, `ping`, `tools/list`, `tools/call`, session termination via `DELETE`, `Origin` validation against DNS rebinding, optional bearer token, tool errors reported as `isError` results.
- **Simulated Alexa+ web experience**: an Echo-style device (listening / thinking / speaking ring), voice in via the Web Speech API and voice out via speech synthesis, plus a live panel showing the **real** JSON-RPC traffic between the agent and the server.
- **Agent brain with two modes**: Claude (via the Anthropic API) chooses tools from the live `tools/list`; a bilingual offline intent router works without any key. Both call tools through real MCP over HTTP.
- **Tested end to end**: a 55-check smoke test starts the server and speaks MCP to it (protocol, validation, security, every tool, the agent in Hindi and English).

### Challenges
Making Hindi intent handling robust (Devanagari normalization, Hinglish phrases), keeping reminders real on a stateless-feeling voice device (server timers plus a polled `get_due_reminders` tool), and keeping replies short enough for speech.

### Accomplishments I'm proud of
A complete, protocol-faithful MCP server that runs with a single `node server.mjs`, a working Agent Skill, and a demo where judges can watch each voice command turn into an actual `tools/call`.

### What I learned
How MCP sessions, protocol-version negotiation and Origin checks work in Streamable HTTP, and how to design tool descriptions and a skill so an agent picks the right tool in two languages.

### What's next
Deploy behind HTTPS and register with Alexa+ using the official developer tooling, add OAuth for per-student accounts, and a real study-analytics view (streaks, weak topics).

### Honest scope note
Weather is mock data and smart-home devices are simulated. This submission demonstrates the MCP server and the simulated Alexa+ path; it does not claim a deployed Alexa+ skill.

## 3. If the project existed before the hackathon
> Replace with the truth. Suggested wording if accurate: "The project was started and completed during the submission window. A first browser-only prototype (simulated MCP inside one HTML file) was built on Oct 21, 2026; during the window I replaced it with a real MCP server over HTTP, added sessions and security, the Agent Skill, the Claude/offline brain, the test suite and this submission."
> Confirm the exact window dates on the hackathon page.

## 4. Demo video script (under 3:00, English, public on YouTube/Vimeo)

| Time | Show | Say (short) |
|---|---|---|
| 0:00–0:15 | Title card, then the web app | "Hi, I'm Prakash, a CS and data analysis student. This is Prakash Study Coach, a self-hosted MCP server for Alexa+, with an Agent Skill and a simulated Alexa+ experience." |
| 0:15–0:35 | Terminal: `node server.mjs`, then `npm test` showing 55 passed | "One command starts a real MCP server, Streamable HTTP, spec 2025-11-25. Tests talk to it over the real protocol." |
| 0:35–1:20 | Click mic or type: "10 मिनट बाद पढ़ाई याद दिलाओ". Show **MCP Traffic** tab: initialize, tools/list, tools/call | "Each voice command becomes real JSON-RPC: initialize, a session id, then tools/call. Here the agent chose set_reminder in Hindi." |
| 1:20–1:50 | "Add DSA practice to my todo list", "लाइट चालू करो" (device chip lights up), "245 * 18" | "To-dos persist on the server. Smart home is simulated. The calculator uses its own parser, no eval." |
| 1:50–2:15 | "क्विज़ लो" then answer "b"; "ब्लैक होल के बारे में बताओ" | "Quiz state lives on the server; the next A/B/C/D answers it. Replies follow the user's language." |
| 2:15–2:35 | Start a 1-minute reminder and show it firing with voice, or show **SKILL.md** tab | "Reminders really fire later. The Agent Skill tells any agent when to call each tool." |
| 2:35–2:55 | Show **Connect** tab, MCP Inspector listing the 18 tools, GitHub repo + MIT license | "Any MCP client can connect. Open source, MIT. Thanks!" |

Tips: record at 1080p, keep the browser zoom large, lead with the best material, no copyrighted music.

## 5. Product feedback (write this yourself from your real experience)

Devpost requires feedback on **every tool, API or SDK you actually used**. Answer honestly for each one you used (MCP spec / Streamable HTTP, Alexa+ developer tooling or simulator if you used it, the Anthropic API if you enabled the Claude brain, Web Speech API, etc.):

1. What did you use it for?
2. What worked well?
3. What needs work?
4. How did onboarding feel (docs, examples, time to first success)?
5. Would you build with it again, and why?

Only mention a tool if you really used it. If you did not use any AWS service, say so.

### Optional friction log (up to +10% judging bonus)
One entry per problem you really hit:

```
Tool/API:
Task I attempted:
Steps I took:
Expected vs actual:
Severity (blocker / major / minor):
Workaround:
Suggestion:
```

### Optional feature requests
What you want built, why it matters, urgency (critical / important / nice-to-have).

## 6. Submission checklist

- [ ] Devpost account created and registered for the hackathon
- [ ] GitHub repo created with **all** source, assets and run instructions
- [ ] Repo is **public with the LICENSE file** (done: MIT) **or** private and shared with the five reviewers listed on the hackathon page (knmeiss, giolaq, anishamalde, mosesroth, emersonsklar). Invitations expire in 7 days, add them at submission time
- [ ] Put your full legal name in `LICENSE` (currently "Prakash")
- [ ] README opens with how to run (`node server.mjs`) and states what is simulated
- [ ] Demo video under 3 minutes, public, English, uploaded to YouTube or Vimeo
- [ ] Text description pasted (section 2)
- [ ] Product feedback written from your real experience (section 5)
- [ ] Track selected: Alexa+. Optional mini challenge: Open Source (needs repo URL, your GitHub username, short description)
- [ ] Re-read the official Rules page once before submitting
