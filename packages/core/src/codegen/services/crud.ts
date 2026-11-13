import type { SystemNode, Column, DbSchema, ProjectDoc, Table } from '../../domain/types'
import { httpRoute, type Dependency, type Route, type ServiceModel } from './model'
import { migrationsOf, type Migration } from '../migrations'

export const SQL_STORES = new Set(['postgres', 'timescaledb', 'pgvector', 'cockroachdb', 'supabase'])

export type Action = 'list' | 'get' | 'create' | 'update' | 'delete'

export interface CrudRoute {
  route: Route
  action: Action
  table: Table
  idParam?: string
  parent?: { column: string; param: string }
}

export interface DataAccess {
  dep: Dependency
  node: SystemNode
  schema: DbSchema
  migrations: Migration[]
  routes: CrudRoute[]
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()

function variants(word: string): string[] {
  const w = snake(word)
  const out = [w]
  if (w.endsWith('ies')) out.push(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) out.push(w.slice(0, -2))
  if (w.endsWith('s')) out.push(w.slice(0, -1))
  if (w.endsWith('y')) out.push(w.slice(0, -1) + 'ies')
  out.push(w + 's', w + 'es')
  return out
}

function findTable(schema: DbSchema, resource: string): Table | undefined {
  const names = variants(resource)
  return schema.tables.find((t) => names.includes(snake(t.name)))
}

export function primaryKey(t: Table): Column | undefined {
  const pks = t.columns.filter((c) => c.pk)
  if (pks.length === 1) return pks[0]
  return pks.length ? undefined : t.columns.find((c) => c.name === 'id')
}

const isParam = (s: string) => /^\{\w+\}$/.test(s)
const paramName = (s: string) => s.slice(1, -1)

export function crudRoute(route: Route, schema: DbSchema): CrudRoute | undefined {
  const segs = route.path.split('/').filter(Boolean)
  if (!segs.length) return undefined
  const item = isParam(segs[segs.length - 1])
  const resIdx = item ? segs.length - 2 : segs.length - 1
  const resource = segs[resIdx]
  if (!resource || isParam(resource)) return undefined
  const table = findTable(schema, resource)
  if (!table || !primaryKey(table)) return undefined
  const action: Action | undefined =
    route.method === 'GET' ? (item ? 'get' : 'list')
    : route.method === 'POST' && !item ? 'create'
    : (route.method === 'PUT' || route.method === 'PATCH') && item ? 'update'
    : route.method === 'DELETE' && item ? 'delete'
    : undefined
  if (!action) return undefined
  let parent: CrudRoute['parent']
  const before = segs[resIdx - 1]
  if (before && isParam(before)) {
    const param = paramName(before)
    const owner = segs[resIdx - 2]
    const candidates = [snake(param), ...(owner ? variants(owner).map((v) => `${v}_id`) : [])]
    const col = table.columns.find((c) => candidates.includes(snake(c.name)))
    if (!col) return undefined
    parent = { column: col.name, param }
  }
  return { route, action, table, idParam: item ? paramName(segs[segs.length - 1]) : undefined, parent }
}

export function dataAccess(m: ServiceModel): DataAccess | undefined {
  for (const dep of m.deps) {
    if (!SQL_STORES.has(dep.techId)) continue
    const node = m.doc.nodes.find((n) => n.name === dep.name)
    const schema = node ? m.doc.databases[node.id] : undefined
    if (!node || !schema?.tables.length) continue
    const routes = m.routes.map((r) => crudRoute(r, schema)).filter((r): r is CrudRoute => !!r)
    return { dep, node, schema, migrations: migrationsOf(m.doc).databases[node.id]?.migrations ?? [], routes }
  }
  return undefined
}

export function writable(t: Table): string[] {
  const pk = primaryKey(t)
  return t.columns.filter((c) => !(c === pk && (c.type === 'serial' || !!c.default))).map((c) => c.name)
}

export function orderBy(t: Table): string {
  const created = t.columns.find((c) => ['created_at', 'createdAt', 'inserted_at'].includes(c.name))
  return created ? `"${created.name}" DESC` : `"${primaryKey(t)!.name}"`
}

export function columnTypes(t: Table, sqlType: (c: Column) => string): Record<string, string> {
  return Object.fromEntries(t.columns.map((c) => [c.name, sqlType(c)]))
}

export function tableForOperation(doc: ProjectDoc, nodeId: string, opName: string): CrudRoute | undefined {
  const op = doc.apis[nodeId]?.operations.find((o) => o.name === opName)
  const route = op ? httpRoute(op) : null
  if (!route) return undefined
  for (const e of doc.edges.filter((x) => x.source === nodeId)) {
    const target = doc.nodes.find((n) => n.id === e.target)
    const schema = target && SQL_STORES.has(target.techId) ? doc.databases[target.id] : undefined
    const hit = schema && crudRoute(route, schema)
    if (hit) return hit
  }
  return undefined
}
