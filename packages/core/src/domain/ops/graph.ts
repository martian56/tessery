import type { SystemEdge, SystemNode, ConfigValue, Placement, ProjectDoc } from '../types'
import { newEdge, newNode, uid } from '../builders'
import { TECH_BY_ID, portsCompatible } from '../../catalog/technologies'
import { API_STYLE_META, frameworksFor } from '../../catalog/languages'
import { api } from '../builders'
import type { AgentCommand } from '../commands'

const uniqueName = (doc: ProjectDoc, base: string) => {
  let name = base, i = 2
  while (doc.nodes.some((n) => n.name === name)) name = `${base}-${i++}`
  return name
}

export function inputType(node: SystemNode, portId: string) {
  const tech = TECH_BY_ID[node.techId]
  if (tech.id === 'service' && portId === 'in') return API_STYLE_META[(node.config.apiStyle as keyof typeof API_STYLE_META) ?? 'rest']?.port ?? 'http'
  return tech.inputs.find((p) => p.id === portId)?.type ?? 'http'
}

function ensureApi(doc: ProjectDoc, n: SystemNode) {
  if (n.techId !== 'service' || doc.apis[n.id]) return
  const style = (n.config.apiStyle as string) ?? 'rest'
  const lang = (n.config.language as string) ?? 'TypeScript'
  const fits = frameworksFor(lang, style as never)
  const fw = fits.some((f) => f.name === n.config.framework) ? String(n.config.framework) : fits[0]?.name ?? String(n.config.framework ?? '')
  n.config.framework = fw
  doc.apis[n.id] = api(n.id, style as never, lang, fw, style === 'graphql' ? '/graphql' : style === 'grpc' ? `${n.name}.v1.${n.name[0].toUpperCase()}${n.name.slice(1)}Service` : '/v1', [])
}

const NODE_W = 240
const NODE_H = 150

function freeSpot(doc: ProjectDoc, x: number, y: number): { x: number; y: number } {
  const taken = (px: number, py: number) => doc.nodes.some((o) => Math.abs(o.x - px) < NODE_W && Math.abs(o.y - py) < NODE_H)
  if (!taken(x, y)) return { x, y }
  for (let r = 1; r < 40; r++) {
    for (const [dx, dy] of [[r, 0], [0, r], [r, r], [-r, 0], [0, -r], [-r, r], [r, -r], [-r, -r]]) {
      const px = x + dx * NODE_W, py = y + dy * NODE_H
      if (!taken(px, py)) return { x: px, y: py }
    }
  }
  return { x, y }
}

export const graphOps = {
  addNode(doc: ProjectDoc, a: { techId: string; x: number; y: number; name?: string; providerId?: string; regionId?: string; config?: Record<string, ConfigValue>; id?: string }) {
    const tech = TECH_BY_ID[a.techId]
    const env = doc.environments.find((e) => e.id === 'prod') ?? doc.environments[0]
    const base = a.name ?? tech.name.toLowerCase().split(/[\s/(]+/)[0].replace(/[^a-z0-9-]/g, '')
    const spot = freeSpot(doc, Math.round(a.x / 10) * 10, Math.round(a.y / 10) * 10)
    const n = newNode(a.techId, uniqueName(doc, base || tech.glyph), spot.x, spot.y,
      { provider: a.providerId ?? env?.defaultProvider ?? 'aws', region: a.regionId ?? env?.defaultRegion, config: a.config, id: a.id })
    const port = n.config.port
    if (typeof port === 'number') { let p = port; while (doc.nodes.some((o) => o.config.port === p)) p++; n.config.port = p }
    doc.nodes.push(n)
    ensureApi(doc, n)
    if (['postgres', 'mysql', 'mariadb', 'cockroachdb', 'timescaledb', 'clickhouse', 'sqlite', 'supabase', 'pgvector'].includes(a.techId)) doc.databases[n.id] = { nodeId: n.id, tables: [] }
    return n.id
  },
  updateNode(doc: ProjectDoc, a: { id: string; patch: Partial<Pick<SystemNode, 'name' | 'replicas' | 'notes'>> }) {
    const n = doc.nodes.find((x) => x.id === a.id); if (!n) return
    Object.assign(n, a.patch)
    if (a.patch.name) n.name = a.patch.name.trim().replace(/\s+/g, '-') || n.name
  },
  setConfig(doc: ProjectDoc, a: { id: string; key: string; value: ConfigValue }) {
    const n = doc.nodes.find((x) => x.id === a.id); if (!n) return
    n.config[a.key] = a.value
    const spec = doc.apis[n.id]
    if (n.techId === 'service') {
      if (a.key === 'apiStyle' && spec) { spec.style = a.value as never; const fw = frameworksFor(spec.language, spec.style)[0]; if (fw) { spec.framework = fw.name; n.config.framework = fw.name } }
      if (a.key === 'language' && spec) { spec.language = String(a.value); const fw = frameworksFor(spec.language, spec.style)[0]; if (fw) { spec.framework = fw.name; n.config.framework = fw.name } }
      if (a.key === 'framework' && spec) spec.framework = String(a.value)
      ensureApi(doc, n)
    }
  },
  setPlacement(doc: ProjectDoc, a: { id: string; placement: Partial<Placement> }) {
    const n = doc.nodes.find((x) => x.id === a.id); if (n) n.placement = { ...n.placement, ...a.placement }
  },
  moveNodes(doc: ProjectDoc, a: { moves: { id: string; x: number; y: number }[] }) {
    a.moves.forEach((m) => { const n = doc.nodes.find((x) => x.id === m.id); if (n) { n.x = m.x; n.y = m.y } })
  },
  removeNodes(doc: ProjectDoc, a: { ids: string[] }) {
    const s = new Set(a.ids)
    doc.nodes = doc.nodes.filter((n) => !s.has(n.id))
    doc.edges = doc.edges.filter((e) => !s.has(e.source) && !s.has(e.target))
    a.ids.forEach((id) => { delete doc.apis[id]; delete doc.databases[id] })
    doc.pages = doc.pages.filter((p) => !s.has(p.appNodeId))
    doc.environments.forEach((e) => a.ids.forEach((id) => delete e.overrides[id]))
  },
  duplicateNodes(doc: ProjectDoc, a: { ids: string[]; dx?: number; dy?: number }) {
    const map = new Map<string, string>()
    a.ids.forEach((id) => {
      const o = doc.nodes.find((x) => x.id === id); if (!o) return
      const n: SystemNode = { ...structuredClone(o), id: uid('n'), name: uniqueName(doc, o.name), x: o.x + (a.dx ?? 40), y: o.y + (a.dy ?? 40) }
      doc.nodes.push(n); map.set(id, n.id)
      if (doc.apis[id]) doc.apis[n.id] = { ...structuredClone(doc.apis[id]), nodeId: n.id }
      if (doc.databases[id]) doc.databases[n.id] = { ...structuredClone(doc.databases[id]), nodeId: n.id }
    })
    doc.edges.filter((e) => map.has(e.source) && map.has(e.target)).forEach((e) => doc.edges.push({ ...e, id: uid('e'), source: map.get(e.source)!, target: map.get(e.target)! }))
    return [...map.values()]
  },
  pasteNodes(doc: ProjectDoc, a: { nodes: SystemNode[]; edges: SystemEdge[]; at?: { x: number; y: number } }) {
    const map = new Map<string, string>()
    const minX = Math.min(...a.nodes.map((n) => n.x)), minY = Math.min(...a.nodes.map((n) => n.y))
    a.nodes.forEach((o) => {
      const n: SystemNode = { ...structuredClone(o), id: uid('n'), name: uniqueName(doc, o.name), x: a.at ? a.at.x + o.x - minX : o.x + 40, y: a.at ? a.at.y + o.y - minY : o.y + 40 }
      doc.nodes.push(n); map.set(o.id, n.id); ensureApi(doc, n)
    })
    a.edges.forEach((e) => { if (map.has(e.source) && map.has(e.target)) doc.edges.push({ ...e, id: uid('e'), source: map.get(e.source)!, target: map.get(e.target)! }) })
    return [...map.values()]
  },
  connect(doc: ProjectDoc, a: { source: string; sourcePort?: string; target: string; targetPort?: string }) {
    const s = doc.nodes.find((x) => x.id === a.source), t = doc.nodes.find((x) => x.id === a.target)
    if (!s || !t || s.id === t.id) return null
    const st = TECH_BY_ID[s.techId], tt = TECH_BY_ID[t.techId]
    const outs = a.sourcePort ? st.outputs.filter((p) => p.id === a.sourcePort) : st.outputs
    const ins = a.targetPort ? tt.inputs.filter((p) => p.id === a.targetPort) : tt.inputs
    for (const o of outs) for (const i of ins) {
      if (!portsCompatible(o.type, inputType(t, i.id))) continue
      if (doc.edges.some((e) => e.source === s.id && e.target === t.id && e.targetPort === i.id)) return null
      const e = newEdge(s, t, o.id, i.id)
      doc.edges.push(e)
      return e.id
    }
    return null
  },
  updateEdge(doc: ProjectDoc, a: { id: string; patch: Partial<SystemEdge> }) {
    const e = doc.edges.find((x) => x.id === a.id); if (e) Object.assign(e, a.patch)
  },
  removeEdges(doc: ProjectDoc, a: { ids: string[] }) {
    const s = new Set(a.ids); doc.edges = doc.edges.filter((e) => !s.has(e.id))
  },
  renameProject(doc: ProjectDoc, a: { name?: string; description?: string }) {
    if (a.name) doc.name = a.name.trim().replace(/\s+/g, '-')
    if (a.description !== undefined) doc.description = a.description
  },
  autoLayout(doc: ProjectDoc) {
    const order = ['client', 'network', 'security', 'compute', 'ai', 'cache', 'data', 'messaging', 'storage', 'observability', 'external']
    const cols: Record<number, SystemNode[]> = {}
    doc.nodes.forEach((n) => { const c = TECH_BY_ID[n.techId].category; const col = Math.min(5, Math.floor(order.indexOf(c) / 2)); (cols[col] ??= []).push(n) })
    Object.entries(cols).forEach(([c, ns]) => ns.forEach((n, i) => { n.x = +c * 300; n.y = i * 170 }))
  },
  applyAgentPatch(doc: ProjectDoc, a: { commands: AgentCommand[] }) {
    const refs = new Map<string, string>()
    const r = (id: string) => refs.get(id) ?? id
    for (const c of a.commands) {
      if (c.op === 'addNode') {
        const near = c.near ? doc.nodes.find((n) => n.id === r(c.near!)) : undefined
        const xs = doc.nodes.map((n) => n.x), ys = doc.nodes.map((n) => n.y)
        let x = near ? near.x + 300 : (xs.length ? Math.max(...xs) + 300 : 0), y = near ? near.y : (ys.length ? Math.min(...ys) : 0)
        while (doc.nodes.some((n) => Math.abs(n.x - x) < 200 && Math.abs(n.y - y) < 140)) y += 160
        refs.set(c.ref, graphOps.addNode(doc, { techId: c.techId, x, y, name: c.name, config: c.config }))
      }
      if (c.op === 'link') graphOps.connect(doc, { source: r(c.from), target: r(c.to) })
      if (c.op === 'removeNode') graphOps.removeNodes(doc, { ids: [r(c.node)] })
      if (c.op === 'setReplicas') graphOps.updateNode(doc, { id: r(c.node), patch: { replicas: c.replicas } })
      if (c.op === 'setConfig') graphOps.setConfig(doc, { id: r(c.node), key: c.key, value: c.value })
      if (c.op === 'setPlacement') graphOps.setPlacement(doc, { id: r(c.node), placement: { providerId: c.providerId, mode: c.mode } })
    }
    return [...refs.values()]
  },
}
