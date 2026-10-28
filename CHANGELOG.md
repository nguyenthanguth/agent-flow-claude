# Changelog

## Unreleased (fork)

- **Plan usage bar** in the top bar: percent used of the 5-hour session and weekly limits (only those your plan has), time to reset, and a details popover — the same data as Claude Code's `/usage`, fetched every 5 minutes with Claude Code's login (`--no-plan-usage` turns it off). The popover also shows this machine's usage in the same windows, across all projects and subagents, priced at API rates. The last good limits are cached, so a restart or a rate-limited refresh still shows them with their age
  - Machine totals take each response's own usage and timestamp even when a tool input contains look-alike `usage` / `timestamp` keys; the weekly total follows the weekly limit only when that limit is in effect (otherwise it is the last 7 days, as labelled)
  - Kept limits expire after 6 hours of failed refreshes, ages are shown as "12 min ago", limits are published from cache before the first fetch returns, and limits with the same label get distinct ids
  - Refreshes skip unchanged transcripts (about 30 ms instead of re-opening every file), and very long transcript lines are read in linear time
- **Real context, cost and status** — read from the API `usage` Claude Code records on every response instead of estimated from character counts
  - Fix: context was underestimated about 4× (169k shown for a 680k context) and never went down after a compaction. It is now the real size of the latest request, per agent; the split by kind stays an estimate, scaled to the real total
  - Fix: subagents showed the whole session's context (169k / 200k for a 19k Haiku subagent)
  - Cost is the session's requests at API list prices (input, output, cache reads, 5-minute and 1-hour cache writes, per model, Haiku 5.5 long-context rates), including history from before Agent Flow attached. Prices updated to the current list (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50, Fable 5.1 $10/$50); Haiku 4.5 context is 200K
  - Every agent shows a status line: Thinking, Running <tool>, Done, and for the main agent *Waiting for you* once its turn ends (`stop_reason: end_turn`), *Interrupted* after Esc, plus how many subagents are still working. Previously the main agent looked busy until a 5-minute idle timeout
  - Session tabs use Claude Code's generated title (`ai-title`) instead of the truncated first prompt
  - The top bar shows the main agent's context and the session cost
- Fix: sessions with very large transcripts (a 748 MB session file) failed to attach with `ERR_STRING_TOO_LONG`, because the whole file was read into one string. Transcripts are now streamed in 4 MB chunks, only the session label and the current turn are kept in memory, and finished subagents are no longer read at all. The 748 MB session attaches in about 3 s with ~110 MB peak memory
- **Global install**: `npm install -g <release .tgz>` (or `pnpm install-global` from source), then run `agent-flow-claude` in any project folder. Tagging `v*` publishes a GitHub Release with the tarball. New `--version` flag; `-v` now means `--version` (use `--verbose` for event logs)
- **Renamed to agent-flow-claude** (based on Agent Flow). The CLI is `agent-flow-claude` (`server/dist/agent-flow-claude.js`) and the workspace variable is `AGENT_FLOW_CLAUDE_WORKSPACE`. CI uploads a ready-to-run build as an artifact
- Fix: a JSONL line read while Claude Code was still writing it was lost for good (for example a large tool result, which left its card "running"). Reads now stop at the last complete line and pick the rest up on the next read
- Fix: on long sessions the replay buffer trimmed the first `agent_spawn` events, so after a reload the main agent and early subagents were missing. Trimming now keeps spawn, dispatch, return, complete and model events
- Fix: clicking the session tab that was already selected froze live updates until another tab was chosen
- Fix: after the idle timeout the main agent kept looking busy; it now shows as idle until the session resumes
- Fix: parallel calls to the same tool (for example three `Read`s at once) were merged into one card
- Subagents created while Agent Flow is watching are replayed from their first line, so nothing they did before being noticed is dropped
- **One local server + browser UI, Claude Code only.** Removed the VS Code extension, Next.js, telemetry, and the Claude Code hook integration (no more `hook.js`, discovery files or edits to `~/.claude/settings.json`). The server only reads session transcripts. Run `pnpm build`, then `node server/dist/agent-flow.js [-w <project>]`; default port is now 3030
- **Subagents in real time**
  - Fix: subagents showed up twice — once from transcripts, once from hooks under a different name (`Explore-7ea23e`) that was never spawned, so its tool calls went nowhere
  - Fix: running subagents were marked done and faded away whenever the main agent finished a turn (the `Stop` hook completed the orchestrator, which cascaded to every child)
  - Fix: background subagents never completed on Claude Code 2.1+, which delivers `<task-notification>` as an `attachment` entry. Both shapes are parsed, and the subagent's `.meta.json` `finished: true` now completes it too, with its final answer as the summary
  - Fix: subagents already running when Agent Flow starts are now shown
  - Fix: a new subagent waits for its `.meta.json` instead of appearing as `subagent-N`
  - Finished subagents stay on the graph, dimmed, instead of being removed; long-running tool calls (builds, tests) no longer fade out after 10 seconds
  - The idle timeout marks the main agent idle instead of completing the whole graph
  - Transcripts are polled every second as a fallback to file watching (was 3 s)
- Fix: reloading the page or an SSE reconnect could drop or duplicate events. Every connection now starts with a reset and replays all sessions, not just the most recent one
- Removed the "waiting for permission" heuristic, which fired for any tool running longer than 5 seconds
- **New look**: warm dark theme with Claude's clay accent, circular agent nodes, readable sans-serif text (monospace only for commands and code), solid cards for tool calls and messages, a quiet dot grid instead of the starfield, hex grid and bloom
- **Removed Codex support** — this fork visualizes Claude Code sessions only
  - Removed the Codex rollout watcher and parser, the OpenAI logo and "CODEX" labels in the web view, and GPT model context/cost/name handling
  - Removed the `agentVisualizer.runtime` setting and the `AGENT_FLOW_RUNTIME` environment variable; the Claude runtime always runs
- Fix: `pnpm run dev` and `pnpm run dev:demo` failed on Windows (`'NEXT_PUBLIC_DEMO' is not recognized`) because pnpm ran scripts through `cmd.exe`. The repo `.npmrc` now enables pnpm's cross-platform `shell-emulator`

## 0.9.2

- Fix: hook setup no longer removes other tools' hooks from `~/.claude/settings.json` (#73)
  - Setup (`npx agent-flow-app`, `pnpm run setup`, and the VS Code extension) treated any hook URL starting with `http://127.0.0.1:` as its own, so loopback HTTP hooks registered by other tools were deleted on install. On every activation, the VS Code extension also rewrote them into Agent Flow command hooks
  - Only Agent Flow's own command hook and its legacy bare-origin HTTP hook (`http://127.0.0.1:<port>`) are matched now. This also fixes setup being skipped when another tool's loopback hook made it look already installed
  - A `settings.json` that can't be parsed is now left untouched with an error, instead of being replaced by a file that only contains hooks
  - Settings are written via a temp file and rename, so an interrupted write can't truncate them
- Fix: uninstalling the VS Code extension now removes its hooks. The uninstall script was excluded from the packaged extension, so `vscode:uninstall` had nothing to run and Agent Flow's hooks stayed in `settings.json`
- Fix: background subagents were marked done the moment they launched (#92)
  - Claude Code runs `Agent`/`Task` subagents in the background by default. Their immediate tool_result only confirms the launch, but Agent Flow treated it as the finish, so the node completed at once and then looked busy again on its next tool call, or vanished and silently dropped the rest of its events
  - Background subagents now complete when their `<task-notification>` arrives, including ones launched before Agent Flow attached. Failed or killed runs are marked in the return summary
- Fix: per-agent model detection (#91)
  - Subagents get their model from the parent transcript (`resolvedModel` on the launch result), so replayed or branched sessions and subagents whose transcript is never tailed now show a model
  - Placeholder `<synthetic>` model ids (written on API errors and interrupts) no longer replace the real model
- Fix: in review mode, the elapsed time, scrubber knob and counters stood still while playback ran through a stretch with no events, and only caught up on the next event or on pause (#90)
- Fix: session switching and replay races in the web view (#78)
  - Re-selecting the session already on screen no longer freezes event delivery, and live events no longer skip events that hadn't been replayed yet
  - Restoring a paused snapshot no longer plays it at 1x under the LIVE badge, and the snapshot cache is cleared on reset

## 0.9.1

- Fix: Claude Code session discovery on Windows — workspace-to-project-dir matching is now case-insensitive on win32 (#57, part of #4)
  - VS Code reports drive letters lowercase (`c:\...`) while Claude Code encodes them uppercase (`C--...`), so the encoded-directory lookup, the subfolder-session prefix check, and the cwd containment check could all silently miss — no sessions appeared at all
  - The workspace project dir is now resolved to its actual on-disk casing at startup, and all path comparisons are case-folded on Windows (matching the Codex-side fix from 0.9.0)

## 0.9.0

- **New model support — Claude Fable 5 / Mythos 5, Sonnet 5, Opus 4.8, GPT-5.x Codex** (#57)
  - Context window sizing: `fable`/`mythos` family recognized as 1M context (previously fell back to 200k, showing the gauge 5× overfull); `gpt-*` family recognized as 400k as the fallback when Codex doesn't report its own authoritative window. Sonnet 5 / Opus 4.8 already matched the existing family patterns
  - Cost display: per-model-family blended $/M rates (Fable/Mythos $10/$50, Opus $5/$25, Sonnet $3/$15, Haiku $1/$5, GPT-5.x Codex $1.75/$14) replace the single Sonnet-class rate that was applied to every agent. Agents now carry the detected model ID, and the cost pill, summary panel, and per-tool breakdown all use the owning agent's rate
- **Codex session discovery fixes** — addresses reports of Codex sessions not appearing
  - Windows: workspace/cwd matching is now case-insensitive on win32 (VS Code reports `c:\...`, Codex writes `C:\...` — sessions never matched)
  - Large `session_meta`: the first-line reader now grows up to 1MB instead of a fixed 64KB — newer Codex versions embed full base instructions and AGENTS.md content, which silently broke cwd extraction and skipped the session
  - Silent cwd mismatch: when recent Codex sessions exist but none ran in the current workspace, a warning now says so (the most common cause: launching `npx agent-flow-app` from a different directory than the Codex session). Warnings are visible without `--verbose`
- Fix: assistant messages in Codex sessions were labeled "CLAUDE" in the transcript panels and canvas bubbles — the label now follows the session runtime ("CODEX") (#49)

## 0.8.1

- **Opt-out anonymous usage telemetry** — Agent Flow now tracks whether people come back after day 1 so we can tell whether it's actually useful. Only aggregate session metadata is sent, never prompts, file paths, or code
  - What's sent: session count, duration, event count, OS/arch, Agent Flow version, distinct Claude/Codex model IDs observed during each session, which runtimes were watched (`claude`, `codex`, or `claude,codex`), and error class names on crashes
  - What's NEVER sent: prompts, tool calls, tool responses, file paths, repo names, user name/email/hostname, environment variables, error messages or stack traces
  - Turn off: `export AGENT_FLOW_TELEMETRY=false` or `export DO_NOT_TRACK=1`. Disabled installs write nothing to disk — no `~/.agent-flow/` state file, no telemetry dir
  - Only the published `npx agent-flow-app` binary emits. `pnpm run dev` stays silent so contributor iterations don't land in the data
  - Inspect the exact payload locally: `cat ~/.agent-flow/telemetry/events.jsonl`
- Remove `@vercel/analytics` — conflicts with the first-party-only commitment in the privacy doc

## 0.8.0

- **Codex runtime support** — available in all three entry points: VS Code extension, `pnpm run dev`, and `npx agent-flow-app`. Agent Flow now watches Codex rollouts at `~/.codex/sessions/**/rollout-*.jsonl` alongside Claude Code sessions
  - New `agentVisualizer.runtime` setting (VS Code only): `"auto"` (default, watches both), `"claude"`, or `"codex"`
  - `AGENT_FLOW_RUNTIME` environment variable (`claude` / `codex` / `auto`) gives the same opt-out in `pnpm run dev` and `npx agent-flow-app`
  - Respects `CODEX_HOME` for non-default installs
  - Parses all five Codex rollout record types (`session_meta`, `turn_context`, `response_item`, `event_msg`, `compacted`) — surfaces tool calls (`exec_command`, `apply_patch`, `write_stdin`, `update_plan`), reasoning, web searches
  - Uses Codex's own authoritative token counts (`event_msg.token_count.info.last_token_usage.input_tokens` and `model_context_window`) instead of estimating
  - Handles auto-compaction via the `compacted` event — context gauge resets cleanly instead of staying frozen
  - Filters Codex's IDE-context wrapper (`# Context from my IDE setup:` + `## My request for Codex:`) and pure injections (AGENTS.md, environment_context, turn_aborted) from user messages
- Refactor: new `AgentSessionWatcher` interface and shared watcher→panel wiring (`session-runtime.ts`) replaces per-runtime duplication. The Codex watcher is vscode-free so it works in the relay/CLI without modification
- Parser unit test suite with real-shape rollout fixture — run via `pnpm test`

## 0.7.0

- **Opus 4.7 support** (#43)
  - Context window sizing now uses family-based pattern matching, so new Opus/Sonnet releases (4.7, future 4.x / 5.x) pick up their 1M context without a code change
  - Redacted thinking blocks (Opus 4.7 returns thinking as an encrypted signature by default) now show a "Thinking..." placeholder bubble instead of being silently dropped
- Fix: Windows hook deduplication — `isAgentFlowHook` now normalizes path separators before matching, so old entries are correctly replaced on re-registration (prevents settings.json from accumulating duplicates) (#42)
- Fix: respect `CLAUDE_CODE_DISABLE_1M_CONTEXT` env var and setting — context gauge caps to 200k when set (#39)
- Fix: relay path encoding for non-ASCII workspace paths (CJK, Cyrillic, accented Latin) (#38)
- Fix: duplicate subagent nodes from hook server and transcript parser race (#34)
- Fix: duplicate React key warning on session switch (#33)
- Fix: web app SSE connection failure in standalone dev mode (#32)

## 0.6.2

- Fix: session detection for workspace paths containing underscores or other special characters (#18, #19)

## 0.6.1

- npx support — `npx agent-flow-app` starts the visualizer without cloning the repo
- Internal refactor: shared relay module and build config

## 0.6.0

- Standalone web app — run Agent Flow in the browser without VS Code (`pnpm run dev`)
- pnpm workspace monorepo setup
- VS Code debug and dev configuration
- Fix: event loss from React strict mode double-invocation
- Fix: SSE relay security hardening (localhost-only binding, restricted CORS, bounded event buffer)

## 0.5.0

- Fix: heavy performance degradation during long sessions with many agents (#20)
  - Decouple canvas rendering from React state — canvas reads from a ref at 60fps, React re-renders only on data changes
  - Virtualize transcript and message feed panels for constant render cost regardless of message count
  - Replace timeline panel DOM with canvas rendering
  - Fix tool call cleanup leak that caused unbounded object growth after ~5000 events
  - Fix event log cap causing mass event replay in mock/stress mode
  - Cap simulation loop at 60fps to reduce CPU/GPU usage
- Add stress test scenarios for profiling (`?stress=light|medium|heavy|extreme`)
- Add performance overlay for debugging (`?perf`)
- Fix passive event listener warning when panning canvas
- File attention panel: show agent count instead of full name list

## 0.4.7

- Fix: reset button in review mode no longer breaks the extension
  - Active agents are preserved across reset; only completed state and visual history are cleared
  - Event log is trimmed to retain agent_spawn events so review mode seeking works correctly

## 0.4.6

- Updated README: clarified automatic hook configuration behavior
- Updated description and tagline

## 0.4.5

- Initial public release
- Real-time visualization of Claude Code agent execution flows
- Auto-detection of Claude Code sessions via transcript watching
- Claude Code hooks integration for live event streaming
- Multi-session support with session tabs
- Interactive canvas with agent nodes, tool calls, and particles
- Timeline, file attention, and transcript panels
- JSONL event log file watching
