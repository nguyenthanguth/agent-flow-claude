# agent-flow-claude

[![CI](https://github.com/nguyenthanguth/agent-flow-claude/actions/workflows/ci.yml/badge.svg)](https://github.com/nguyenthanguth/agent-flow-claude/actions/workflows/ci.yml)

Real-time visualization of Claude Code sessions in your browser. Watch the main agent and its subagents think, call tools and hand results back, live, as an interactive graph.

> **Based on [Agent Flow](https://github.com/patoles/agent-flow)** by Simon Patole. This is an independent fork, not the official project and not endorsed by its maintainers. It is reduced to one job: Claude Code in the browser.

![agent-flow-claude showing a Claude Code session with its tool calls and messages](docs/screenshot.png)

## What's different from Agent Flow

| | Agent Flow | agent-flow-claude |
|---|---|---|
| Runs as | VS Code extension, `npx` app, dev server | One local server + browser UI |
| Runtimes | Claude Code and Codex | Claude Code only |
| Event source | Claude Code hooks + transcripts | Transcripts only — nothing is installed into Claude Code, `~/.claude/settings.json` is never touched |
| Subagents | Could be duplicated, never finish (Claude Code 2.1+), or vanish when the main agent ends a turn | Spawned once, streamed live, finish on time, stay on the graph (dimmed) when done |
| Telemetry | Opt-out | None |

## Features

- **Live agent graph**: the main agent, every subagent, their tool calls and messages, connected parent → child
- **Subagents in real time**, including background ones and subagents that were already running when you opened the page
- **Multiple sessions**: each active session in the project gets a tab
- **Context usage**: token bars per agent and a context ring on the main agent, split into system, user, tool results, reasoning and subagent results
- **Panels**: transcript (Chat), files touched, cost estimate, timeline
- **Review mode**: pause and scrub back through the session
- **Reload-safe**: every connection replays the full history, so refreshing never loses or duplicates events

## Quick start

Requirements: [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) 10.

```bash
git clone https://github.com/nguyenthanguth/agent-flow-claude.git
cd agent-flow-claude
pnpm install
pnpm build
```

Then point it at the project you work on with Claude Code:

```bash
node server/dist/agent-flow-claude.js --workspace /path/to/your/project
```

Your browser opens at http://127.0.0.1:3030. Start or continue a Claude Code session in that project; it appears within about a second.

**No build tools?** Every push to `main` builds a ready-to-run bundle. Download the `agent-flow-claude` artifact from the latest [CI run](https://github.com/nguyenthanguth/agent-flow-claude/actions/workflows/ci.yml), unzip it, and run `node agent-flow-claude.js --workspace <project>`. It needs only Node.js, with no `npm install`.

### Options

| Option | Description |
|---|---|
| `-w, --workspace <dir>` | Project to watch. Default: `$AGENT_FLOW_CLAUDE_WORKSPACE`, then the current directory. Subfolders of the project are included |
| `-p, --port <number>` | Server port (default `3030`) |
| `--no-open` | Don't open the browser |
| `-v, --verbose` | Log every event |

A session is picked up if its transcript, or one of its subagents', was written in the last 10 minutes. Older sessions attach as soon as they are written to again.

## How it works

Claude Code already writes everything Agent Flow needs to disk:

```
~/.claude/projects/<encoded-project-path>/
├── <session-id>.jsonl                  main agent transcript
└── <session-id>/subagents/
    ├── agent-<id>.jsonl                one transcript per subagent
    └── agent-<id>.meta.json            { description, toolUseId, finished }
```

The server tails these files (file watchers plus a 1-second poll), turns transcript entries into agent events, and streams them to the browser over Server-Sent Events at `/events`. A subagent is named after its `description`. It finishes when its `<task-notification>` arrives or when its meta file says `finished: true`, whichever comes first.

```
server/   Node server — src/core/ (transcript + subagent parsing), src/relay.ts (session watching + SSE), src/server.ts (HTTP)
web/      React + Canvas UI, built with Vite
```

## Development

```bash
pnpm dev          # server on :3030 (auto-restart) + UI on :3000 with hot reload
pnpm dev:demo     # UI only, playing a built-in demo scenario (any build also accepts ?demo)
pnpm test         # unit tests (node:test)
pnpm typecheck    # TypeScript, server + web
pnpm build        # production build into server/dist/
```

To watch another project while developing: `AGENT_FLOW_CLAUDE_WORKSPACE=/path/to/project pnpm dev`.

GitHub Actions runs tests, typecheck and build on every push and pull request, and uploads the build as an artifact.

### Windows

Everything works from PowerShell, cmd or Git Bash. The repo's `.npmrc` enables pnpm's cross-platform script shell, so the POSIX-style scripts in `package.json` run under `cmd.exe` too.

## Credits and license

agent-flow-claude is derived from [Agent Flow](https://github.com/patoles/agent-flow), created by [Simon Patole](https://github.com/patoles) for [Antics](https://antics.gg). The original code and this fork are licensed under Apache 2.0; see [LICENSE](LICENSE).

"Agent Flow" and its logos are trademarks of Simon Patole ([TRADEMARK.md](TRADEMARK.md)). This fork uses the name only to describe where it comes from, and does not use the Agent Flow logo.
