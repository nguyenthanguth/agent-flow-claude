#!/usr/bin/env node
/**
 * Builds agent-flow-claude:
 *   1. Builds the web UI via Vite (into server/dist/webview/)
 *   2. Bundles the server entry via esbuild (into server/dist/agent-flow-claude.js)
 */
'use strict'

const { execSync } = require('child_process')
const esbuild = require('esbuild')
const path = require('path')

const ROOT = path.join(__dirname, '..')

console.log('Building agent-flow-claude...\n')

console.log('[1/2] Building web UI...')
execSync('pnpm exec vite build', {
  cwd: path.join(ROOT, 'web'),
  stdio: 'inherit',
})

console.log('\n[2/2] Bundling server...')
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.join(__dirname, 'dist', 'agent-flow-claude.js'),
  define: {
    AGENT_FLOW_CLAUDE_VERSION: JSON.stringify(require('./package.json').version),
  },
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  logLevel: 'warning',
})

console.log('\nDone! Run: node server/dist/agent-flow-claude.js')
