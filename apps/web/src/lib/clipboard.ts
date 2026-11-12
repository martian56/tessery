import type { SystemEdge, SystemNode } from '@tessery/core/domain/types'

let data: { nodes: SystemNode[]; edges: SystemEdge[] } | null = null
export const clipboard = {
  set(v: { nodes: SystemNode[]; edges: SystemEdge[] }) { data = structuredClone(v) },
  get() { return data },
}
