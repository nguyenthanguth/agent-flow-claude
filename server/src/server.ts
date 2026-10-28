/**
 * HTTP server: streams agent events over SSE at /events and serves the
 * pre-built web UI for everything else.
 */
import * as http from 'http'
import { exec, execFile } from 'child_process'

import { createRelay } from './relay'
import { serveStatic } from './static'

interface ServerOptions {
  port: number
  openBrowser: boolean
  workspace: string
  verbose?: boolean
}

export function startServer(options: ServerOptions) {
  const { port, openBrowser, workspace } = options

  const relay = createRelay({ workspace, verbose: options.verbose })

  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      return relay.handleSSE(req, res)
    }
    if (req.method === 'GET') {
      return serveStatic(req, res)
    }
    res.writeHead(404)
    res.end('Not found')
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or pass --port <number>.`)
    } else {
      console.error(err)
    }
    relay.dispose()
    process.exit(1)
  })

  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`
    console.log(`Workspace: ${workspace}`)
    console.log(`Server running at ${url}`)
    console.log('Waiting for Claude Code sessions...\n')
    if (openBrowser) openURL(url)
  })

  // Idempotent — Ctrl+C spam or SIGTERM+SIGHUP must not dispose twice.
  let shuttingDown = false
  function cleanup() {
    if (shuttingDown) return
    shuttingDown = true
    relay.dispose()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('SIGHUP', cleanup)
}

function openURL(url: string) {
  if (process.platform === 'win32') {
    // 'start' is a shell builtin on Windows — must use exec, not execFile
    exec(`start "" "${url}"`)
  } else {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    execFile(cmd, [url], () => {})
  }
}
