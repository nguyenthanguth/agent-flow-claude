import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_PORT } from './core/constants'

// Inlined by esbuild at bundle time (server/build.js). When running from
// source via tsx it is undeclared, so fall back to server/package.json.
declare const AGENT_FLOW_CLAUDE_VERSION: string | undefined

export function version(): string {
  if (typeof AGENT_FLOW_CLAUDE_VERSION === 'string') return AGENT_FLOW_CLAUDE_VERSION
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')).version
  } catch {
    return '0.0.0'
  }
}

/** Parse CLI arguments. Keeps it simple — no dependencies. */
export function parseArgs(argv: string[]) {
  let port = DEFAULT_PORT
  let open = true
  let verbose = false
  let planUsage = true
  const envWorkspace = process.env.AGENT_FLOW_CLAUDE_WORKSPACE
  let workspace = envWorkspace ? path.resolve(envWorkspace) : undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ((arg === '--port' || arg === '-p') && argv[i + 1]) {
      const n = parseInt(argv[i + 1], 10)
      if (!isNaN(n) && n > 0 && n < 65536) port = n
      i++
    } else if ((arg === '--workspace' || arg === '-w') && argv[i + 1]) {
      workspace = path.resolve(argv[i + 1])
      i++
    } else if (arg === '--no-open') {
      open = false
    } else if (arg === '--no-plan-usage') {
      planUsage = false
    } else if (arg === '--verbose') {
      verbose = true
    } else if (arg === '--version' || arg === '-v') {
      console.log(version())
      process.exit(0)
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: agent-flow-claude [options]

Run it in your project folder to watch that project's Claude Code sessions.

Options:
  -w, --workspace <dir>    Project to watch instead of the current directory
                           (also $AGENT_FLOW_CLAUDE_WORKSPACE)
  -p, --port <number>      Port for the server (default: ${DEFAULT_PORT})
  --no-open                Don't open the browser automatically
  --no-plan-usage          Don't fetch plan limits (5-hour / weekly) with Claude Code's login
  --verbose                Show detailed event logs
  -v, --version            Print the version
  -h, --help               Show this help message
`)
      process.exit(0)
    }
  }

  return { port, open, verbose, workspace, planUsage }
}
