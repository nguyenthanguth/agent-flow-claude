import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/** Port of the agent-flow-claude server (`pnpm dev:server`), which serves /events */
const SERVER_PORT = 3030

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname) },
  },
  server: {
    port: 3000,
    proxy: {
      '/events': { target: `http://127.0.0.1:${SERVER_PORT}`, changeOrigin: true },
    },
  },
  build: {
    outDir: resolve(__dirname, '../server/dist/webview'),
    emptyOutDir: true,
  },
})
