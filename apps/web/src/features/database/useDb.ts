import { useDoc, useUi } from '@/store'

export function useCurrentDb() {
  const doc = useDoc()
  const cur = useUi((u) => u.database)
  const ids = Object.keys(doc.databases).filter((id) => doc.nodes.some((n) => n.id === id))
  const nodeId = cur.nodeId && ids.includes(cur.nodeId) ? cur.nodeId : ids[0]
  const schema = nodeId ? doc.databases[nodeId] : undefined
  const node = doc.nodes.find((n) => n.id === nodeId)
  const table = schema?.tables.find((t) => t.id === cur.tableId) ?? undefined
  return { ids, nodeId, schema, node, table, view: cur.view }
}
