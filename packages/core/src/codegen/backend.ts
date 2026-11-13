import { devConnection } from './deploy/runtime'
import { restPrefix } from './services/model'
import type { ApiSpec, SystemNode, Column, DbSchema, Index, Operation, ProjectDoc, Table, TypeDef } from '../domain/types'

const camel = (s: string) => s.replace(/[-_\s]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, (c) => c.toLowerCase())
const pascal = (s: string) => camel(s).replace(/^\w/, (c) => c.toUpperCase())
const snake = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()

export function deps(doc: ProjectDoc, n: SystemNode) {
  return doc.edges.filter((e) => e.source === n.id).map((e) => doc.nodes.find((x) => x.id === e.target)!).filter(Boolean)
}
export function connectionUrl(d: SystemNode, doc?: ProjectDoc): string {
  return devConnection(d, doc).url
}

const restPath = (o: Operation) => { const [m, p] = o.kind.split(' '); return { method: (m ?? 'GET').toUpperCase(), path: p ?? '/' } }

export function openapi(spec: ApiSpec, n: SystemNode): string {
  const groups = new Map<string, Operation[]>()
  spec.operations.forEach((o) => { const { path } = restPath(o); if (!groups.has(path)) groups.set(path, []); groups.get(path)!.push(o) })
  const prefix = restPrefix(spec)
  return `openapi: 3.1.0\ninfo:\n  title: ${n.name}\n  version: 1.0.0\n${prefix ? `servers:\n  - url: ${prefix}\n` : ''}paths:\n${[...groups.entries()].map(([p, ops]) => `  ${p}:\n${ops.map((o) => {
    const { method } = restPath(o)
    const params = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    return `    ${method.toLowerCase()}:\n      operationId: ${o.name}\n      summary: ${o.summary}\n      security: ${o.auth === 'public' ? '[]' : o.auth === 'api-key' ? '[{ apiKey: [] }]' : '[{ bearer: [] }]'}\n${params.length ? `      parameters:\n${params.map((x) => `        - { name: ${x}, in: path, required: true, schema: { type: string } }`).join('\n')}\n` : ''}${o.input ? `      requestBody:\n        content:\n          application/json: { schema: { $ref: '#/components/schemas/${o.input}' } }\n` : ''}      responses:\n        '${method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200}':\n          description: OK${o.output ? `\n          content:\n            application/json: { schema: { $ref: '#/components/schemas/${o.output.replace('[]', '')}' } }` : ''}`
  }).join('\n')}`).join('\n')}\ncomponents:\n  securitySchemes:\n    bearer: { type: http, scheme: bearer }\n    apiKey: { type: apiKey, in: header, name: X-API-Key }\n`
}

const gqlField = (f: TypeDef['fields'][number]) => `${f.name}: ${f.list ? `[${f.type}!]` : f.type}${f.required ? '!' : ''}`
export function graphqlSchema(spec: ApiSpec): string {
  const types = spec.types.map((t) => t.kind === 'enum'
    ? `enum ${t.name} {\n${t.fields.map((f) => `  ${f.name}`).join('\n')}\n}`
    : `${t.kind === 'input' ? 'input' : 'type'} ${t.name} {\n${t.fields.map((f) => `  ${gqlField(f)}`).join('\n')}\n}`)
  const root = (k: string) => spec.operations.filter((o) => o.kind === k).map((o) => `  """${o.summary}"""\n  ${o.name}${o.input ? `(${o.input})` : ''}: ${o.output ?? 'Boolean'}`)
  const blocks = [['Query', root('query')], ['Mutation', root('mutation')], ['Subscription', root('subscription')]].filter(([, f]) => f.length).map(([n, f]) => `type ${n} {\n${(f as string[]).join('\n')}\n}`)
  return `scalar DateTime\n\n${[...blocks, ...types].join('\n\n')}\n`
}
const protoType = (t: string) => ({ String: 'string', ID: 'string', Int: 'int32', Float: 'double', Boolean: 'bool', DateTime: 'google.protobuf.Timestamp', int64: 'int64', int32: 'int32', string: 'string' } as Record<string, string>)[t] ?? t
export function protoNames(spec: ApiSpec, n: SystemNode): { pkg: string; svc: string } {
  const parts = spec.basePath.split('.').filter((x) => /^[A-Za-z_]\w*$/.test(x))
  return {
    pkg: parts.length > 1 ? parts.slice(0, -1).join('.') : `${snake(n.name)}.v1`,
    svc: parts.length > 1 ? parts[parts.length - 1] : `${pascal(n.name)}Service`,
  }
}

export function protoFile(spec: ApiSpec, n: SystemNode): string {
  const { pkg, svc } = protoNames(spec, n)
  const msgs = spec.types.map((t) => t.kind === 'enum'
    ? `enum ${t.name} {\n${t.fields.map((f, i) => `  ${t.name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_${f.name} = ${i};`).join('\n')}\n}`
    : `message ${t.name} {\n${t.fields.map((f, i) => `  ${f.list ? 'repeated ' : ''}${protoType(f.type)} ${f.name} = ${i + 1};`).join('\n')}\n}`)
  const known = new Set(spec.types.map((t) => t.name))
  const extra = [...new Set(spec.operations.flatMap((o) => [o.input, o.output]).filter((x): x is string => !!x && !known.has(x)))].map((x) => `message ${x} {}`)
  const imports = ['google/protobuf/timestamp.proto', ...(spec.operations.some((o) => !o.input || !o.output) ? ['google/protobuf/empty.proto'] : [])]
  return `syntax = "proto3";\npackage ${pkg};\n\n${imports.map((i) => `import "${i}";`).join('\n')}\n\nservice ${svc} {\n${spec.operations.map((o) => `  // ${o.summary}\n  rpc ${o.name}(${o.streaming === 'client' || o.streaming === 'bidi' ? 'stream ' : ''}${o.input ?? 'google.protobuf.Empty'}) returns (${o.streaming === 'server' || o.streaming === 'bidi' ? 'stream ' : ''}${o.output ?? 'google.protobuf.Empty'});`).join('\n')}\n}\n\n${[...msgs, ...extra].join('\n\n')}\n`
}

export function sqlType(c: Column, dialect: 'pg' | 'mysql') {
  const pg: Record<string, string> = { uuid: 'uuid', text: 'text', varchar: `varchar(${c.length ?? 255})`, int: 'integer', bigint: 'bigint', serial: 'bigserial', numeric: 'numeric(12,2)', float: 'double precision', boolean: 'boolean', timestamptz: 'timestamptz', date: 'date', jsonb: 'jsonb', bytea: 'bytea', enum: 'text', 'text[]': 'text[]', vector: 'vector(1536)' }
  const my: Record<string, string> = { ...pg, uuid: 'char(36)', text: 'text', serial: 'bigint auto_increment', float: 'double', timestamptz: 'datetime(6)', jsonb: 'json', bytea: 'blob', 'text[]': 'json', vector: 'blob' }
  return (dialect === 'pg' ? pg : my)[c.type] ?? c.type
}
export type Dialect = 'pg' | 'mysql'

export const dialectOf = (techId: string): Dialect => (['mysql', 'mariadb'].includes(techId) ? 'mysql' : 'pg')

export function byDependency(tables: Table[]): Table[] {
  const out: Table[] = []
  const seen = new Set<string>()
  const visit = (t: Table, path: Set<string>) => {
    if (seen.has(t.name) || path.has(t.name)) return
    path.add(t.name)
    for (const c of t.columns) {
      const target = c.ref && tables.find((x) => x.name === c.ref!.table)
      if (target && target !== t) visit(target, path)
    }
    seen.add(t.name)
    out.push(t)
  }
  tables.forEach((t) => visit(t, new Set()))
  return out
}

export function columnSql(c: Column, dialect: Dialect, inline: boolean): string {
  let def = `${dialect === 'pg' ? `"${c.name}"` : c.name} ${sqlType(c, dialect)}`
  if (!c.nullable && !c.pk) def += ' NOT NULL'
  if (c.unique && inline) def += ' UNIQUE'
  if (c.default) def += ` DEFAULT ${/^(-?\d+(\.\d+)?|true|false|null|'.*'|\w+\(.*\))$/i.test(c.default) ? c.default : `'${c.default.replace(/'/g, "''")}'`}`
  if (c.type === 'enum' && c.enumValues) def += ` CHECK (${c.name} IN (${c.enumValues.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')}))`
  if (c.ref) def += ` REFERENCES ${c.ref.table}(${c.ref.column}) ON DELETE ${c.ref.onDelete.toUpperCase()}`
  return def
}

export function createTableSql(t: Table, dialect: Dialect, idempotent: boolean): string {
  const pks = t.columns.filter((c) => c.pk).map((c) => (dialect === 'pg' ? `"${c.name}"` : c.name))
  const cols = t.columns.map((c) => `  ${columnSql(c, dialect, true)}`)
  if (pks.length) cols.push(`  PRIMARY KEY (${pks.join(', ')})`)
  return `${t.comment ? `-- ${t.comment}\n` : ''}CREATE TABLE ${idempotent ? 'IF NOT EXISTS ' : ''}${t.name} (\n${cols.join(',\n')}\n);`
}

export function indexSql(t: Table, ix: Index, dialect: Dialect, idempotent: boolean): string {
  return `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ${idempotent ? 'IF NOT EXISTS ' : ''}${ix.name} ON ${t.name}${dialect === 'pg' && ix.method !== 'btree' ? ` USING ${ix.method}` : ''} (${ix.columns.join(', ')});`
}

export function migrationSql(schema: DbSchema, techId: string): string {
  const dialect = dialectOf(techId)
  const ordered = byDependency(schema.tables)
  const ext = dialect === 'pg' && schema.tables.some((t) => t.columns.some((c) => c.type === 'vector')) ? 'CREATE EXTENSION IF NOT EXISTS vector;\n\n' : ''
  const head = `-- Generated by Tessery for ${dialect === 'pg' ? 'PostgreSQL' : 'MySQL'}.${dialect === 'pg' ? ' Safe to run repeatedly.' : ''}\n${ext}`
  return head + ordered.map((t) => {
    const create = createTableSql(t, dialect, dialect === 'pg')
    const added = dialect === 'pg' ? t.columns.filter((c) => !c.pk).map((c) => `ALTER TABLE ${t.name} ADD COLUMN IF NOT EXISTS ${columnSql({ ...c, nullable: true }, dialect, false)};`) : []
    const idx = t.indexes.map((ix) => indexSql(t, ix, dialect, dialect === 'pg'))
    return [create, ...added, ...idx].join('\n')
  }).join('\n\n') + '\n'
}

export { serviceFiles } from './services'
