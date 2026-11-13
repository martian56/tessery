import { createInterface } from 'node:readline'
import { analyze } from '../analysis'
import { LANGUAGES } from '../catalog/languages'
import { PROVIDERS } from '../catalog/providers'
import { TECHNOLOGIES } from '../catalog/technologies'
import { generateAll, parseMigrationState } from '../codegen'
import { OPS, runOp, type OpName } from '../domain/ops'
import { normalizeDoc } from '../domain/normalize'
import type { ProjectDoc } from '../domain/types'
import { TEMPLATES } from '../templates'
import { OPS_REFERENCE } from '../domain/ops/reference'

interface Request { id: number; method: string; params?: Record<string, unknown> }
interface OpCall { op: string; args?: unknown }

export const ENGINE_VERSION = 1

function asDoc(v: unknown): ProjectDoc {
  const d = v as ProjectDoc
  if (!d || typeof d !== 'object' || !Array.isArray(d.nodes) || !Array.isArray(d.edges) || !Array.isArray(d.environments)) {
    throw new Error('params.doc is not an Tessery design document')
  }
  return normalizeDoc(d)
}

function resolveRefs(v: unknown, results: unknown[]): unknown {
  if (typeof v === 'string') {
    const m = /^\$(\d+)(:.+)?$/.exec(v)
    if (!m) return v
    const i = Number(m[1])
    if (i >= results.length) throw new Error(`"${v}" refers to an operation that has not run yet`)
    return m[2] ? `${results[i]}${m[2]}` : results[i]
  }
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, results))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, results)]))
  return v
}

const NODE_KEYS = ['id', 'source', 'target', 'nodeId', 'appNodeId']

function resolveNames(doc: ProjectDoc, args: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) }
  for (const k of NODE_KEYS) {
    const v = out[k]
    if (typeof v !== 'string' || doc.nodes.some((n) => n.id === v)) continue
    const byName = doc.nodes.find((n) => n.name === v)
    if (byName) out[k] = byName.id
  }
  if (Array.isArray(out.ids)) out.ids = out.ids.map((v) => (typeof v === 'string' && !doc.nodes.some((n) => n.id === v) ? doc.nodes.find((n) => n.name === v)?.id ?? v : v))
  for (const k of ['source', 'action']) {
    const v = out[k]
    if (k === 'source' && 'target' in out) continue
    if (typeof v === 'string' && v.includes(':')) {
      const [node, rest] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':'))]
      const byName = !doc.nodes.some((n) => n.id === node) && doc.nodes.find((n) => n.name === node)
      if (byName) out[k] = byName.id + rest
    }
  }
  if (out.props && typeof out.props === 'object') out.props = resolveNames(doc, out.props)
  return out
}

const methods: Record<string, (p: Record<string, unknown>) => unknown> = {
  ping: () => ({ version: ENGINE_VERSION }),

  generate: (p) => ({ files: generateAll(asDoc(p.doc), parseMigrationState(p.migrations)) }),

  apply: (p) => {
    const doc = structuredClone(asDoc(p.doc))
    const calls = (p.ops ?? []) as OpCall[]
    if (!Array.isArray(calls)) throw new Error('params.ops must be a list')
    const results: unknown[] = []
    calls.forEach((c, i) => {
      if (!(c.op in OPS)) throw new Error(`operation ${i}: unknown operation "${c.op}"`)
      try {
        const args = resolveNames(doc, resolveRefs(c.args ?? {}, results))
        const result = runOp(doc, c.op as OpName, args as never) ?? null
        if (c.op === 'connect' && !result) throw new Error('the nodes do not exist, are already connected, or their ports are not compatible')
        results.push(result)
      } catch (e) {
        throw new Error(`operation ${i} (${c.op}): ${(e as Error).message}`)
      }
    })
    return { doc, results }
  },

  validate: (p) => {
    const doc = asDoc(p.doc)
    const envs = p.env ? doc.environments.filter((e) => e.id === p.env) : doc.environments
    return { problems: envs.flatMap((e) => analyze(doc, e, null).map((x) => ({ ...x, env: e.id }))) }
  },

  describe: () => ({ operations: OPS_REFERENCE }),

  catalog: () => ({
    technologies: TECHNOLOGIES.map(({ id, name, category, description, languages, apiStyles }) => ({ id, name, category, description, languages, apiStyles })),
    providers: PROVIDERS.map(({ id, name, kind, regions }) => ({ id, name, kind, regions: regions.map((r) => r.id) })),
    languages: LANGUAGES.map((l) => ({ id: l.id, frameworks: l.frameworks.map((f) => ({ id: f.id, styles: f.styles })) })),
    operations: Object.keys(OPS),
  }),

  templates: () => ({ templates: TEMPLATES.map(({ id, name, description }) => ({ id, name, description })) }),

  template: (p) => {
    const t = TEMPLATES.find((x) => x.id === p.id)
    if (!t) throw new Error(`unknown template "${String(p.id)}"`)
    const doc = t.build()
    if (typeof p.name === 'string' && p.name.trim()) doc.name = p.name.trim()
    return { doc }
  },
}

function reply(msg: object) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  let req: Request
  try {
    req = JSON.parse(line)
  } catch {
    reply({ id: null, error: 'request is not valid JSON' })
    return
  }
  const fn = methods[req.method]
  if (!fn) {
    reply({ id: req.id, error: `unknown method "${req.method}"` })
    return
  }
  try {
    reply({ id: req.id, result: fn(req.params ?? {}) })
  } catch (e) {
    reply({ id: req.id, error: (e as Error).message })
  }
})
rl.on('close', () => process.exit(0))
