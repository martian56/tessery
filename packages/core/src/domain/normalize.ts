import type { SystemNode, Environment, ObservabilityConfig, ProjectDoc } from './types'

const OBSERVABILITY: ObservabilityConfig = { metrics: 'Prometheus', logs: 'Loki', traces: 'Tempo', sampling: 1, slos: [], alerts: [] }

function environment(e: Partial<Environment> & { id: string }): Environment {
  return {
    name: e.id,
    defaultProvider: 'self',
    defaultRegion: '',
    scale: 1,
    strategy: 'rolling',
    approval: false,
    autoRollback: true,
    ...e,
    overrides: e.overrides ?? {},
    secrets: e.secrets ?? [],
  }
}

function node(n: Partial<SystemNode> & { id: string; techId: string }): SystemNode {
  return {
    name: n.id,
    x: 0,
    y: 0,
    replicas: 1,
    ...n,
    config: n.config ?? {},
    placement: n.placement ?? { providerId: 'self', mode: 'self-hosted' },
  }
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : [])
const record = <T,>(v: unknown): Record<string, T> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {})

export function normalizeDoc(raw: unknown): ProjectDoc {
  const d = raw as Partial<ProjectDoc>
  if (!d || typeof d !== 'object') throw new Error('not an Tessery design document')
  return {
    id: d.id ?? '',
    name: d.name ?? 'untitled',
    description: d.description ?? '',
    icon: d.icon ?? 'o',
    updatedAt: d.updatedAt ?? 0,
    nodes: list<SystemNode>(d.nodes).map((n) => node(n)),
    edges: list(d.edges),
    groups: list(d.groups),
    apis: record(d.apis),
    databases: record(d.databases),
    pages: list(d.pages),
    environments: list<Environment>(d.environments).map((e) => environment(e)),
    observability: { ...OBSERVABILITY, ...record(d.observability) },
  }
}
