/**
 * agent-flow-claude — real-time visualization of Claude Code sessions.
 * Based on Agent Flow (https://github.com/patoles/agent-flow).
 *
 * Starts a local server that:
 *   1. Watches the Claude Code transcripts of sessions in the current directory
 *   2. Serves the visualizer UI and streams events via SSE
 *   3. Opens the browser automatically
 *
 * Usage: agent-flow-claude [--port <number>] [--no-open] [--verbose]
 */
import { parseArgs, version } from './args'
import { startServer } from './server'

const args = parseArgs(process.argv.slice(2))

console.log(`agent-flow-claude ${version()}\n`)

startServer({
  port: args.port,
  openBrowser: args.open,
  workspace: args.workspace ?? process.cwd(),
  verbose: args.verbose,
})
