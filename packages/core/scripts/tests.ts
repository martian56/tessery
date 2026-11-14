import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runOp } from '../src/domain/ops'
import { normalizeDoc } from '../src/domain/normalize'
import { blankTemplate } from '../src/templates/blank'
import { tasksTemplate } from '../src/templates/tasks'
import { migrationSql } from '../src/codegen/backend'
import { crudRoute, tableForOperation } from '../src/codegen/services/crud'
import { httpRoute } from '../src/codegen/services/model'
import { plan, secrets, workloads } from '../src/codegen/deploy'
import { manifests } from '../src/codegen/deploy/kubernetes'
import { envCompose } from '../src/codegen/deploy/compose'
import { yamlDoc } from '../src/codegen/deploy/yaml'
import { generateAll, parseMigrationState, planMigrations } from '../src/codegen'

function shop() {
  const doc = blankTemplate('shop', 'self', 'onprem')
  const api = runOp(doc, 'addNode', { techId: 'service', x: 0, y: 0, name: 'orders', config: { language: 'Go' } }) as string
  const db = runOp(doc, 'addNode', { techId: 'postgres', x: 0, y: 0, name: 'orders-db' }) as string
  runOp(doc, 'connect', { source: api, target: db })
  const table = runOp(doc, 'addTable', { nodeId: db, name: 'orders' }) as string
  runOp(doc, 'addColumn', { nodeId: db, tableId: table, column: { name: 'total', type: 'int', nullable: false } })
  return { doc, api, db, table }
}

test('nodes added on the same spot are placed apart', () => {
  const { doc } = shop()
  const [a, b] = doc.nodes
  assert.ok(Math.abs(a.x - b.x) >= 200 || Math.abs(a.y - b.y) >= 140)
})

test('REST paths map onto tables, including nested ones', () => {
  const { doc, db } = shop()
  const schema = doc.databases[db]
  const route = (kind: string) => httpRoute({ id: 'o', kind, name: 'x', summary: '', auth: 'user', steps: [] })!
  assert.equal(crudRoute(route('GET /orders'), schema)?.action, 'list')
  assert.equal(crudRoute(route('GET /orders/{id}'), schema)?.action, 'get')
  assert.equal(crudRoute(route('PATCH /api/v1/order/{id}'), schema)?.action, 'update', 'singular names and prefixes match')
  assert.equal(crudRoute(route('POST /orders/{id}'), schema), undefined, 'POST to an item is not CRUD')
  assert.equal(crudRoute(route('GET /refunds'), schema), undefined)
})

test('addCrudOperations adds five endpoints once', () => {
  const { doc, api } = shop()
  assert.equal((runOp(doc, 'addCrudOperations', { nodeId: api, table: 'orders' }) as string[]).length, 5)
  assert.equal((runOp(doc, 'addCrudOperations', { nodeId: api, table: 'orders' }) as string[]).length, 0)
  assert.deepEqual(doc.apis[api].operations.map((o) => o.name), ['listOrders', 'getOrder', 'createOrder', 'updateOrder', 'deleteOrder'])
  assert.equal(tableForOperation(doc, api, 'createOrder')?.table.name, 'orders')
})

test('schema scripts are additive and ordered by foreign keys', () => {
  const doc = tasksTemplate()
  const db = doc.nodes.find((n) => n.techId === 'postgres')!
  const sql = migrationSql(doc.databases[db.id], 'postgres')
  assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS projects') < sql.indexOf('CREATE TABLE IF NOT EXISTS tasks'), 'referenced tables first')
  assert.match(sql, /ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "title"/)
  assert.doesNotMatch(sql, /DROP/)
})

test('YAML quotes what needs quoting', () => {
  const out = yamlDoc({ a: 'yes', b: '${X}', c: 3, d: [{ e: 'plain' }], f: {} } as never)
  assert.equal(out, 'a: "yes"\nb: "${X}"\nc: 3\nd:\n  - e: plain\n')
})

test('the built-in identity provider adds a generated session secret everywhere it is needed', () => {
  const doc = tasksTemplate()
  const env = doc.environments[0]
  assert.ok(secrets(doc, env).some((s) => s.name === 'AUTH_SECRET' && s.generate))
  for (const w of workloads(doc, env).filter((w) => w.role === 'app')) assert.equal(w.env.AUTH_SECRET, '${AUTH_SECRET}', w.name)
  const web = workloads(doc, env).find((w) => w.name === 'web')!
  assert.equal(web.env.ACCOUNTS_URL, 'http://accounts:8080')
})

test('docker plans publish only public nodes and list health checks', () => {
  const doc = tasksTemplate()
  const p = plan(doc, doc.environments[0])
  assert.deepEqual(p.endpoints.map((e) => e.name), ['web'])
  assert.ok(p.checks.some((c) => c.name === 'tasks-api' && c.path === '/healthz'))
  assert.match(envCompose(doc, doc.environments[0]), /TASKS_DB_PASSWORD/)
})

test('kubernetes manifests reference secrets instead of embedding them', () => {
  const doc = normalizeDoc(tasksTemplate())
  const env = { ...doc.environments[0], target: { kind: 'kubernetes' as const, domain: 'example.com' } }
  const yaml = manifests(doc, env)
  assert.match(yaml, /secretKeyRef:\n\s+name: tessery-secrets\n\s+key: TASKS_DB_PASSWORD/)
  assert.match(yaml, /postgres:\/\/app:\$\(TASKS_DB_PASSWORD\)@tasks-db/)
  assert.match(yaml, /host: web\.tasks-dev\.example\.com/)
})

test('generated pages never reference data they do not load', () => {
  const doc = tasksTemplate()
  const page = doc.pages[0]
  runOp(doc, 'addBlock', { pageId: page.id, type: 'table', props: { source: 'missing:op', columns: 'A' } })
  const files = generateAll(doc)
  const src = files['apps/web/app/page.tsx']
  for (const m of src.matchAll(/data=\{(data\d+)\}/g)) assert.match(src, new RegExp(`const ${m[1]} =`), m[1])
})

test('a REST base path prefixes service routes, the client and form actions alike', () => {
  const doc = tasksTemplate()
  const api = doc.nodes.find((n) => n.name === 'tasks-api')!
  runOp(doc, 'updateApi', { nodeId: api.id, patch: { basePath: '/v1' } })
  const files = generateAll(doc)
  assert.match(files['services/tasks-api/src/routes.ts'], /app\.get\("\/v1\/projects"/)
  assert.match(files['apps/web/lib/api.ts'], /\/v1\/projects/)
  assert.match(files['apps/web/app/page.tsx'], /path: `\/v1\/projects`/)
})

test('the local development stack works without any secrets set', () => {
  const compose = generateAll(tasksTemplate())['compose.yaml']
  assert.match(compose, /AUTH_SECRET: "\$\{AUTH_SECRET:-dev\}"/)
  assert.match(compose, /\$\{TASKS_DB_PASSWORD:-dev\}/)
  assert.doesNotMatch(compose, /\$\{[A-Z0-9_]+\}/, 'every reference has a default')
  const hostPorts = [...compose.matchAll(/"\$\{[A-Z0-9_]+_PORT:-(\d+)\}:\d+"/g)].map((m) => m[1])
  assert.equal(new Set(hostPorts).size, hostPorts.length, `host ports collide: ${hostPorts}`)
})

test('partial documents are completed with defaults', () => {
  const doc = normalizeDoc({ name: 'x', nodes: [{ id: 'n', techId: 'service' }], edges: [], environments: [{ id: 'dev' }] })
  assert.equal(doc.nodes[0].replicas, 1)
  assert.deepEqual(doc.environments[0].overrides, {})
  assert.equal(doc.observability.metrics, 'Prometheus')
  assert.ok(Array.isArray(doc.groups) && Array.isArray(doc.pages))
})

test('collections of the wrong shape are replaced instead of crashing the editor', () => {
  const doc = normalizeDoc({ name: 'x', nodes: [], edges: [], pages: {}, apis: [], databases: 'none', environments: null })
  assert.deepEqual(doc.pages, [])
  assert.deepEqual(doc.apis, {})
  assert.deepEqual(doc.databases, {})
  assert.deepEqual(doc.environments, [])
})

test('app containers send traces to whatever endpoint Tessery provides, and nothing when it is empty', () => {
  const doc = tasksTemplate()
  const api = workloads(doc, doc.environments[0]).find((w) => w.name === 'tasks-api')!
  assert.equal(api.env.OTEL_EXPORTER_OTLP_ENDPOINT, '${TESSERY_OTLP_ENDPOINT}')
  assert.equal(api.env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/protobuf')
  const db = workloads(doc, doc.environments[0]).find((w) => w.name === 'tasks-db')!
  assert.equal(db.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined, 'data stores get no telemetry settings')
  assert.match(envCompose(doc, doc.environments[0]), /host\.docker\.internal:host-gateway/)
  assert.ok(!secrets(doc, doc.environments[0]).some((s) => s.name.startsWith('TESSERY_OTLP')), 'Tessery fills these itself')
})

test('remote docker hosts do not get the local host mapping', () => {
  const doc = tasksTemplate()
  const env = { ...doc.environments[0], target: { kind: 'docker' as const, host: 'ssh://deploy@203.0.113.7' } }
  assert.doesNotMatch(envCompose(doc, env), /host-gateway/)
})

test('the local stack publishes stable uncommon ports that local configs agree on', () => {
  const doc = tasksTemplate()
  const files = generateAll(doc)
  const compose = files['compose.yaml']
  const published = [...compose.matchAll(/_PORT:-(\d+)\}:(\d+)/g)].map((m) => Number(m[1]))
  assert.ok(published.length >= 4)
  assert.equal(new Set(published).size, published.length, 'every service gets its own host port')
  assert.ok(published.every((p) => p >= 20000 && p <= 29999), `ports stay out of the common range: ${published}`)
  assert.equal(generateAll(doc)['compose.yaml'], compose, 'the same design always gets the same ports')
  const api = Object.entries(files).find(([k]) => k.endsWith('lib/api.ts'))![1]
  const apiPort = Number(compose.match(/TASKS_API_PORT:-(\d+)/)![1])
  assert.match(api, new RegExp(`"tasks-api": "http://localhost:${apiPort}"`), 'the web app reaches tasks-api where compose publishes it')
  const dbPort = Number(compose.match(/TASKS_DB_PORT:-(\d+)/)![1])
  const config = Object.entries(files).filter(([k]) => k.startsWith('services/tasks-api/')).map(([, v]) => v).join('\n')
  assert.match(config, new RegExp(`localhost:${dbPort}/`), 'the service falls back to the published database port')
})

test('docker targets with a domain route public nodes through the shared HTTPS proxy', () => {
  const doc = tasksTemplate()
  const base = doc.environments[0]
  const publicNames = workloads(doc, base).filter((w) => w.public && w.port && !w.schedule).map((w) => w.name)
  assert.ok(publicNames.length >= 1)
  const [first] = publicNames
  const env = { ...base, target: { kind: 'docker' as const, domain: 'apps.example.com', hosts: { [first]: 'tasks.example.com' } } }
  const compose = envCompose(doc, env)
  assert.match(compose, /caddy: tasks\.example\.com/)
  assert.match(compose, /name: tessery-proxy\n\s+external: true/)
  assert.doesNotMatch(compose, /^\s+- "\d+:\d+"$/m, 'no host ports are published')
  const urls = plan(doc, env).endpoints.map((e) => e.url)
  assert.ok(urls.includes('https://tasks.example.com'))
  assert.ok(urls.every((u) => u.startsWith('https://')))
  const plain = plan(doc, { ...base, target: { kind: 'docker' as const } })
  assert.ok(plain.endpoints.every((e) => e.url.startsWith('http://localhost:')))
  assert.doesNotMatch(envCompose(doc, { ...base, target: { kind: 'docker' as const } }), /tessery-proxy/)
})

test('docker domains accept only plain host names', () => {
  const doc = tasksTemplate()
  const base = doc.environments[0]
  const at = (target: Record<string, unknown>) => plan(doc, { ...base, target: { kind: 'docker' as const, ...target } }).endpoints.map((e) => e.url)
  assert.ok(at({ domain: 'https://apps.example.com' }).every((u) => u.startsWith('http://localhost:')), 'a URL is not a domain')
  assert.ok(at({ domain: 'apps.example.com', hosts: { web: 'https://shop.example.com/x' } }).includes('https://web.apps.example.com'), 'a bad override falls back')
  assert.ok(at({ hosts: { web: 'shop.example.com' } }).every((u) => u.startsWith('http://localhost:')), 'overrides need a domain')
})

test('design changes become numbered migrations that keep data', () => {
  const { doc, db, table } = shop()
  const first = planMigrations(doc)
  assert.deepEqual(first.databases[db].migrations.map((m) => m.file), ['0001_init.sql'])
  assert.equal(planMigrations(doc, first).databases[db].migrations.length, 1, 'no change, no new migration')

  const total = doc.databases[db].tables[0].columns.find((c) => c.name === 'total')!
  runOp(doc, 'updateColumn', { nodeId: db, tableId: table, columnId: total.id, patch: { name: 'amount' } })
  runOp(doc, 'addColumn', { nodeId: db, tableId: table, column: { name: 'note', type: 'text', nullable: true } })
  const second = planMigrations(doc, first)
  const m2 = second.databases[db].migrations[1]
  assert.equal(m2.file, '0002_rename_orders_total_to_amount.sql')
  assert.match(m2.sql, /RENAME COLUMN "total" TO "amount"/)
  assert.match(m2.sql, /ADD COLUMN "note" text/)
  assert.doesNotMatch(m2.sql, /DROP COLUMN/, 'a rename never turns into drop and add')
  assert.deepEqual(m2.destructive, [])

  runOp(doc, 'removeColumn', { nodeId: db, tableId: table, columnId: total.id })
  const third = planMigrations(doc, second)
  const m3 = third.databases[db].migrations[2]
  assert.match(m3.sql, /DROP COLUMN "amount"/)
  assert.ok(m3.destructive.some((d) => d.includes('orders.amount')))
  assert.match(m3.sql, /^-- destructive: /m)

  const files = generateAll(doc, third)
  assert.ok(files['db/orders-db/migrations/0003_drop_orders_amount.sql'])
  assert.ok(generateAll(tasksTemplate())['services/tasks-api/migrations/tasks-db/0001_init.sql'], 'services ship their migrations')
  assert.deepEqual(parseMigrationState(JSON.parse(files['db/migrations.json'])), third)
})

test('removing the last table still drops it and keeps the history', () => {
  const { doc, db, table } = shop()
  const first = planMigrations(doc)
  runOp(doc, 'removeTable', { nodeId: db, tableId: table })
  const next = planMigrations(doc, first).databases[db]
  assert.equal(next.migrations.length, 2)
  assert.match(next.migrations[1].sql, /DROP TABLE orders;/)
  assert.ok(next.migrations[1].destructive.length)
})

test('public nodes with several replicas and no domain still get host ports', () => {
  const doc = tasksTemplate()
  const env = { ...doc.environments[0], scale: 2, target: { kind: 'docker' as const } }
  const web = workloads(doc, env).find((w) => w.public && w.port && !w.schedule)!
  const compose = envCompose(doc, env)
  const port = plan(doc, env).endpoints.find((e) => e.name === web.name)!.url.split(':').pop()
  assert.ok(compose.includes(`"${port}-${Number(port) + 1}:${web.port}"`), 'each replica takes a port from a small range starting at the endpoint port')
})

test('generated web apps render pages with the same blocks and styles as the editor', async () => {
  const { readFileSync } = await import('node:fs')
  const BLOCKS_SOURCE = (await import('../src/render/blocks.source.txt')).default
  const STYLES = (await import('../src/render/styles.txt')).default
  const tsx = readFileSync(new URL('../src/render/blocks.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(BLOCKS_SOURCE, tsx, 'src/render/blocks.source.txt is stale; run npm run embed')

  const doc = tasksTemplate()
  const files = generateAll(doc)
  const app = Object.keys(files).find((f) => f.endsWith('/components/blocks.tsx'))!.replace('/components/blocks.tsx', '')
  assert.equal(files[`${app}/components/blocks.tsx`], BLOCKS_SOURCE)
  assert.ok(files[`${app}/app/globals.css`].includes(STYLES))
  assert.match(files[`${app}/app/layout.tsx`], /className="tsp"/)
  assert.match(files[`${app}/components/form.tsx`], /<FormView /)
  assert.match(files[`${app}/Dockerfile`], /COPY --from=build \/app\/public \.\/public/, 'uploaded images in public/ ship with the app')
  assert.ok(files[`${app}/public/robots.txt`], 'public/ always exists, so the copy cannot fail')

  const page = doc.pages.find((p) => p.blocks.some((b) => b.type === 'navbar'))!
  const nav = page.blocks.find((b) => b.type === 'navbar')!
  delete nav.props.links
  const source = generateAll(doc)[`${app}/app/${page.route === '/' ? '' : page.route.slice(1) + '/'}page.tsx`]
  assert.match(source, /<Navbar[^>]* links="Product, Pricing, Docs"/, 'defaults the editor shows are passed to the deployed page')
})
