import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      { name: 'text', enforce: 'pre', load: (id) => (id.endsWith('.txt') ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))}` : undefined) },
    ],
    resolve: { alias: { '@tessery/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)), '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: env.TESSERY_SERVER_URL ?? 'http://127.0.0.1:8080', changeOrigin: false },
        '/git': { target: env.TESSERY_SERVER_URL ?? 'http://127.0.0.1:8080', changeOrigin: false },
      },
    },
  }
})
