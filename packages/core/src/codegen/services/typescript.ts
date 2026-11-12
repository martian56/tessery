import DB_RUNTIME from '../runtime/ts-db.txt'
import SESSION_RUNTIME from '../runtime/ts-session.txt'
import AUTH_SERVICE from '../runtime/ts-auth-service.txt'
import { builtInAuth } from '../deploy/runtime'
import { migrationSql } from '../backend'
import { type Files, type Route, type ServiceModel, camel, comment, envExample, readme, stepLines } from './model'
import { type CrudRoute, type DataAccess, SQL_STORES, dataAccess, orderBy, primaryKey, writable } from './crud'

const DEPS: Record<string, string> = {
  fastify: '^5.12.0',
  '@fastify/websocket': '^11.3.0',
  hono: '^4.13.0',
  '@hono/node-server': '^2.1.0',
  express: '^5.3.0',
  '@apollo/server': '^5.5.0',
  '@as-integrations/express5': '^1.1.0',
  'graphql-yoga': '^5.24.0',
  graphql: '^16.11.0',
  '@grpc/grpc-js': '^1.14.0',
  '@grpc/proto-loader': '^0.8.0',
  pg: '^8.16.0',
  '@opentelemetry/api': '^1.10.0',
  '@opentelemetry/auto-instrumentations-node': '^0.82.0',
}
const DEV: Record<string, string> = { typescript: '^5.9.0', '@types/node': '^24.0.0', '@types/express': '^5.0.0', '@types/pg': '^8.15.0' }

type Server = 'fastify' | 'hono' | 'express' | 'apollo' | 'yoga' | 'grpc' | 'websocket'

function pick(m: ServiceModel): { server: Server; note?: string } {
  if (m.kind !== 'api') return { server: 'fastify' }
  if (m.style === 'graphql') return { server: m.frameworkId === 'yoga' ? 'yoga' : 'apollo', note: ['apollo', 'yoga'].includes(m.frameworkId) ? undefined : `${m.framework} is not generated yet; this GraphQL service uses Apollo Server.` }
  if (m.style === 'grpc') return { server: 'grpc', note: m.frameworkId === 'connect' ? undefined : `${m.framework || 'This framework'} is not generated yet; this gRPC service uses @grpc/grpc-js.` }
  if (m.style === 'websocket') return { server: 'websocket', note: m.frameworkId === 'uws' ? 'uWebSockets.js is not generated yet; sockets use @fastify/websocket.' : undefined }
  if (m.frameworkId === 'hono') return { server: 'hono' }
  if (m.frameworkId === 'express') return { server: 'express' }
  const fallback = ['nestjs', 'trpc', 'connect', 'apollo', 'yoga', 'uws'].includes(m.frameworkId) ? `${m.framework} is not generated for ${m.style} yet; routes use Fastify.` : undefined
  return { server: 'fastify', note: fallback }
}

const colon = (p: string) => p.replace(/\{(\w+)\}/g, ':$1')
const todo = (r: Route, indent: string) => comment(stepLines(r.op), '//', indent)

function config(m: ServiceModel): string {
  const deps = m.deps.map((d) => `  ${JSON.stringify(d.env)}: process.env.${d.env} ?? ${JSON.stringify(d.url)},`).join('\n')
  return `// Runtime configuration, read once from the environment.
export const config = {
  port: Number(process.env.PORT ?? ${m.port}),
  serviceName: process.env.OTEL_SERVICE_NAME ?? ${JSON.stringify(m.name)},
  dependencies: {
${deps}
  } as Record<string, string>,
}
`
}

type Access = { params: string; query: string; body: string }

const tableVar = (name: string) => `${camel(name)}Table`

function tables(da?: DataAccess): string {
  if (!da?.routes.length) return ''
  const used = [...new Map(da.routes.map((c) => [c.table.name, c.table])).values()]
  return used.map((t) => `const ${tableVar(t.name)} = table(${JSON.stringify(t.name)}, ${JSON.stringify(primaryKey(t)!.name)}, ${JSON.stringify(writable(t))}, ${JSON.stringify(orderBy(t))})`).join('\n') + '\n'
}

export const ownerColumn = (c: CrudRoute) => c.table.columns.find((x) => ['user_id', 'owner_id'].includes(x.name))?.name

function crudCall(c: CrudRoute, a: Access, owned = false): string {
  const t = tableVar(c.table.name)
  const owner = owned ? ownerColumn(c) : undefined
  const entries = [...(c.parent ? [`${JSON.stringify(c.parent.column)}: ${a.params}.${c.parent.param}`] : []), ...(owner ? [`${JSON.stringify(owner)}: session.sub`] : [])]
  const filter = entries.length ? `, { ${entries.join(', ')} }` : ''
  const id = `${a.params}.${c.idParam}`
  switch (c.action) {
    case 'list': return `${t}.list(${a.query}${filter})`
    case 'get': return `${t}.get(${id}${filter})`
    case 'create': return `${t}.create(${a.body}${filter})`
    case 'update': return `${t}.update(${id}, ${a.body}${filter})`
    case 'delete': return `${t}.remove(${id}${filter})`
  }
}

const crudFor = (da: DataAccess | undefined, r: Route) => da?.routes.find((c) => c.route === r)

const guarded = (m: ServiceModel, r: Route) => !!builtInAuth(m.doc) && (r.op.auth === 'user' || r.op.auth === 'admin')

function guard(m: ServiceModel, r: Route, headers: string, fail: (status: number, body: string) => string, indent: string): string {
  if (!guarded(m, r)) return ''
  const admin = r.op.auth === 'admin' ? `\n${indent}if (session.role !== 'admin') return ${fail(403, "{ error: 'forbidden' }")}` : ''
  return `${indent}const session = sessionFrom(${headers})\n${indent}if (!session) return ${fail(401, "{ error: 'unauthorized' }")}${admin}\n`
}

function fastifyRoutes(m: ServiceModel, da?: DataAccess): string {
  const a: Access = { params: '(req.params as Record<string, string>)', query: '(req.query as Record<string, unknown>)', body: 'req.body' }
  const fail = (status: number, body: string) => `reply.code(${status}).send(${body})`
  const body = m.routes.map((r) => {
    const c = crudFor(da, r)
    const g = guard(m, r, 'req.headers', fail, '    ')
    if (c) return `  app.${r.method.toLowerCase()}(${JSON.stringify(colon(r.path))}, async (req, reply) => {
${todo(r, '    ')}
${g}    const r = await ${crudCall(c, a, guarded(m, r))}
    return reply.code(r.status).send(r.body)
  })`
    return `  app.${r.method.toLowerCase()}(${JSON.stringify(colon(r.path))}, async (${g ? 'req' : '_req'}, reply) => {
${todo(r, '    ')}
${g}    return reply.code(501).send({ error: 'not_implemented', operation: ${JSON.stringify(r.name)} })
  })`
  }).join('\n\n')
  return `import type { FastifyInstance } from 'fastify'
${da?.routes.length ? "import { table } from './db.js'\n" : ''}${m.routes.some((r) => guarded(m, r)) ? "import { sessionFrom } from './session.js'\n" : ''}
${tables(da)}
export async function registerRoutes(app: FastifyInstance) {
${body || '  // No HTTP operations are designed yet.'}
}
`
}

function fastifyMain(m: ServiceModel, socket: boolean, da?: DataAccess): string {
  const events = m.operations
  const sockets = socket ? `
  await app.register(websocket)
  app.get(${JSON.stringify(m.spec?.basePath?.startsWith('/') ? m.spec.basePath : '/ws')}, { websocket: true }, (socket) => {
    socket.on('message', (raw: Buffer) => {
      let msg: { type?: string; data?: unknown }
      try { msg = JSON.parse(raw.toString()) } catch { return socket.send(JSON.stringify({ type: 'error', error: 'invalid_json' })) }
      switch (msg.type) {
${events.map((o) => `        case ${JSON.stringify(o.kind.split(/\s+/).pop() || o.name)}:
${comment(stepLines(o), '//', '          ')}
          return socket.send(JSON.stringify({ type: 'error', error: 'not_implemented', event: msg.type }))`).join('\n')}
        default:
          return socket.send(JSON.stringify({ type: 'error', error: 'unknown_event', event: msg.type }))
      }
    })
  })
` : ''
  return `import Fastify from 'fastify'
${socket ? "import websocket from '@fastify/websocket'\n" : ''}import { config } from './config.js'
${da ? "import { migrate } from './db.js'\n" : ''}import { registerRoutes } from './routes.js'

${da ? 'await migrate()\n' : ''}const app = Fastify({ logger: true })
// Clients often send a JSON content type with an empty body, on DELETE in particular.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (body === '') return done(null, undefined)
  try {
    done(null, JSON.parse(body as string))
  } catch (e) {
    done(Object.assign(e as Error, { statusCode: 400 }), undefined)
  }
})

app.get('/healthz', async () => ({ status: 'ok' }))
await registerRoutes(app)
${sockets}
await app.listen({ host: '0.0.0.0', port: config.port })
`
}

function honoMain(m: ServiceModel, da?: DataAccess): string {
  const a: Access = { params: 'c.req.param()', query: 'c.req.query()', body: 'await c.req.json().catch(() => ({}))' }
  return `import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { config } from './config.js'
${m.routes.some((r) => guarded(m, r)) ? "import { sessionFrom } from './session.js'\n" : ''}
${da ? `import { migrate${da.routes.length ? ', table' : ''} } from './db.js'\n` : ''}
${da ? 'await migrate()\n' : ''}${tables(da)}const app = new Hono()

app.get('/healthz', (c) => c.json({ status: 'ok' }))
${m.routes.map((r) => {
    const cr = crudFor(da, r)
    const g = guard(m, r, 'c.req.raw.headers', (status, body) => `c.json(${body}, ${status})`, '  ')
    if (cr) return `
app.${r.method.toLowerCase()}(${JSON.stringify(colon(r.path))}, async (c) => {
${todo(r, '  ')}
${g}  const r = await ${crudCall(cr, a, guarded(m, r))}
  return r.status === 204 ? c.body(null, 204) : c.json(r.body as object, r.status as 200)
})`
    return `
app.${r.method.toLowerCase()}(${JSON.stringify(colon(r.path))}, (c) => {
${todo(r, '  ')}
${g}  return c.json({ error: 'not_implemented', operation: ${JSON.stringify(r.name)} }, 501)
})`
  }).join('\n')}

serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => console.log(\`listening on \${info.port}\`))
`
}

function expressMain(m: ServiceModel, da?: DataAccess): string {
  const a: Access = { params: 'req.params', query: '(req.query as Record<string, unknown>)', body: 'req.body' }
  return `import express from 'express'
import { config } from './config.js'
${m.routes.some((r) => guarded(m, r)) ? "import { sessionFrom } from './session.js'\n" : ''}
${da ? `import { migrate${da.routes.length ? ', table' : ''} } from './db.js'\n` : ''}
${da ? 'await migrate()\n' : ''}${tables(da)}const app = express()
app.use(express.json())

app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
${m.routes.map((r) => {
    const cr = crudFor(da, r)
    const g = guard(m, r, 'req.headers', (status, body) => `void res.status(${status}).json(${body})`, '  ')
    if (cr) return `
app.${r.method.toLowerCase()}(${JSON.stringify(colon(r.path))}, async (req, res) => {
${todo(r, '  ')}
${g}  const r = await ${crudCall(cr, a, guarded(m, r))}
  res.status(r.status)
  if (r.body === undefined) res.end()
  else res.json(r.body)
})`
    return `
app.${r.method.toLowerCase()}(${JSON.stringify(colon(r.path))}, (${g ? 'req' : '_req'}, res) => {
${todo(r, '  ')}
${g}  res.status(501).json({ error: 'not_implemented', operation: ${JSON.stringify(r.name)} })
})`
  }).join('\n')}

app.listen(config.port, '0.0.0.0', () => console.log(\`listening on \${config.port}\`))
`
}

function resolvers(m: ServiceModel): string {
  const kinds = ['query', 'mutation', 'subscription'] as const
  const blocks = kinds.map((k) => {
    const ops = m.operations.filter((o) => o.kind.toLowerCase() === k)
    if (!ops.length) return ''
    const root = k[0].toUpperCase() + k.slice(1)
    const fields = ops.map((o) => k === 'subscription'
      ? `    ${o.name}: {\n${comment(stepLines(o), '//', '      ')}\n      subscribe: () => { throw notImplemented(${JSON.stringify(o.name)}) },\n    },`
      : `    ${o.name}: () => {\n${comment(stepLines(o), '//', '      ')}\n      throw notImplemented(${JSON.stringify(o.name)})\n    },`).join('\n')
    return `  ${root}: {\n${fields}\n  },`
  }).filter(Boolean).join('\n')
  return `import { GraphQLError } from 'graphql'

const notImplemented = (field: string) => new GraphQLError(\`\${field} is not implemented yet\`, { extensions: { code: 'NOT_IMPLEMENTED' } })

export const resolvers = {
${blocks}
}
`
}

function apolloMain(): string {
  return `import { readFileSync } from 'node:fs'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import express from 'express'
import { config } from './config.js'
import { resolvers } from './resolvers.js'

const typeDefs = readFileSync(new URL('../schema.graphql', import.meta.url), 'utf8')
const server = new ApolloServer({ typeDefs, resolvers })
await server.start()

const app = express()
app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
app.use('/graphql', express.json(), expressMiddleware(server))
app.listen(config.port, '0.0.0.0', () => console.log(\`GraphQL on :\${config.port}/graphql\`))
`
}

function yogaMain(): string {
  return `import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createSchema, createYoga } from 'graphql-yoga'
import { config } from './config.js'
import { resolvers } from './resolvers.js'

const typeDefs = readFileSync(new URL('../schema.graphql', import.meta.url), 'utf8')
const yoga = createYoga({ schema: createSchema({ typeDefs, resolvers }) })

createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }))
    return
  }
  yoga(req, res)
}).listen(config.port, '0.0.0.0', () => console.log(\`GraphQL on :\${config.port}/graphql\`))
`
}

function grpcMain(m: ServiceModel, file: string, pkg: string, svc: string): string {
  return `import { createServer } from 'node:http'
import * as grpc from '@grpc/grpc-js'
import * as loader from '@grpc/proto-loader'
import { config } from './config.js'

const definition = loader.loadSync(new URL('../proto/${file}.proto', import.meta.url).pathname, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true })
const proto = grpc.loadPackageDefinition(definition) as Record<string, any>
const service = proto${pkg.split('.').map((p) => `[${JSON.stringify(p)}]`).join('')}[${JSON.stringify(svc)}] as grpc.ServiceClientConstructor

const unimplemented = (name: string) => ({ code: grpc.status.UNIMPLEMENTED, details: \`\${name} is not implemented yet\` })

const server = new grpc.Server()
server.addService(service.service, {
${m.operations.map((o) => `${comment(stepLines(o), '//', '  ')}
  ${o.name}: (call: any, callback?: grpc.sendUnaryData<unknown>) => {
    const err = unimplemented(${JSON.stringify(o.name)})
    if (callback) callback(err)
    else call.emit('error', err)
  },`).join('\n')}
})

server.bindAsync(\`0.0.0.0:\${config.port}\`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) throw err
  console.log(\`gRPC on :\${port}\`)
})

const healthPort = Number(process.env.HEALTH_PORT ?? config.port + 1)
createServer((req, res) => {
  res.writeHead(req.url === '/healthz' ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }))
}).listen(healthPort, '0.0.0.0')
`
}

function workerMain(m: ServiceModel): string {
  const once = m.kind === 'cron'
  return `import { createServer } from 'node:http'
import { config } from './config.js'

${m.kind === 'worker'
    ? `// Consumes work from: ${m.sources.join(', ') || 'nothing connected yet'}. Replace \`nextJob\` with the client for that source.
const concurrency = Number(process.env.CONCURRENCY ?? ${m.concurrency})

async function nextJob(): Promise<unknown | null> {
  await new Promise((r) => setTimeout(r, 1000))
  return null
}

async function handle(job: unknown) {
  console.log('received job', job)
}

async function loop() {
  for (;;) {
    const job = await nextJob()
    if (job !== null) await handle(job)
  }
}

for (let i = 0; i < concurrency; i++) void loop()

createServer((req, res) => {
  res.writeHead(req.url === '/healthz' ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }))
}).listen(config.port, '0.0.0.0')
`
    : `// Runs once per schedule (${m.schedule}); the platform starts the container on that schedule.
async function run() {
  console.log('${m.name} started', Object.keys(config.dependencies))
}

await run()
${once ? 'process.exit(0)\n' : ''}`}`
}

export function typescriptService(m: ServiceModel, contracts: { proto: string; pkg?: string; svc?: string }): Files {
  const { server, note } = pick(m)
  const deps = new Set(['@opentelemetry/api', '@opentelemetry/auto-instrumentations-node'])
  const dev = new Set(['typescript', '@types/node'])
  const f: Files = {}
  const src = `${m.dir}/src`
  f[`${src}/config.ts`] = config(m)
  const http = m.kind === 'api' && (server === 'fastify' || server === 'websocket' || server === 'hono' || server === 'express')
  const da = http ? dataAccess(m) : undefined
  if (http && m.routes.some((r) => guarded(m, r))) f[`${src}/session.ts`] = SESSION_RUNTIME
  if (da) {
    deps.add('pg'); dev.add('@types/pg')
    f[`${m.dir}/migrations/${da.file}`] = migrationSql(da.schema, da.node.techId)
    f[`${src}/db.ts`] = DB_RUNTIME.replace('__DB_ENV__', da.dep.env).replace('__SCHEMA_FILE__', da.file)
  }

  if (m.kind !== 'api') f[`${src}/main.ts`] = workerMain(m)
  else if (server === 'fastify' || server === 'websocket') {
    deps.add('fastify')
    if (server === 'websocket') deps.add('@fastify/websocket')
    f[`${src}/main.ts`] = fastifyMain(m, server === 'websocket', da)
    f[`${src}/routes.ts`] = fastifyRoutes(m, da)
  } else if (server === 'hono') {
    deps.add('hono').add('@hono/node-server')
    f[`${src}/main.ts`] = honoMain(m, da)
  } else if (server === 'express') {
    deps.add('express'); dev.add('@types/express')
    f[`${src}/main.ts`] = expressMain(m, da)
  } else if (server === 'apollo' || server === 'yoga') {
    deps.add('graphql')
    if (server === 'apollo') { deps.add('@apollo/server').add('@as-integrations/express5').add('express'); dev.add('@types/express') } else deps.add('graphql-yoga')
    f[`${src}/main.ts`] = server === 'apollo' ? apolloMain() : yogaMain()
    f[`${src}/resolvers.ts`] = resolvers(m)
  } else if (server === 'grpc') {
    deps.add('@grpc/grpc-js').add('@grpc/proto-loader')
    f[`${src}/main.ts`] = grpcMain(m, contracts.proto, contracts.pkg ?? 'app.v1', contracts.svc ?? 'Service')
  }

  const pick2 = (names: Set<string>, table: Record<string, string>) => Object.fromEntries([...names].sort().map((n) => [n, table[n]]))
  f[`${m.dir}/package.json`] = JSON.stringify({
    name: m.name, private: true, version: '0.1.0', type: 'module',
    scripts: { build: 'tsc -p .', start: 'node dist/main.js', dev: 'tsc -p . --watch' },
    dependencies: pick2(deps, DEPS),
    devDependencies: pick2(dev, DEV),
  }, null, 2) + '\n'
  f[`${m.dir}/tsconfig.json`] = JSON.stringify({
    compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: 'src', strict: true, skipLibCheck: true, esModuleInterop: true },
    include: ['src'],
  }, null, 2) + '\n'
  const extra = (server === 'apollo' || server === 'yoga' ? 'COPY --from=build /app/schema.graphql ./schema.graphql\n' : server === 'grpc' ? 'COPY --from=build /app/proto ./proto\n' : '') + (da ? 'COPY --from=build /app/migrations ./migrations\n' : '')
  f[`${m.dir}/Dockerfile`] = `FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
${extra}USER node
EXPOSE ${m.port}
CMD ["sh", "-c", "exec node \${OTEL_EXPORTER_OTLP_ENDPOINT:+--import @opentelemetry/auto-instrumentations-node/register} dist/main.js"]
`
  f[`${m.dir}/.dockerignore`] = 'node_modules\ndist\n'
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'npm install && npm run build && npm start', note ? [note] : [])
  return f
}

export function typescriptAuthService(m: ServiceModel): Files {
  const db = m.deps.find((d) => SQL_STORES.has(d.techId))
  const f: Files = {}
  f[`${m.dir}/src/config.ts`] = config(m)
  f[`${m.dir}/src/session.ts`] = SESSION_RUNTIME
  f[`${m.dir}/src/main.ts`] = AUTH_SERVICE.replace('__DB_ENV__', db?.env ?? 'USERS_DB_URL')
  f[`${m.dir}/package.json`] = JSON.stringify({
    name: m.name, private: true, version: '0.1.0', type: 'module',
    scripts: { build: 'tsc -p .', start: 'node dist/main.js', dev: 'tsc -p . --watch' },
    dependencies: { fastify: DEPS.fastify, pg: DEPS.pg, '@opentelemetry/api': DEPS['@opentelemetry/api'], '@opentelemetry/auto-instrumentations-node': DEPS['@opentelemetry/auto-instrumentations-node'] },
    devDependencies: { typescript: DEV.typescript, '@types/node': DEV['@types/node'], '@types/pg': DEV['@types/pg'] },
  }, null, 2) + '\n'
  f[`${m.dir}/tsconfig.json`] = JSON.stringify({
    compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: 'src', strict: true, skipLibCheck: true, esModuleInterop: true },
    include: ['src'],
  }, null, 2) + '\n'
  f[`${m.dir}/Dockerfile`] = `FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE ${m.port}
CMD ["sh", "-c", "exec node \${OTEL_EXPORTER_OTLP_ENDPOINT:+--import @opentelemetry/auto-instrumentations-node/register} dist/main.js"]
`
  f[`${m.dir}/.dockerignore`] = 'node_modules\ndist\n'
  f[`${m.dir}/README.md`] = `# ${m.name}\n\nSign-up, sign-in and sessions for this project, generated by Tessery.\n\n- \`POST /signup\` with email, password and an optional name\n- \`POST /login\` with email and password\n- \`POST /logout\`\n- \`GET /me\`\n\nSessions are HS256 tokens signed with \`AUTH_SECRET\` and sent in an HttpOnly \`session\` cookie.\nOther services and the web app verify them with the same secret. The first account becomes an admin.\n${db ? '' : '\nConnect this node to a PostgreSQL database on the canvas; it stores users there.\n'}`
  return f
}
