import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { build } from 'esbuild'

/** The component preview runs in an iframe sandboxed without same-origin access. Module scripts would need CORS from
 * that opaque origin, so the preview is one classic script, bundled here for the dev server and for the build. */
async function sandboxScript(): Promise<string> {
  const out = await build({
    entryPoints: [fileURLToPath(new URL('./src/sandbox/main.tsx', import.meta.url))],
    bundle: true, format: 'iife', minify: true, write: false, jsx: 'automatic', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  })
  return out.outputFiles[0].text
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      { name: 'text', enforce: 'pre', load: (id) => (id.endsWith('.txt') ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))}` : undefined) },
      {
        name: 'sandbox-script',
        configureServer(server) {
          server.middlewares.use('/sandbox.js', (_req, res) => {
            sandboxScript().then((code) => { res.setHeader('content-type', 'text/javascript'); res.setHeader('cache-control', 'no-store'); res.end(code) }, (e: Error) => { res.statusCode = 500; res.end(String(e.message)) })
          })
        },
        async generateBundle() { this.emitFile({ type: 'asset', fileName: 'sandbox.js', source: await sandboxScript() }) },
      },
    ],
    resolve: { dedupe: ['react', 'react-dom'], alias: { '@tessery/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)), '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: env.TESSERY_SERVER_URL ?? 'http://127.0.0.1:8080', changeOrigin: false },
        '/git': { target: env.TESSERY_SERVER_URL ?? 'http://127.0.0.1:8080', changeOrigin: false },
      },
    },
  }
})
