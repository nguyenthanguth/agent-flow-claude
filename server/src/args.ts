import * as path from 'path'
import { DEFAULT_PORT } from './core/constants'

/** Parse CLI arguments. Keeps it simple — no dependencies. */
export function parseArgs(argv: string[]) {
  let port = DEFAULT_PORT
  let open = true
  let verbose = false
  const envWorkspace = process.env.AGENT_FLOW_WORKSPACE
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
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: agent-flow [options]

Options:
  -p, --port <number>      Port for the server (default: ${DEFAULT_PORT})
  -w, --workspace <dir>    Project whose Claude Code sessions to watch
                           (default: $AGENT_FLOW_WORKSPACE, then the current directory)
  --no-open                Don't open the browser automatically
  -v, --verbose            Show detailed event logs
  -h, --help               Show this help message
`)
      process.exit(0)
    }
  }

  return { port, open, verbose, workspace }
}
