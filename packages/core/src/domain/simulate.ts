import type { SystemEdge, SystemNode, ProjectDoc } from './types'
import { TECH_BY_ID } from '../catalog/technologies'

export interface NodeLoad { rps: number; util: number; latency: number; errorRate: number; down: boolean }
export interface SimResult { nodes: Record<string, NodeLoad>; edges: Record<string, number>; edge: { rps: number; p99: number; errorRate: number } }

const SYNC_TYPES = new Set(['http', 'graphql', 'grpc', 'ws', 'sql', 'nosql', 'kv', 'search', 'vector', 'llm', 'object'])

export function simulate(doc: Pick<ProjectDoc, 'nodes' | 'edges'>, opts: { load?: number; t?: number; down?: string[]; noise?: boolean } = {}): SimResult {
  const { load = 1, t = Date.now(), down = [], noise = true } = opts
  const downSet = new Set(down)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const out = new Map<string, SystemEdge[]>()
  doc.edges.forEach((e) => { if (!out.has(e.source)) out.set(e.source, []); out.get(e.source)!.push(e) })
  const tech = (n: SystemNode) => TECH_BY_ID[n.techId]
  const isClient = (n: SystemNode) => tech(n)?.category === 'client'
  const wave = (n: SystemNode) => 1 + 0.15 * Math.sin(t / 60000 + n.x / 97) + (noise ? (Math.random() - 0.5) * 0.06 : 0)

  const src: Record<string, number> = {}
  doc.nodes.forEach((n) => { src[n.id] = isClient(n) ? Number(n.config.trafficRps ?? 50) * load * wave(n) : 0 })

  const edgeFlow = (e: SystemEdge, rps: number, from: SystemNode) => {
    const tgt = byId.get(e.target)
    if (!tgt || isClient(tgt) || downSet.has(from.id)) return 0
    const tt = tech(tgt), ft = tech(from)
    const siblings = out.get(from.id)!.filter((x) => { const n = byId.get(x.target); return n && !isClient(n) })
    if (ft.category === 'client' || ft.category === 'network') {
      const callable = siblings.filter((x) => { const c = tech(byId.get(x.target)!).category; return c === 'compute' || c === 'network' || c === 'security' || c === 'ai' })
      if (tt.category === 'storage' || tt.category === 'network' && ft.category === 'client') return rps * 0.3
      return callable.includes(e) ? rps / Math.max(1, callable.length) : rps * 0.2
    }
    if (ft.category === 'messaging') return rps
    switch (tt.category) {
      case 'data': return rps * 0.8
      case 'cache': return rps * 1.2
      case 'messaging': return rps * 0.15
      case 'storage': return rps * 0.1
      case 'ai': return rps * 0.35
      case 'observability': return rps * 3
      case 'external': return rps * 0.05
      case 'security': return rps * 0.2
      default: return rps * 0.3
    }
  }

  let R: Record<string, number> = { ...src }
  for (let i = 0; i < 12; i++) {
    const nx: Record<string, number> = { ...src }
    for (const e of doc.edges) {
      const from = byId.get(e.source)
      if (from) nx[e.target] = (nx[e.target] ?? 0) + edgeFlow(e, R[e.source] ?? 0, from)
    }
    R = nx
  }

  const nodes: Record<string, NodeLoad> = {}
  doc.nodes.forEach((n) => {
    const tc = tech(n)
    const cap = (tc.capacity || 1e9) * Math.max(1, n.replicas)
    const util = isClient(n) ? 0 : R[n.id] / cap
    const isDown = downSet.has(n.id)
    const own = isDown ? 100 : util > 1 ? Math.min(85, (util - 1) * 70) : util > 0.85 ? (util - 0.85) * 6 : noise ? Math.random() * 0.05 : 0
    const lat = (tc.latency ?? 5) * (1 + Math.pow(Math.min(util, 3), 3) * 1.6)
    nodes[n.id] = { rps: R[n.id] ?? 0, util, latency: lat, errorRate: own, down: isDown }
  })
  for (let i = 0; i < 8; i++) {
    doc.nodes.forEach((n) => {
      if (downSet.has(n.id)) return
      const deps = (out.get(n.id) ?? []).filter((e) => {
        const tgt = byId.get(e.target); if (!tgt) return false
        const tt = TECH_BY_ID[tgt.techId]; const pt = tt.inputs.find((p) => p.id === e.targetPort)?.type ?? 'http'
        return SYNC_TYPES.has(pt) && tt.category !== 'observability'
      })
      const tc = tech(n)
      const fan = tc.category === 'client' || tc.category === 'network' ? Math.max(1, deps.filter((e) => ['compute', 'network', 'security'].includes(tech(byId.get(e.target)!).category)).length) : 1
      let lat = (tc.latency ?? 5) * (1 + Math.pow(Math.min(nodes[n.id].util, 3), 3) * 1.6)
      let ok = 1 - nodes[n.id].errorRate / 100
      deps.forEach((e) => { const c = nodes[e.target]; lat += c.latency * (tech(byId.get(e.target)!).category === 'cache' ? 0.4 : 1) / fan; ok *= 1 - (c.errorRate / 100) * (fan > 1 ? 1 / fan : 0.85) })
      nodes[n.id].latency = lat
      nodes[n.id].errorRate = Math.min(100, (1 - ok) * 100)
    })
  }
  const edges: Record<string, number> = {}
  doc.edges.forEach((e) => { const from = byId.get(e.source); edges[e.id] = from ? edgeFlow(e, R[e.source] ?? 0, from) : 0 })
  const clients = doc.nodes.filter(isClient)
  const total = clients.reduce((a, n) => a + (R[n.id] ?? 0), 0)
  return {
    nodes, edges,
    edge: {
      rps: total,
      p99: clients.length ? Math.max(...clients.map((n) => nodes[n.id].latency)) : 0,
      errorRate: total ? clients.reduce((a, n) => a + nodes[n.id].errorRate * (R[n.id] ?? 0), 0) / total : 0,
    },
  }
}
