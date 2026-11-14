import type { Column, Environment, Operation, ProjectDoc, Table } from '../../domain/types'
import { type CrudRoute, dataAccess, primaryKey, writable } from '../services/crud'
import { buildModel, restPrefix } from '../services/model'
import { builtInAuth, workloads } from './runtime'

/** One HTTP check against a service. `{{name}}` in the path, body and shape is filled from values saved by earlier
 * checks, and from `{{run}}`, `{{uuid}}` and `{{run_num}}`, which the runner sets fresh for each release so values
 * for unique columns and keys never collide with earlier runs. */
export interface ContractCheck {
  name: string
  service: string
  port: number
  method: string
  path: string
  body?: Record<string, unknown>
  /** Statuses that pass. */
  status: number[]
  /** A jq expression the response body must satisfy. */
  shape?: string
  /** The fields the shape looks for, so a failure can name the missing ones. */
  fields?: string[]
  /** Values to keep for later checks, as jq expressions on the body. */
  save?: Record<string, string>
}

export interface Contract {
  mode: 'full' | 'read'
  checks: ContractCheck[]
}

/** Which checks a release runs: full ones create, change and delete a throwaway record, read ones never write. */
export function contractMode(doc: ProjectDoc, env: Environment): 'full' | 'read' | 'off' {
  if (env.contractTests) return env.contractTests
  return doc.environments[doc.environments.length - 1]?.id === env.id ? 'read' : 'full'
}

const NO_ID = '00000000-0000-0000-0000-000000000000'

/** A value a column accepts, or undefined when none can be made up safely: references, enums, vectors, and unique
 * columns whose type cannot carry a per-run value. Values go to the database as text, so numbers can be strings. */
function sample(c: Column): unknown {
  if (c.ref) return undefined
  if (c.unique || c.pk) {
    if (c.type === 'text' || c.type === 'varchar') return 'Contract check {{run}}'
    if (c.type === 'uuid') return '{{uuid}}'
    if (c.type === 'int' || c.type === 'bigint') return '{{run_num}}'
    return undefined
  }
  switch (c.type) {
    case 'text': case 'varchar': return 'Contract check'
    case 'int': case 'bigint': case 'serial': return 1
    case 'numeric': case 'float': return 1.5
    case 'boolean': return true
    case 'date': return '2026-01-01'
    case 'timestamptz': return '2026-01-01T00:00:00Z'
    case 'jsonb': return {}
    case 'text[]': return []
    default: return undefined
  }
}

const has = (t: Table) => `(type == "object" and ${t.columns.map((c) => `has(${JSON.stringify(c.name)})`).join(' and ')})`

/** Checks generated from the API and database design: designed statuses, the table's fields in responses, and sign-in. */
export function contract(doc: ProjectDoc, env: Environment): Contract | null {
  const mode = contractMode(doc, env)
  if (mode === 'off') return null
  const running = new Set(workloads(doc, env).map((w) => w.name))
  const auth = !!builtInAuth(doc)
  const guarded = (op: Operation) => auth && (op.auth === 'user' || op.auth === 'admin')
  const checks: ContractCheck[] = []
  for (const n of doc.nodes) {
    const spec = doc.apis[n.id]
    if (!running.has(n.name) || !spec || spec.style !== 'rest') continue
    const m = buildModel(doc, n)
    const da = dataAccess(m)
    if (!da) continue
    const prefix = restPrefix(spec)
    const full = (path: string) => (prefix && !path.startsWith(`${prefix}/`) ? prefix + path : path)
    const at = { service: n.name, port: m.port }
    const label = (c: CrudRoute) => `${n.name}: ${c.route.method} ${full(c.route.path)}`

    for (const c of da.routes.filter((x) => guarded(x.route.op) && (mode === 'full' || ['GET', 'DELETE'].includes(x.route.method)))) {
      checks.push({ ...at, name: `${label(c)} turns away visitors who are not signed in`, method: c.route.method, path: full(c.route.path).replace(/\{\w+\}/g, NO_ID), ...(['POST', 'PUT', 'PATCH'].includes(c.route.method) ? { body: {} } : {}), status: [401] })
    }

    const open = da.routes.filter((x) => !guarded(x.route.op) && !x.parent)
    const tables = [...new Map(open.map((c) => [c.table.name, c.table])).values()]
    for (const t of tables) {
      const of = (a: CrudRoute['action']) => open.find((c) => c.table === t && c.action === a)
      const list = of('list')
      const fieldsOf = { fields: t.columns.map((c) => c.name) }
      if (list) checks.push({ ...at, name: `${label(list)} lists ${t.name} with their fields`, method: 'GET', path: full(list.route.path), status: [200], shape: `type == "array" and all(.[]; ${has(t)})`, ...fieldsOf })
      const create = of('create')
      const remove = of('delete')
      const pk = primaryKey(t)
      const fields = writable(t).map((name) => t.columns.find((c) => c.name === name)!)
      const required = fields.filter((c) => !c.nullable && !c.default)
      const body = Object.fromEntries(fields.filter((c) => !c.default).map((c) => [c.name, sample(c)]).filter(([, v]) => v !== undefined))
      if (mode !== 'full' || !create || !remove || !pk || required.some((c) => !(c.name in body))) continue
      checks.push({ ...at, name: `${label(create)} creates a ${t.name} record`, method: create.route.method, path: full(create.route.path), body, status: [200, 201], shape: has(t), ...fieldsOf, save: { id: `.${JSON.stringify(pk.name)}` } })
      const one = (c: CrudRoute) => full(c.route.path).replace(`{${c.idParam}}`, '{{id}}')
      const get = of('get')
      if (get) checks.push({ ...at, name: `${label(get)} returns the new ${t.name} record`, method: 'GET', path: one(get), status: [200], shape: has(t), ...fieldsOf })
      const update = of('update')
      const text = fields.find((c) => c !== pk && !c.ref && (c.type === 'text' || c.type === 'varchar'))
      if (update && text) checks.push({ ...at, name: `${label(update)} changes the record`, method: update.route.method, path: one(update), body: { [text.name]: 'Contract check {{run}}, changed' }, status: [200], shape: `${has(t)} and .${JSON.stringify(text.name)} == "Contract check {{run}}, changed"` })
      checks.push({ ...at, name: `${label(remove)} deletes the record`, method: 'DELETE', path: one(remove), status: [200, 204] })
      if (get) checks.push({ ...at, name: `${label(get)} no longer finds the deleted record`, method: 'GET', path: one(get), status: [404] })
    }
  }
  return checks.length ? { mode, checks } : null
}
