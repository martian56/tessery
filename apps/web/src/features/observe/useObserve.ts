import { useEffect, useMemo } from 'react'
import { useEnvStatusQuery, type NodeStatus } from '@/api/endpoints/runtime'
import { useDoc, useUi } from '@/store'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'

export interface Point { t: number; v: number }
export interface Sample { cpu: Point[]; memory: Point[] }

const history = new Map<string, Sample>()
const MAX = 120

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0)

export function useEnvStatus() {
  const doc = useDoc()
  const env = useUi((u) => u.envId)
  const q = useEnvStatusQuery({ pid: doc.id, env }, { pollingInterval: 5000, skipPollingIfUnfocused: true })
  const byNode = useMemo(() => new Map<string, NodeStatus>((q.data?.nodes ?? []).map((n) => [n.nodeId ?? n.name, n])), [q.data])
  const services = useMemo(() => doc.nodes.filter((n) => TECH_BY_ID[n.techId].category !== 'client' || n.techId === 'web-app'), [doc.nodes])

  useEffect(() => {
    if (!q.data) return
    const t = Date.now()
    for (const n of q.data.nodes) {
      const key = `${doc.id}/${env}/${n.nodeId ?? n.name}`
      const h = history.get(key) ?? { cpu: [], memory: [] }
      const cpu = n.instances.some((i) => i.cpuPercent != null) ? sum(n.instances.map((i) => i.cpuPercent)) : null
      const mem = n.instances.some((i) => i.memoryBytes != null) ? sum(n.instances.map((i) => i.memoryBytes)) / (1024 * 1024) : null
      if (cpu != null) h.cpu = [...h.cpu, { t, v: cpu }].slice(-MAX)
      if (mem != null) h.memory = [...h.memory, { t, v: mem }].slice(-MAX)
      history.set(key, h)
    }
  }, [q.data, doc.id, env])

  const samples = (nodeId: string): Sample => history.get(`${doc.id}/${env}/${nodeId}`) ?? { cpu: [], memory: [] }
  return { ...q, env, byNode, services, samples }
}

export function health(n?: NodeStatus): string {
  if (!n || !n.instances.length) return 'var(--tx-3)'
  if (n.instances.some((i) => i.state !== 'running' || i.healthy === false)) return n.instances.some((i) => i.state === 'running') ? 'var(--warn)' : 'var(--err)'
  return 'var(--ok)'
}

export const cpuOf = (n?: NodeStatus) => (n && n.instances.some((i) => i.cpuPercent != null) ? sum(n.instances.map((i) => i.cpuPercent)) : null)
export const memoryOf = (n?: NodeStatus) => (n && n.instances.some((i) => i.memoryBytes != null) ? sum(n.instances.map((i) => i.memoryBytes)) : null)
export const limitOf = (n?: NodeStatus) => (n && n.instances.some((i) => i.memoryLimitBytes != null) ? sum(n.instances.map((i) => i.memoryLimitBytes)) : null)
