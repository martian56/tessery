import type {
  ApiSpec, ApiStyle, SystemEdge, SystemNode, Block, Column, ColumnType, DbSchema, Environment, Index, ObservabilityConfig, Operation, Page, Placement, ProjectDoc, Table, TypeDef,
} from './types'
import { TECH_BY_ID, edgeProtocol } from '../catalog/technologies'
import { defaultPlacement } from '../catalog/placement'

let counter = 0
export const uid = (p = 'id') => `${p}_${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export function newNode(techId: string, name: string, x: number, y: number, opts: { config?: SystemNode['config']; provider?: string; region?: string; mode?: Placement['mode']; replicas?: number; id?: string } = {}): SystemNode {
  const tech = TECH_BY_ID[techId]
  if (!tech) throw new Error(`unknown technology ${techId}`)
  const config = Object.fromEntries(tech.config.map((c) => [c.key, c.default]))
  const placement = defaultPlacement(tech, opts.provider ?? 'aws', opts.region)
  if (opts.mode) placement.mode = opts.mode
  return { id: opts.id ?? uid('n'), techId, name, x, y, config: { ...config, ...opts.config }, placement, replicas: opts.replicas ?? (tech.category === 'compute' || tech.category === 'network' ? 2 : 1) }
}

export function inputPortFor(node: SystemNode): string {
  const tech = TECH_BY_ID[node.techId]
  return tech.inputs[0]?.id ?? 'in'
}

export function newEdge(source: SystemNode, target: SystemNode, sourcePort?: string, targetPort?: string): SystemEdge {
  const st = TECH_BY_ID[source.techId], tt = TECH_BY_ID[target.techId]
  const sp = sourcePort ?? st.outputs[0]?.id ?? 'out'
  const tp = targetPort ?? tt.inputs[0]?.id ?? 'in'
  const tType = tt.inputs.find((p) => p.id === tp)?.type ?? 'http'
  return { id: uid('e'), source: source.id, sourcePort: sp, target: target.id, targetPort: tp, protocol: edgeProtocol(tType, source.techId), timeoutMs: 5000, retries: 2, mtls: true, async: sp === 'sub' || tType === 'pub' }
}

export class GraphBuilder {
  nodes: SystemNode[] = []
  edges: SystemEdge[] = []
  constructor(private provider = 'aws', private region?: string) {}
  add(techId: string, name: string, x: number, y: number, opts: Parameters<typeof newNode>[4] = {}) {
    const n = newNode(techId, name, x, y, { provider: this.provider, region: this.region, ...opts })
    this.nodes.push(n)
    return n
  }
  link(a: SystemNode, b: SystemNode, sp?: string, tp?: string) {
    this.edges.push(newEdge(a, b, sp, tp))
    return this
  }
}

export function table(name: string, dsl: string, x = 0, y = 0, indexes: string[] = []): Table {
  const columns: Column[] = dsl.split(',').map((raw) => raw.trim()).filter(Boolean).map((def) => {
    const [cname, type, ...flags] = def.split(/\s+/)
    let t = type as ColumnType
    let enumValues: string[] | undefined
    if (type.startsWith('enum(')) { t = 'enum'; enumValues = type.slice(5, -1).split('|') }
    const col: Column = { id: uid('c'), name: cname, type: t, enumValues, nullable: flags.includes('null') }
    for (const fl of flags) {
      if (fl === 'pk') col.pk = true
      if (fl === 'unique') col.unique = true
      if (fl.startsWith('default:')) col.default = fl.slice(8)
      if (fl.startsWith('ref:')) { const [rt, rc] = fl.slice(4).split('.'); col.ref = { table: rt, column: rc ?? 'id', onDelete: 'restrict' } }
      if (fl === 'cascade' && col.ref) col.ref.onDelete = 'cascade'
      if (fl === 'setnull' && col.ref) col.ref.onDelete = 'set null'
    }
    if (col.pk && t === 'uuid' && !col.default) col.default = 'gen_random_uuid()'
    if (cname === 'created_at' && !col.default) col.default = 'now()'
    return col
  })
  const idx: Index[] = indexes.map((s) => {
    const unique = s.startsWith('unique ')
    const cols = s.replace('unique ', '').split('+')
    return { id: uid('ix'), name: `${name}_${cols.join('_')}_${unique ? 'key' : 'idx'}`, columns: cols, unique, method: 'btree' }
  })
  return { id: uid('t'), name, columns, indexes: idx, x, y }
}

export const db = (nodeId: string, tables: Table[]): DbSchema => ({ nodeId, tables })

export function op(kind: string, name: string, summary: string, auth: Operation['auth'] = 'user', steps: string[] = [], extra: Partial<Operation> = {}): Operation {
  return { id: uid('op'), kind, name, summary, auth, steps, streaming: 'none', ...extra }
}
export function api(nodeId: string, style: ApiStyle, language: string, framework: string, basePath: string, operations: Operation[], types: TypeDef[] = []): ApiSpec {
  return { nodeId, style, language, framework, basePath, operations, types }
}
export function type(name: string, fields: string, kind: TypeDef['kind'] = 'object'): TypeDef {
  return {
    id: uid('ty'), name, kind,
    fields: fields.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [n, tRaw] = s.split(':').map((x) => x.trim())
      const list = tRaw.startsWith('[')
      const required = tRaw.endsWith('!')
      return { name: n, type: tRaw.replace(/[[\]!]/g, ''), required, list }
    }),
  }
}

export const block = (type: string, props: Block['props'] = {}): Block => ({ id: uid('b'), type, props })
export function page(appNodeId: string, name: string, route: string, blocks: Block[], extra: Partial<Page> = {}): Page {
  return { id: uid('pg'), appNodeId, name, route, render: 'ssr', access: 'public', title: name, blocks, ...extra }
}

export function env(id: string, name: string, provider: string, region: string, extra: Partial<Environment> = {}): Environment {
  return { id, name, defaultProvider: provider, defaultRegion: region, scale: 1, strategy: 'rolling', approval: false, autoRollback: true, overrides: {}, secrets: [], target: { kind: 'docker' }, ...extra }
}
export const defaultObservability = (): ObservabilityConfig => ({ metrics: 'Prometheus', logs: 'Loki', traces: 'Tempo', sampling: 0.1, slos: [], alerts: [] })

export function project(p: Omit<ProjectDoc, 'updatedAt' | 'groups'> & { groups?: ProjectDoc['groups'] }): ProjectDoc {
  return { groups: [], ...p, updatedAt: Date.now() }
}
