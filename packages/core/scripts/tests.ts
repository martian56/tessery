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
  assert.match(files[`${app}/app/layout.tsx`], /className="tsp tsp-app"/)
  assert.match(files[`${app}/components/form.tsx`], /<FormView /)
  assert.match(files[`${app}/Dockerfile`], /COPY --from=build \/app\/public \.\/public/, 'uploaded images in public/ ship with the app')
  assert.ok(files[`${app}/public/robots.txt`], 'public/ always exists, so the copy cannot fail')

  const TREE_SOURCE = (await import('../src/render/tree.source.txt')).default
  assert.equal(TREE_SOURCE, readFileSync(new URL('../src/render/tree.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n'), 'src/render/tree.source.txt is stale; run npm run embed')
  assert.equal(files[`${app}/components/tree.tsx`], TREE_SOURCE)
  const home = doc.pages.find((p) => p.route === '/')!
  const source = files[`${app}/app/page.tsx`]
  assert.match(source, /<Tree root=\{root\} theme=\{theme\} blocks=\{BLOCKS\} defaults=\{BLOCK_DEFAULTS\}/)
  assert.ok(source.includes(JSON.stringify(home.root)), 'the page ships its element tree as designed')
  assert.match(files[`${app}/components/index.tsx`], /"navbar": B\.Navbar/)
  assert.match(files[`${app}/components/index.tsx`], /"links": "Product, Pricing, Docs"/, 'block defaults the editor shows ship with the app')
})

test('pages saved as block lists become element trees with the same ids', () => {
  const raw = { id: 'p', name: 'old', nodes: [], pages: [{ id: 'pg1', appNodeId: 'web', name: 'Home', route: '/', render: 'ssr', access: 'public', title: 'Home', blocks: [{ id: 'b1', type: 'hero', props: { headline: 'Hi' } }] }] }
  const doc = normalizeDoc(raw)
  const root = doc.pages[0].root
  assert.equal(root.type, 'frame')
  assert.deepEqual(root.children, [{ id: 'b1', type: 'block', props: { block: 'hero', headline: 'Hi' } }])
  assert.deepEqual(doc.pages[0].blocks, [])
  assert.deepEqual(normalizeDoc(doc).pages[0].root, root, 'normalizing twice changes nothing')
})

test('element operations build, restyle, move and group the tree', async () => {
  const { find } = await import('../src/domain/tree')
  const doc = tasksTemplate()
  const page = doc.pages[0]
  const hero = runOp(doc, 'addElement', { pageId: page.id, element: { type: 'frame', name: 'Hero', style: { display: 'grid', gap: 24 }, children: [{ type: 'text', props: { tag: 'h1', text: 'Ship faster' } }, { type: 'button', props: { text: 'Start', href: '/signup' } }] } }) as string
  const heroEl = find(page.root, hero)!.el
  assert.equal(heroEl.children!.length, 2)
  assert.notEqual(heroEl.children![0].id, heroEl.children![1].id)
  const title = heroEl.children![0].id
  runOp(doc, 'updateElement', { pageId: page.id, elementId: title, patch: { style: { fontSize: 64, color: 'var(--c-primary)' }, mobile: { fontSize: 36 }, props: { text: 'Ship today' } } })
  runOp(doc, 'updateElement', { pageId: page.id, elementId: title, patch: { style: { color: null } } })
  const t = find(page.root, title)!.el
  assert.deepEqual(t.style, { fontSize: 64 }, 'null removes a declaration')
  assert.deepEqual(t.mobile, { fontSize: 36 })
  assert.equal(t.props.text, 'Ship today')
  assert.throws(() => runOp(doc, 'moveElement', { pageId: page.id, elementId: hero, parentId: hero, index: 0 }), /inside itself/)
  assert.throws(() => runOp(doc, 'addElement', { pageId: page.id, parentId: title, element: { type: 'text' } }), /inside a frame/)
  assert.throws(() => runOp(doc, 'addElement', { pageId: page.id, element: { type: 'marquee' as never } }), /unknown element type/)
  const button = heroEl.children![1].id
  runOp(doc, 'moveElement', { pageId: page.id, elementId: button, parentId: page.root.id, index: 0 })
  assert.equal(page.root.children![0].id, button)
  const copy = runOp(doc, 'duplicateElement', { pageId: page.id, elementId: hero }) as string
  assert.notEqual(find(page.root, copy)!.el.children![0].id, title, 'copies get new ids all the way down')
  const group = runOp(doc, 'groupElements', { pageId: page.id, elementIds: [hero, copy] }) as string
  assert.deepEqual(find(page.root, group)!.el.children!.map((c) => c.id), [hero, copy])
  runOp(doc, 'removeElement', { pageId: page.id, elementId: group })
  assert.equal(find(page.root, hero), null)
  const block = runOp(doc, 'addBlock', { pageId: page.id, type: 'faq', props: {} }) as string
  assert.equal(find(page.root, block)!.el.type, 'block', 'addBlock still works for agents and templates')
  runOp(doc, 'setTheme', { appNodeId: page.appNodeId, colors: { primary: '#2563eb' }, fonts: { heading: 'Fraunces' } })
  assert.equal(doc.themes[page.appNodeId].colors.primary, '#2563eb')
  assert.equal(doc.themes[page.appNodeId].fonts.body, 'system-ui')
})

test('page CSS covers breakpoints, hover and fonts and refuses injected rules', async () => {
  const { treeCss } = await import('../src/render/tree')
  const { DEFAULT_THEME } = await import('../src/domain/tree')
  const root: import('../src/render/tree').El = { id: 'r', type: 'frame', props: {}, style: { display: 'flex', gap: 16 }, children: [
    { id: 'a', type: 'text', props: {}, style: { fontSize: 48, color: 'red;}</style><script>alert(1)</script>' }, tablet: { fontSize: 36 }, mobile: { fontSize: 28 }, hover: { opacity: 0.8 } },
    { id: 'b', type: 'shape', props: {}, style: { backgroundImage: 'asset:0193f3a4-0000-7000-8000-000000000001/bg.png', background: 'url(javascript:alert(1))', position: 'absolute', left: 0 } },
  ] }
  const css = treeCss(root, { ...DEFAULT_THEME, fonts: { heading: 'Fraunces', body: 'Inter' } }, '/assets/')
  assert.match(css, /\.n-r\{display:flex;gap:16px\}/)
  assert.match(css, /:is\(\.n-a:hover\)\{opacity:0\.8\}/)
  assert.match(css, /@container \(max-width: 900px\)\{\.n-a\{font-size:36px\}\}/)
  assert.match(css, /@container \(max-width: 600px\)\{\.n-a\{font-size:28px\}\}/)
  assert.match(css, /background-image:url\("\/assets\/0193f3a4-0000-7000-8000-000000000001\/bg\.png"\)/)
  assert.match(css, /family=Fraunces/)
  assert.match(css, /--font-body:"Inter"/)
  assert.ok(!css.includes('</style>') && !css.includes('javascript:') && !css.includes('alert'), css)
})

test('record frames, placeholders, states, dark colors and icons render the way apps need them', async () => {
  const { treeCss, fill, records } = await import('../src/render/tree')
  const { DEFAULT_THEME, blocksOf } = await import('../src/domain/tree')
  assert.deepEqual(records({ items: [{ id: 1 }] }), [{ id: 1 }])
  assert.deepEqual(records([{ id: 2 }]), [{ id: 2 }])
  assert.deepEqual(records(null), [])
  assert.deepEqual(records({ id: 3, name: 'one' }), [{ id: 3, name: 'one' }], 'a detail response is one record')
  const row = { id: 'a b', title: 'Fix login', price: 1234.5, author: { name: 'Ada Lovelace' } }
  assert.equal(fill('{title} by {author.name} ({author.name|initials})', row), 'Fix login by Ada Lovelace (AL)')
  assert.equal(fill('{price|money}', row), '$1,234.50')
  assert.equal(fill('/issues/{id}', row, true), '/issues/a%20b', 'values in links are encoded')
  assert.equal(fill('{title}', undefined), '{title}', 'text outside a record frame stays as written')

  const root: import('../src/render/tree').El = { id: 'r', type: 'frame', props: {}, children: [
    { id: 'link', type: 'text', props: { text: 'Inbox', href: '/inbox' }, current: { fontWeight: 600 }, focus: { outline: '2px solid red' }, active: { scale: 0.98 } },
    { id: 'bar', type: 'frame', props: { tag: 'form' }, focus: { borderColor: 'var(--c-primary)' } },
  ] }
  const css = treeCss(root, { ...DEFAULT_THEME, fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' }, dark: { bg: '#101418', text: '#e8eaed' } })
  assert.match(css, /:is\(\.n-link\[aria-current="page"\],[^)]*\)\{font-weight:600\}/)
  assert.match(css, /:is\(\.n-link:focus-visible\)\{outline:2px solid red\}/)
  assert.match(css, /:is\(\.n-link:active\)\{scale:0\.98\}/)
  assert.match(css, /:is\(\.n-bar:focus-within\)\{border-color:var\(--c-primary\)\}/, 'a frame lights up while its input has focus')
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{\.tsp-tree\{--c-bg:#101418;--c-text:#e8eaed;color-scheme:dark\}\}/)
  assert.match(css, /family=JetBrains\+Mono/)

  const doc = tasksTemplate()
  const home = doc.pages.find((p) => p.route === '/')!
  const svc = doc.nodes.find((n) => n.techId === 'service' && doc.apis[n.id]?.operations.some((o) => o.name.startsWith('list')))!
  const op = doc.apis[svc.id].operations.find((o) => o.name.startsWith('list'))!
  const list = runOp(doc, 'addElement', { pageId: home.id, element: { type: 'frame', props: { source: `${svc.id}:${op.name}` }, children: [
    { type: 'frame', props: { href: '/projects/{id}' }, children: [{ type: 'icon', props: { name: 'folder' } }, { type: 'text', props: { text: '{name}' } }] },
  ] } }) as string
  assert.ok(blocksOf(home.root).some((e) => e.id === list), 'record frames load data like blocks')
  const files = generateAll(doc)
  const app = Object.keys(files).find((f) => f.endsWith('/components/tree.tsx'))!.replace('/components/tree.tsx', '')
  const page = files[`${app}/app/page.tsx`]
  assert.ok(page.includes(`${JSON.stringify(list)}: data`), 'the page passes the loaded records to the frame')
  assert.match(page, /icon=\{Icon\} path=\{"\/"\}/)
  assert.match(files[`${app}/components/icon.tsx`], /from 'lucide-react'/)
  assert.match(files[`${app}/components/icon.tsx`], /BY_NAME\.get\(squash\(name\)\)/, 'any spelling of an icon name resolves')
  assert.ok(JSON.parse(files[`${app}/package.json`]).dependencies['lucide-react'])
  const detail = Object.keys(files).find((f) => f.startsWith(`${app}/app/`) && f.includes('[') && f.endsWith('page.tsx'))
  if (detail) assert.match(files[detail], /path=\{`\/[^`]*\$\{\w+\}`\}/, 'dynamic pages pass their real path')
  assert.throws(() => runOp(doc, 'addElement', { pageId: home.id, element: { type: 'marquee' as never } }))
})

test('pages only load from read operations, and popover links survive copies', async () => {
  const { readsOnly } = await import('../src/codegen/services/model')
  const { analyze } = await import('../src/analysis')
  assert.ok(readsOnly('rest', { kind: 'GET /items', name: 'listItems' }))
  assert.ok(!readsOnly('rest', { kind: 'DELETE /items/{id}', name: 'deleteItem' }))
  assert.ok(readsOnly('graphql', { kind: 'query', name: 'items' }) && !readsOnly('graphql', { kind: 'mutation', name: 'addItem' }))
  assert.ok(readsOnly('grpc', { kind: 'unary', name: 'ListItems' }) && !readsOnly('grpc', { kind: 'unary', name: 'RemoveItem' }))

  const doc = tasksTemplate()
  const home = doc.pages.find((p) => p.route === '/')!
  const svc = doc.nodes.find((n) => doc.apis[n.id]?.operations.some((o) => o.name === 'deleteTask'))!
  const bad = runOp(doc, 'addElement', { pageId: home.id, element: { type: 'frame', name: 'Danger', props: { source: `${svc.id}:deleteTask` }, children: [{ type: 'text', props: { text: '{title}' } }] } }) as string
  const page = Object.entries(generateAll(doc)).find(([f]) => f.endsWith('/app/page.tsx'))![1]
  assert.ok(!page.includes('.deleteTask('), 'rendering a page never calls an operation that changes data')
  assert.ok(analyze(doc, undefined, null).some((x) => x.target?.blockId === bad && /changes data/.test(x.message)), 'the design check names the problem')

  const menu = runOp(doc, 'addElement', { pageId: home.id, element: { type: 'frame', name: 'Menu', children: [
    { type: 'button', name: 'Open', props: { text: 'Options', opens: 'List' } },
    { type: 'frame', name: 'List', props: { popover: true } },
  ] } }) as string
  const { find } = await import('../src/domain/tree')
  const m = find(home.root, menu)!.el
  assert.equal(m.children![0].props.opens, m.children![1].id, 'a button can name the popover it opens')
  const copy = runOp(doc, 'duplicateElement', { pageId: home.id, elementId: menu }) as string
  const c = find(home.root, copy)!.el
  assert.equal(c.children![0].props.opens, c.children![1].id, 'a copied button opens the copied popover')
  assert.notEqual(c.children![1].id, m.children![1].id)
})

test('lists search, filter, sort and page, and pages pass their query along', async () => {
  const { fill, sameQuery } = await import('../src/render/tree')
  assert.equal(fill('Results for {?q}', undefined, false, { q: 'bean' }), 'Results for bean')
  assert.equal(fill('/search?q={?q}', undefined, true, { q: 'a&b' }), '/search?q=a%26b')
  assert.ok(sameQuery('?crop=Bean', { crop: 'Bean' }) && !sameQuery('?crop=Bean', { crop: 'Tomato' }))
  assert.ok(sameQuery('?', {}) && sameQuery('?', { page: '2' }) && !sameQuery('?', { crop: 'Bean' }))

  const doc = tasksTemplate()
  const files = generateAll(doc)
  const app = Object.keys(files).find((f) => f.endsWith('/lib/api.ts'))!.replace('/lib/api.ts', '')
  assert.match(files[`${app}/lib/api.ts`], /withQuery\(`[^`]*`, opts\?\.query\)/, 'GET calls carry the query')
  const home = files[`${app}/app/page.tsx`]
  assert.match(home, /searchParams: Promise<Record<string, string \| string\[\] \| undefined>>/)
  assert.match(home, /listProjects\(\{ token, query: search \}\)/)
  assert.match(home, /query=\{search\}/)
  const svc = Object.entries(files).find(([f, s]) => f.endsWith('.ts') && s.includes('= table("projects"'))![1]
  assert.match(svc, /table\("projects", "id", \{[^}]*"name":"text"[^}]*\}, \[/, 'tables know their column types')
  const runtime = Object.entries(files).find(([f, s]) => f.endsWith('db.ts') && s.includes('export function table('))![1]
  for (const piece of ["RESERVED = new Set(['limit', 'offset', 'page', 'q', 'sort'])", 'ILIKE $', "sort.startsWith('-') ? 'DESC' : 'ASC'"]) assert.ok(runtime.includes(piece), piece)

  const ssg = doc.pages.find((p) => p.route === '/')!
  runOp(doc, 'updatePage', { pageId: ssg.id, patch: { render: 'ssg' } })
  const again = generateAll(doc)[`${app}/app/page.tsx`]
  assert.ok(!again.includes('searchParams'), 'static pages do not read the query')
})

test('query values stay literal and casts never truncate', async () => {
  const { fill } = await import('../src/render/tree')
  assert.equal(fill('{?q}', { name: 'Bean' }, false, { q: '{name}' }), '{name}', 'a query value is not read as a record placeholder')
  assert.equal(fill('{?q} {name}', { name: 'Bean' }, false, { q: 'x' }), 'x Bean')
  const { columnTypes } = await import('../src/codegen/services/crud')
  const { sqlType } = await import('../src/codegen/backend')
  const types = columnTypes({ id: 't', name: 'items', columns: [
    { id: 'a', name: 'id', type: 'serial', nullable: false, pk: true },
    { id: 'b', name: 'code', type: 'varchar', length: 3, nullable: false },
    { id: 'c', name: 'price', type: 'numeric', nullable: false },
  ], indexes: [] } as never, (c) => sqlType(c, 'pg'))
  assert.deepEqual(types, { id: 'bigint', code: 'varchar', price: 'numeric' })
})

test('themes start from presets and carry a logo and favicon into the app', async () => {
  const { THEME_PRESETS } = await import('../src/domain/themes')
  const { themeOf } = await import('../src/domain/tree')
  const doc = tasksTemplate()
  const web = doc.nodes.find((n) => n.techId === 'web-app')!
  runOp(doc, 'setTheme', { appNodeId: web.id, preset: 'ledger', colors: { primary: '#225544' }, logo: 'asset:0193f3a4-0000-7000-8000-000000000001/logo.svg', favicon: 'asset:0193f3a4-0000-7000-8000-000000000001/icon.png' })
  const t = themeOf(doc, web.id)
  assert.equal(t.fonts.heading, THEME_PRESETS.ledger.theme.fonts.heading)
  assert.equal(t.colors.primary, '#225544', 'fields given with a preset override it')
  assert.equal(t.dark?.primary, THEME_PRESETS.ledger.theme.dark!.primary)
  runOp(doc, 'setTheme', { appNodeId: web.id, colors: { stamp: '#B07A0E' } })
  runOp(doc, 'setTheme', { appNodeId: web.id, preset: 'signal' })
  assert.equal(themeOf(doc, web.id).colors.stamp, '#B07A0E', 'custom color tokens survive a preset')
  assert.equal(themeOf(doc, web.id).logo, 'asset:0193f3a4-0000-7000-8000-000000000001/logo.svg', 'switching presets keeps the brand')
  assert.throws(() => runOp(doc, 'setTheme', { appNodeId: web.id, preset: 'neon' }))

  const files = generateAll(doc)
  const app = `apps/${web.name}`
  assert.match(files[`${app}/app/layout.tsx`], /"icons":\{"icon":"\/assets\/0193f3a4-0000-7000-8000-000000000001\/icon\.png"\}/)
  assert.match(files[`${app}/app/globals.css`], /^@import url\("https:\/\/fonts\.googleapis\.com/, 'theme fonts load before any other rule')
  assert.match(files[`${app}/app/globals.css`], /\.tsp-app\{--c-bg:#FFFFFF/, 'pages outside the tree, like sign-in, use the theme')
  runOp(doc, 'setTheme', { appNodeId: web.id, logo: null })
  assert.equal(themeOf(doc, web.id).logo, undefined)
})

test('designed forms post to operations and act on the record they sit in', async () => {
  const { actionPath } = await import('../src/render/tree')
  assert.equal(actionPath('/v1/borrowings/{id}', { id: 'b 1' }, { id: 'v1' }), '/v1/borrowings/b%201', 'the record wins over a page param of the same name')
  assert.equal(actionPath('/v1/varieties/{varietyId}/borrowings', { name: 'x' }, { id: 'v1' }), '/v1/varieties/v1/borrowings', 'a page param fills by position')
  assert.equal(actionPath('/v1/items/{id}', undefined, {}), '/v1/items/')

  const doc = tasksTemplate()
  const home = doc.pages.find((p) => p.route === '/')!
  const svc = doc.nodes.find((n) => doc.apis[n.id]?.operations.some((o) => o.name === 'updateTask'))!
  const form = runOp(doc, 'addElement', { pageId: home.id, element: { type: 'frame', props: { tag: 'form', action: `${svc.id}:updateTask` }, children: [
    { type: 'input', props: { kind: 'hidden', name: 'done', value: 'true' } }, { type: 'button', props: { text: 'Mark done', submit: true } },
  ] } }) as string
  const files = generateAll(doc)
  const app = Object.keys(files).find((f) => f.endsWith('/lib/api.ts'))!.replace('/lib/api.ts', '')
  const page = files[`${app}/app/page.tsx`]
  assert.ok(page.includes(`${JSON.stringify(form)}: { service: ${JSON.stringify(svc.name)}, method: "PATCH", path: "`), 'the page knows where the form goes')
  const route = files[`${app}/app/form-action/[service]/[...path]/route.ts`]
  assert.match(route, /if \(!sameSite\(req\)\)/, 'cross-site posts are refused')
  assert.match(route, /back\.startsWith\('\/'\) && !back\.startsWith\('\/\/'\)/, 'it only sends visitors back to this site')
  assert.match(route, /status: 303/)
})

test('elements can show only when the query or the record says so', async () => {
  const { shows } = await import('../src/render/tree')
  assert.ok(shows('?error', undefined, { error: '409' }) && !shows('?error', undefined, {}))
  assert.ok(shows('!packets', { packets: 0 }, {}) && !shows('packets', { packets: 0 }, {}))
  assert.ok(shows('status=done', { status: 'done' }, {}) && shows('status!=done', { status: 'open' }, {}))
  assert.ok(shows('author.name', { author: { name: 'Ada' } }, {}))
  assert.ok(shows('', undefined, {}))
})

test('an empty list says whether nothing exists or nothing matched', async () => {
  const { filtered } = await import('../src/render/tree')
  assert.ok(!filtered(undefined) && !filtered({}) && !filtered({ page: '2' }) && !filtered({ q: '' }))
  assert.ok(filtered({ q: 'bean' }) && filtered({ crop: ['Bean'] }))
})
