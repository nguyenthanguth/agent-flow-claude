/**
 * Static file server for the pre-built web UI (Vite output in dist/webview/).
 * Unknown paths fall back to index.html; nothing outside the directory is served.
 */
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'

const WEBVIEW_DIR = path.join(__dirname, 'webview')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = path.join(WEBVIEW_DIR, urlPath === '/' ? 'index.html' : urlPath)

  // Prevent path traversal
  if (!filePath.startsWith(WEBVIEW_DIR + path.sep)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEBVIEW_DIR, 'index.html')
  }

  try {
    const content = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(content)
  } catch {
    // No UI build next to the server (e.g. running from source): `pnpm dev`
    // serves the UI through Vite and only uses this server for /events.
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('agent-flow-claude UI is not built. Run `pnpm build`, or use `pnpm dev` and open http://localhost:3000.')
  }
}
