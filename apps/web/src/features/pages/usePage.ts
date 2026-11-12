import { useDoc, useUi } from '@/store'

export function useCurrentPage() {
  const doc = useDoc()
  const cur = useUi((u) => u.pages)
  const apps = doc.nodes.filter((n) => n.techId === 'web-app' || n.techId === 'mobile-app' || n.techId === 'desktop-app')
  const page = doc.pages.find((p) => p.id === cur.pageId) ?? doc.pages[0]
  const block = page?.blocks.find((b) => b.id === cur.blockId)
  return { apps, page, block, device: cur.device }
}

export function useBindableOps() {
  const doc = useDoc()
  return Object.values(doc.apis).flatMap((sp) => {
    const n = doc.nodes.find((x) => x.id === sp.nodeId)
    return n ? sp.operations.map((o) => ({ key: `${sp.nodeId}:${o.name}`, label: `${n.name} · ${o.kind.startsWith('GET') || o.kind.startsWith('POST') ? o.kind : `${o.kind} ${o.name}`}`, style: sp.style, kind: o.kind })) : []
  })
}
