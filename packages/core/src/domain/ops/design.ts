import type { ApiSpec, Block, Column, Environment, Index, Operation, Page, ProjectDoc, Table, TypeDef, AlertRule, SloDef, ObservabilityConfig, ConfigValue } from '../types'
import { block as mkBlock, op as mkOp, table as mkTable, type as mkType, uid } from '../builders'

const spec = (doc: ProjectDoc, nodeId: string) => doc.apis[nodeId]
const tbl = (doc: ProjectDoc, nodeId: string, tableId: string) => doc.databases[nodeId]?.tables.find((t) => t.id === tableId)
const pg = (doc: ProjectDoc, id: string) => doc.pages.find((p) => p.id === id)
const move = <T>(arr: T[], from: number, to: number) => { if (to < 0 || to >= arr.length) return; const [x] = arr.splice(from, 1); arr.splice(to, 0, x) }

export const apiOps = {
  updateApi(doc: ProjectDoc, a: { nodeId: string; patch: Partial<Pick<ApiSpec, 'style' | 'language' | 'framework' | 'basePath'>> }) {
    const s = spec(doc, a.nodeId); if (!s) return
    Object.assign(s, a.patch)
    const n = doc.nodes.find((x) => x.id === a.nodeId)
    if (n) { if (a.patch.style) n.config.apiStyle = a.patch.style; if (a.patch.language) n.config.language = a.patch.language; if (a.patch.framework) n.config.framework = a.patch.framework }
  },
  addOperation(doc: ProjectDoc, a: { nodeId: string; kind: string; name: string; summary?: string }) {
    const s = spec(doc, a.nodeId); if (!s) return
    const o = mkOp(a.kind, a.name, a.summary ?? '', 'user', ['auth', 'validate', 'respond'])
    s.operations.push(o); return o.id
  },
  addCrudOperations(doc: ProjectDoc, a: { nodeId: string; table: string; basePath?: string }) {
    const s = spec(doc, a.nodeId); if (!s) return []
    const words = a.table.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/)
    const plural = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join('')
    const Plural = plural[0].toUpperCase() + plural.slice(1)
    const Single = Plural.replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1')
    const base = `${(a.basePath ?? '').replace(/\/$/, '')}/${a.table}`
    const wanted: [string, string, string][] = [
      [`GET ${base}`, `list${Plural}`, `List ${a.table}`],
      [`GET ${base}/{id}`, `get${Single}`, `Read one ${Single.toLowerCase()}`],
      [`POST ${base}`, `create${Single}`, `Create a ${Single.toLowerCase()}`],
      [`PATCH ${base}/{id}`, `update${Single}`, `Change a ${Single.toLowerCase()}`],
      [`DELETE ${base}/{id}`, `delete${Single}`, `Delete a ${Single.toLowerCase()}`],
    ]
    const added: string[] = []
    for (const [kind, name, summary] of wanted) {
      if (s.operations.some((o) => o.kind === kind)) continue
      const o = mkOp(kind, name, summary, 'user', [])
      s.operations.push(o)
      added.push(o.id)
    }
    return added
  },
  updateOperation(doc: ProjectDoc, a: { nodeId: string; opId: string; patch: Partial<Operation> }) {
    const o = spec(doc, a.nodeId)?.operations.find((x) => x.id === a.opId); if (o) Object.assign(o, a.patch)
  },
  removeOperation(doc: ProjectDoc, a: { nodeId: string; opId: string }) {
    const s = spec(doc, a.nodeId); if (s) s.operations = s.operations.filter((x) => x.id !== a.opId)
  },
  duplicateOperation(doc: ProjectDoc, a: { nodeId: string; opId: string }) {
    const s = spec(doc, a.nodeId); const i = s?.operations.findIndex((x) => x.id === a.opId) ?? -1; if (!s || i < 0) return
    const o = { ...structuredClone(s.operations[i]), id: uid('op'), name: s.operations[i].name + 'Copy' }
    s.operations.splice(i + 1, 0, o); return o.id
  },
  setSteps(doc: ProjectDoc, a: { nodeId: string; opId: string; steps: string[] }) {
    const o = spec(doc, a.nodeId)?.operations.find((x) => x.id === a.opId); if (o) o.steps = a.steps
  },
  addType(doc: ProjectDoc, a: { nodeId: string; name: string; kind?: TypeDef['kind'] }) {
    const s = spec(doc, a.nodeId); if (!s) return
    const t = mkType(a.name, a.kind === 'enum' ? 'VALUE: _' : 'id: ID!', a.kind ?? 'object'); s.types.push(t); return t.id
  },
  updateType(doc: ProjectDoc, a: { nodeId: string; typeId: string; patch: Partial<TypeDef> }) {
    const t = spec(doc, a.nodeId)?.types.find((x) => x.id === a.typeId); if (t) Object.assign(t, a.patch)
  },
  removeType(doc: ProjectDoc, a: { nodeId: string; typeId: string }) {
    const s = spec(doc, a.nodeId); if (s) s.types = s.types.filter((x) => x.id !== a.typeId)
  },
}

export const dbOps = {
  addTable(doc: ProjectDoc, a: { nodeId: string; name: string; x?: number; y?: number }) {
    const schema = (doc.databases[a.nodeId] ??= { nodeId: a.nodeId, tables: [] })
    const t = mkTable(a.name, 'id uuid pk, created_at timestamptz', a.x ?? 40 + schema.tables.length * 30, a.y ?? 40 + schema.tables.length * 30)
    schema.tables.push(t); return t.id
  },
  updateTable(doc: ProjectDoc, a: { nodeId: string; tableId: string; patch: Partial<Pick<Table, 'name' | 'comment' | 'x' | 'y'>> }) {
    const t = tbl(doc, a.nodeId, a.tableId); if (!t) return
    const old = t.name
    Object.assign(t, a.patch)
    if (a.patch.name && a.patch.name !== old) doc.databases[a.nodeId].tables.forEach((x) => x.columns.forEach((c) => { if (c.ref?.table === old) c.ref.table = a.patch.name! }))
  },
  moveTables(doc: ProjectDoc, a: { nodeId: string; moves: { id: string; x: number; y: number }[] }) {
    a.moves.forEach((m) => { const t = tbl(doc, a.nodeId, m.id); if (t) { t.x = m.x; t.y = m.y } })
  },
  removeTable(doc: ProjectDoc, a: { nodeId: string; tableId: string }) {
    const s = doc.databases[a.nodeId]; if (!s) return
    const t = s.tables.find((x) => x.id === a.tableId)
    s.tables = s.tables.filter((x) => x.id !== a.tableId)
    if (t) s.tables.forEach((x) => x.columns.forEach((c) => { if (c.ref?.table === t.name) delete c.ref }))
  },
  addColumn(doc: ProjectDoc, a: { nodeId: string; tableId: string; column?: Partial<Column> }) {
    const t = tbl(doc, a.nodeId, a.tableId); if (!t) return
    let name = a.column?.name ?? 'column', i = 2
    while (t.columns.some((c) => c.name === name)) name = `${a.column?.name ?? 'column'}_${i++}`
    const c: Column = { id: uid('c'), type: 'text', nullable: true, ...a.column, name }
    t.columns.push(c); return c.id
  },
  updateColumn(doc: ProjectDoc, a: { nodeId: string; tableId: string; columnId: string; patch: Partial<Column> }) {
    const c = tbl(doc, a.nodeId, a.tableId)?.columns.find((x) => x.id === a.columnId); if (c) Object.assign(c, a.patch)
  },
  moveColumn(doc: ProjectDoc, a: { nodeId: string; tableId: string; columnId: string; dir: -1 | 1 }) {
    const t = tbl(doc, a.nodeId, a.tableId); if (!t) return
    const i = t.columns.findIndex((c) => c.id === a.columnId); move(t.columns, i, i + a.dir)
  },
  removeColumn(doc: ProjectDoc, a: { nodeId: string; tableId: string; columnId: string }) {
    const t = tbl(doc, a.nodeId, a.tableId); if (!t) return
    const c = t.columns.find((x) => x.id === a.columnId)
    t.columns = t.columns.filter((x) => x.id !== a.columnId)
    if (c) t.indexes = t.indexes.filter((ix) => !ix.columns.includes(c.name))
  },
  addIndex(doc: ProjectDoc, a: { nodeId: string; tableId: string; columns: string[]; unique?: boolean; method?: Index['method'] }) {
    const t = tbl(doc, a.nodeId, a.tableId); if (!t || !a.columns.length) return
    t.indexes.push({ id: uid('ix'), name: `${t.name}_${a.columns.join('_')}_${a.unique ? 'key' : 'idx'}`, columns: a.columns, unique: !!a.unique, method: a.method ?? 'btree' })
  },
  updateIndex(doc: ProjectDoc, a: { nodeId: string; tableId: string; indexId: string; patch: Partial<Index> }) {
    const ix = tbl(doc, a.nodeId, a.tableId)?.indexes.find((x) => x.id === a.indexId); if (ix) Object.assign(ix, a.patch)
  },
  removeIndex(doc: ProjectDoc, a: { nodeId: string; tableId: string; indexId: string }) {
    const t = tbl(doc, a.nodeId, a.tableId); if (t) t.indexes = t.indexes.filter((x) => x.id !== a.indexId)
  },
}

export const pageOps = {
  addPage(doc: ProjectDoc, a: { appNodeId: string; name: string; route: string }) {
    const p: Page = { id: uid('pg'), appNodeId: a.appNodeId, name: a.name, route: a.route, render: 'ssr', access: 'public', title: a.name, blocks: [mkBlock('navbar', { brand: doc.name }), mkBlock('text', { heading: a.name, body: '' })] }
    doc.pages.push(p); return p.id
  },
  updatePage(doc: ProjectDoc, a: { pageId: string; patch: Partial<Omit<Page, 'id' | 'blocks'>> }) {
    const p = pg(doc, a.pageId); if (p) Object.assign(p, a.patch)
  },
  duplicatePage(doc: ProjectDoc, a: { pageId: string }) {
    const p = pg(doc, a.pageId); if (!p) return
    const c: Page = { ...structuredClone(p), id: uid('pg'), name: `${p.name} copy`, route: `${p.route === '/' ? '' : p.route}/copy` }
    c.blocks.forEach((b) => (b.id = uid('b'))); doc.pages.push(c); return c.id
  },
  removePage(doc: ProjectDoc, a: { pageId: string }) { doc.pages = doc.pages.filter((p) => p.id !== a.pageId) },
  addBlock(doc: ProjectDoc, a: { pageId: string; type: string; props: Block['props']; after?: string }) {
    const p = pg(doc, a.pageId); if (!p) return
    const b = mkBlock(a.type, a.props)
    const i = a.after ? p.blocks.findIndex((x) => x.id === a.after) + 1 : p.blocks.length
    p.blocks.splice(i, 0, b); return b.id
  },
  updateBlock(doc: ProjectDoc, a: { pageId: string; blockId: string; key: string; value: ConfigValue }) {
    const b = pg(doc, a.pageId)?.blocks.find((x) => x.id === a.blockId); if (b) b.props[a.key] = a.value
  },
  moveBlock(doc: ProjectDoc, a: { pageId: string; blockId: string; to: number }) {
    const p = pg(doc, a.pageId); if (!p) return
    move(p.blocks, p.blocks.findIndex((b) => b.id === a.blockId), a.to)
  },
  duplicateBlock(doc: ProjectDoc, a: { pageId: string; blockId: string }) {
    const p = pg(doc, a.pageId); const i = p?.blocks.findIndex((b) => b.id === a.blockId) ?? -1; if (!p || i < 0) return
    const b = { ...structuredClone(p.blocks[i]), id: uid('b') }; p.blocks.splice(i + 1, 0, b); return b.id
  },
  removeBlock(doc: ProjectDoc, a: { pageId: string; blockId: string }) {
    const p = pg(doc, a.pageId); if (p) p.blocks = p.blocks.filter((b) => b.id !== a.blockId)
  },
}

export const envOps = {
  updateEnv(doc: ProjectDoc, a: { envId: string; patch: Partial<Omit<Environment, 'id'>> }) {
    const e = doc.environments.find((x) => x.id === a.envId); if (e) Object.assign(e, a.patch)
  },
  addEnv(doc: ProjectDoc, a: { name: string; provider: string; region: string }) {
    const id = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || uid('env')
    doc.environments.push({ id, name: a.name, defaultProvider: a.provider, defaultRegion: a.region, scale: 1, strategy: 'rolling', approval: false, autoRollback: true, overrides: {}, secrets: [], target: { kind: 'docker' } })
    return id
  },
  removeEnv(doc: ProjectDoc, a: { envId: string }) { doc.environments = doc.environments.filter((e) => e.id !== a.envId) },
  setOverride(doc: ProjectDoc, a: { envId: string; nodeId: string; placement: Environment['overrides'][string] | null }) {
    const e = doc.environments.find((x) => x.id === a.envId); if (!e) return
    if (a.placement) e.overrides[a.nodeId] = { ...e.overrides[a.nodeId], ...a.placement }
    else delete e.overrides[a.nodeId]
  },
  setSecrets(doc: ProjectDoc, a: { envId: string; secrets: string[] }) {
    const e = doc.environments.find((x) => x.id === a.envId); if (e) e.secrets = a.secrets
  },
}

export const obsOps = {
  updateObservability(doc: ProjectDoc, a: { patch: Partial<Pick<ObservabilityConfig, 'metrics' | 'logs' | 'traces' | 'sampling'>> }) { Object.assign(doc.observability, a.patch) },
  addSlo(doc: ProjectDoc, a: Omit<SloDef, 'id'>) { const s = { ...a, id: uid('slo') }; doc.observability.slos.push(s); return s.id },
  updateSlo(doc: ProjectDoc, a: { id: string; patch: Partial<SloDef> }) { const s = doc.observability.slos.find((x) => x.id === a.id); if (s) Object.assign(s, a.patch) },
  removeSlo(doc: ProjectDoc, a: { id: string }) { doc.observability.slos = doc.observability.slos.filter((x) => x.id !== a.id) },
  addAlert(doc: ProjectDoc, a: Omit<AlertRule, 'id'>) { const r = { ...a, id: uid('al') }; doc.observability.alerts.push(r); return r.id },
  updateAlert(doc: ProjectDoc, a: { id: string; patch: Partial<AlertRule> }) { const r = doc.observability.alerts.find((x) => x.id === a.id); if (r) Object.assign(r, a.patch) },
  removeAlert(doc: ProjectDoc, a: { id: string }) { doc.observability.alerts = doc.observability.alerts.filter((x) => x.id !== a.id) },
}
