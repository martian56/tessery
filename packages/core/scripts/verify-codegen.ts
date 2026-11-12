import { execFile } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { generateAll } from '../src/codegen'
import { runOp } from '../src/domain/ops'
import { saasTemplate } from '../src/templates/saas'
import { blankTemplate } from '../src/templates/blank'

const run = promisify(execFile)

interface Spec { name: string; language: string; framework?: string; style?: string; kind?: 'service' | 'worker' | 'cron' }

const SERVICES: Spec[] = [
  { name: 'ts-fastify', language: 'TypeScript', framework: 'Fastify' },
  { name: 'ts-hono', language: 'TypeScript', framework: 'Hono' },
  { name: 'ts-express', language: 'TypeScript', framework: 'Express' },
  { name: 'ts-apollo', language: 'TypeScript', style: 'graphql', framework: 'Apollo Server' },
  { name: 'ts-yoga', language: 'TypeScript', style: 'graphql', framework: 'GraphQL Yoga' },
  { name: 'ts-grpc', language: 'TypeScript', style: 'grpc' },
  { name: 'ts-ws', language: 'TypeScript', style: 'websocket' },
  { name: 'go-chi', language: 'Go', framework: 'chi' },
  { name: 'go-gin', language: 'Go', framework: 'Gin' },
  { name: 'go-echo', language: 'Go', framework: 'Echo' },
  { name: 'py-fastapi', language: 'Python', framework: 'FastAPI' },
  { name: 'py-flask', language: 'Python', framework: 'Flask' },
  { name: 'py-litestar', language: 'Python', framework: 'Litestar' },
  { name: 'py-graphql', language: 'Python', style: 'graphql' },
  { name: 'py-grpc', language: 'Python', style: 'grpc' },
  { name: 'py-ws', language: 'Python', style: 'websocket' },
  { name: 'rust-axum', language: 'Rust', framework: 'Axum' },
  { name: 'rust-actix', language: 'Rust', framework: 'Actix Web' },
  { name: 'java-spring', language: 'Java' },
  { name: 'java-graphql', language: 'Java', style: 'graphql' },
  { name: 'kotlin-ktor', language: 'Kotlin' },
  { name: 'scala-http4s', language: 'Scala' },
  { name: 'csharp-aspnet', language: 'C#' },
  { name: 'ruby-sinatra', language: 'Ruby', framework: 'Sinatra' },
  { name: 'php-plain', language: 'PHP' },
  { name: 'elixir-plug', language: 'Elixir' },
  { name: 'swift-vapor', language: 'Swift' },
  { name: 'cpp-httplib', language: 'C++' },
  { name: 'zig-std', language: 'Zig' },
  { name: 'py-worker', language: 'Python', kind: 'worker' },
  { name: 'go-cron', language: 'Go', kind: 'cron' },
  { name: 'rust-worker', language: 'Rust', kind: 'worker' },
]

const OPS: Record<string, [string, string][]> = {
  rest: [['GET /orders', 'listOrders'], ['GET /orders/{id}', 'getOrder'], ['POST /orders', 'createOrder'], ['DELETE /orders/{id}', 'deleteOrder']],
  graphql: [['query', 'orders'], ['mutation', 'createOrder']],
  grpc: [['rpc', 'GetOrder'], ['rpc', 'ListOrders']],
  websocket: [['event message', 'message'], ['event typing', 'typing']],
}

function fixture() {
  const doc = blankTemplate('codegen-check')
  const db = runOp(doc, 'addNode', { techId: 'postgres', x: 0, y: 0, name: 'orders-db' }) as string
  const orders = runOp(doc, 'addTable', { nodeId: db, name: 'orders' }) as string
  runOp(doc, 'addColumn', { nodeId: db, tableId: orders, column: { name: 'total', type: 'int', nullable: false } })
  SERVICES.forEach((s, i) => {
    const id = runOp(doc, 'addNode', { techId: s.kind ?? 'service', x: 200, y: i * 100, name: s.name, config: { language: s.language, ...(s.style ? { apiStyle: s.style } : {}) } }) as string
    runOp(doc, 'setConfig', { id, key: 'language', value: s.language })
    if (s.style) runOp(doc, 'setConfig', { id, key: 'apiStyle', value: s.style })
    if (s.framework) runOp(doc, 'setConfig', { id, key: 'framework', value: s.framework })
    if (!s.kind) for (const [kind, name] of OPS[s.style ?? 'rest']) runOp(doc, 'addOperation', { nodeId: id, kind, name, summary: `${name} handler` })
    runOp(doc, 'connect', { source: id, target: db })
  })
  return doc
}

async function main() {
  const filter = process.argv.slice(2)
  const out = join(tmpdir(), 'tessery-codegen-check')
  rmSync(out, { recursive: true, force: true })
  const files = { ...generateAll(fixture()), ...Object.fromEntries(Object.entries(generateAll(saasTemplate())).filter(([p]) => p.startsWith('apps/'))) }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(out, path)), { recursive: true })
    writeFileSync(join(out, path), content)
  }
  const targets = [...SERVICES.map((s) => `services/${s.name}`), 'apps/dashboard'].filter((t) => !filter.length || filter.some((f) => t.includes(f)))
  console.log(`generated ${Object.keys(files).length} files into ${out}; building ${targets.length} images`)

  const results: { target: string; ok: boolean; seconds: number; tail?: string }[] = []
  const queue = [...targets]
  const workers = Array.from({ length: Number(process.env.JOBS ?? 3) }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const started = Date.now()
      try {
        await run('docker', ['build', '-q', '-t', `tessery-check/${t.split('/')[1]}`, join(out, t)], { maxBuffer: 64 * 1024 * 1024 })
        results.push({ target: t, ok: true, seconds: (Date.now() - started) / 1000 })
        console.log(`ok    ${t}`)
        await run('docker', ['rmi', '-f', `tessery-check/${t.split('/')[1]}`]).catch(() => undefined)
        if (process.env.PRUNE) await run('docker', ['builder', 'prune', '-af']).catch(() => undefined)
      } catch (e) {
        const err = e as { stderr?: string; stdout?: string }
        const tail = `${err.stderr ?? ''}${err.stdout ?? ''}`.trim().split('\n').slice(-25).join('\n')
        results.push({ target: t, ok: false, seconds: (Date.now() - started) / 1000, tail })
        console.log(`FAIL  ${t}\n${tail}\n`)
      }
    }
  })
  await Promise.all(workers)
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} built`)
  if (failed.length) {
    console.log(`failed: ${failed.map((f) => f.target).join(', ')}`)
    process.exit(1)
  }
}

main()
