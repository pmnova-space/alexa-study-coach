# Prakash Study Coach — Alexa+ MCP server + Agent Skill

A self-hosted **MCP server** (Streamable HTTP, spec **2025-11-25**) that turns a voice assistant like Alexa+ into a bilingual (Hindi / English) study coach, plus an **Agent Skill** that teaches any agent how to use it, plus a **simulated Alexa+ web experience** that talks to the server over the real MCP protocol.

Built for the *Build, Ship, Shape: Amazon Developer Hackathon*, Alexa+ track.

**Zero dependencies.** Plain Node.js (>= 18). No `npm install` needed.

## Run it

```bash
node server.mjs
# open http://127.0.0.1:3000
```

Run the tests (starts the real server on a random port and speaks MCP to it):

```bash
npm test      # 55 checks
```

## What is inside

| Part | Where | What it does |
|---|---|---|
| MCP server | `lib/mcp.mjs`, `lib/tools.mjs`, `server.mjs` | `POST/DELETE /mcp`. `initialize` with version negotiation and `Mcp-Session-Id`, `ping`, `tools/list`, `tools/call`, Origin validation, optional bearer token |
| 18 tools | `lib/tools.mjs` | reminders, focus timer, to-dos, topic tracking, progress, daily plan, physics and space facts, quiz, calculator (no `eval`), simulated smart home, mock weather, time |
| Agent Skill | `skills/prakash-study-coach/SKILL.md` | tells an agent when and how to call the tools, reply rules for voice |
| Agent brain | `lib/brain.mjs` | an MCP client plus two modes: **Claude** (with `ANTHROPIC_API_KEY`) picks tools from the live `tools/list`; **offline rules** (default) is a Hindi/English intent router. Both call tools through real MCP over HTTP |
| Simulated Alexa+ | `public/index.html` | Echo ring states, chat, voice in (Web Speech API) and out (speech synthesis), live MCP traffic panel, agent trace, state, tools, SKILL.md, connect help |

## How a request flows

```
browser (voice/text)
  → POST /api/agent
      → brain (Claude or rules) decides which tool(s)
          → HTTP POST /mcp  (JSON-RPC 2.0: initialize → tools/list → tools/call, Mcp-Session-Id)
              → tool runs, state saved to data.json
  ← reply text + trace; the UI speaks it and shows the raw MCP traffic
```

Reminders are real timers on the server. A device (the web UI here) polls `get_due_reminders` and speaks them when they fire.

## Use Claude as the brain (optional)

```bash
ANTHROPIC_API_KEY=sk-ant-... node server.mjs
# optional: CLAUDE_MODEL=claude-sonnet-5-5
```

Claude receives the live tool list from the MCP server, calls tools, and answers in the user's language. If the API call fails, the app falls back to the offline rules brain and says so in the trace.

## Connect any MCP client

```bash
npx @modelcontextprotocol/inspector     # Transport: Streamable HTTP, URL: http://127.0.0.1:3000/mcp
claude mcp add --transport http study-coach http://127.0.0.1:3000/mcp
```

Raw curl:

```bash
curl -si http://127.0.0.1:3000/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
# take the Mcp-Session-Id response header, then send tools/list / tools/call with
# -H 'Mcp-Session-Id: <id>' -H 'MCP-Protocol-Version: 2025-11-25'
```

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only together with `MCP_TOKEN` |
| `MCP_TOKEN` | unset | If set, `/mcp` requires `Authorization: Bearer <token>` |
| `ALLOWED_ORIGINS` | unset | Comma-separated extra browser origins allowed (DNS-rebinding protection) |
| `DATA_FILE` | `./data.json` | Where state is stored |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL` | unset | Enable the Claude brain |

## Putting it in front of real Alexa+

The server is standards-based, so the remaining steps are deployment, not code: host it behind public HTTPS (a cloud VM, container, or a tunnel), set `MCP_TOKEN` and `ALLOWED_ORIGINS`, then register the endpoint through the Alexa+ developer tooling. Follow the current Alexa+ developer documentation for the registration and account-linking steps. This repository does **not** claim a deployed Alexa+ skill or production Alexa account connection. It demonstrates the MCP server and the simulated Alexa+ experience.

## Honest limitations

- Weather is deterministic **mock** data, smart-home devices are **simulated**.
- Single-user state (one `data.json`). No OAuth or multi-tenant isolation in this hackathon version.
- No server-initiated SSE stream (`GET /mcp` returns 405, which the spec allows); responses are plain JSON or a single SSE event.
- No JSON-RPC batching beyond what a client sends in one POST.

## License

MIT, see `LICENSE`.
