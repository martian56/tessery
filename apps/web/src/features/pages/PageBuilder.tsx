import { useState } from 'react'
import { LayoutTemplate, Monitor, Plus, Smartphone, Tablet } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit } from '@/store'
import { ui } from '@/store/uiSlice'
import { Badge, DropdownMenu, Empty, Segmented, Spacer, Toolbar, Button } from '@/ui'
import { BLOCKS, BLOCK_BY_TYPE, renderBlock } from './blocks'
import { useCurrentPage } from './usePage'
import s from './Pages.module.css'

export function PageBuilder() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const { page, block, device } = useCurrentPage()
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  if (!page) {
    const hasApp = doc.nodes.some((n) => n.techId === 'web-app')
    return <Empty icon={<LayoutTemplate />} title="No pages yet">{hasApp ? 'Create a page with New page in the left panel, then drag blocks onto it.' : 'Add a Web App on the Design canvas, then create pages for it from the left panel.'}</Empty>
  }
  const app = doc.nodes.find((n) => n.id === page.appNodeId)
  const opLabel = (key: unknown) => {
    if (typeof key !== 'string' || !key) return null
    const [nid, name] = key.split(':')
    const n = doc.nodes.find((x) => x.id === nid)
    const ok = !!doc.apis[nid]?.operations.some((o) => o.name === name)
    return { text: `${n?.name ?? '?'}.${name}`, ok }
  }
  const onDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/tessery-block')
    if (type) { const id = edit('addBlock', { pageId: page.id, type, props: { ...BLOCK_BY_TYPE[type].defaults }, after: index > 0 ? page.blocks[index - 1]?.id : undefined }); if (index === 0 && id) edit('moveBlock', { pageId: page.id, blockId: id, to: 0 }); dispatch(ui.setPages({ blockId: id ?? null })) }
    else if (dragId) { const from = page.blocks.findIndex((b) => b.id === dragId); edit('moveBlock', { pageId: page.id, blockId: dragId, to: from < index ? index - 1 : index }) }
    setDropAt(null); setDragId(null)
  }
  const width = device === 'mobile' ? 390 : device === 'tablet' ? 720 : 960
  return (
    <div className={s.center}>
      <Toolbar>
        <b>{page.name}</b>
        <span className="muted mono" style={{ fontSize: 11 }}>{page.route}</span>
        <Badge>{page.render.toUpperCase()}</Badge>
        <Badge tone={page.access === 'public' ? 'neutral' : 'warn'}>{page.access}</Badge>
        <span className="muted" style={{ fontSize: 11 }}>{app?.name} · {String(app?.config.framework ?? '')}</span>
        <Spacer />
        <DropdownMenu trigger={<Button size="sm" icon={<Plus />}>Block</Button>} items={(['Layout', 'Content', 'Data', 'Forms', 'Marketing'] as const).map((g) => ({ kind: 'sub' as const, label: g, items: BLOCKS.filter((b) => b.group === g).map((b) => ({ label: b.label, onSelect: () => { const id = edit('addBlock', { pageId: page.id, type: b.type, props: { ...b.defaults }, after: block?.id }); dispatch(ui.setPages({ blockId: id ?? null })) } })) }))} />
        <Segmented value={device} onChange={(v) => dispatch(ui.setPages({ device: v }))} options={[{ value: 'desktop', icon: <Monitor />, tooltip: 'Desktop' }, { value: 'tablet', icon: <Tablet />, tooltip: 'Tablet' }, { value: 'mobile', icon: <Smartphone />, tooltip: 'Mobile' }]} />
      </Toolbar>
      <div className={s.stage} onClick={(e) => { if (e.target === e.currentTarget) dispatch(ui.setPages({ blockId: null })) }}>
        <div className={s.frame} style={{ width }}>
          <div className={s.chrome}><i /><i /><i /><span>{app?.name}.example.com{page.route.replace(/\[(\w+)\]/g, '$1-1')}</span></div>
          <div className={s.page} onDragOver={(e) => { e.preventDefault(); if (!page.blocks.length) setDropAt(0) }} onDrop={(e) => onDrop(e, page.blocks.length)} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropAt(null) }}>
            {page.blocks.map((b, i) => {
              const src = opLabel(b.props.source), act = opLabel(b.props.action)
              return (
                <div key={b.id}>
                  {dropAt === i && <div className={s.dropLine} />}
                  <div className={clsx(s.blk, block?.id === b.id && s.sel, dragId === b.id && s.dragging)} draggable
                    onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move' }}
                    onDragEnd={() => { setDragId(null); setDropAt(null) }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1) }}
                    onDrop={(e) => { e.stopPropagation(); onDrop(e, dropAt ?? i) }}
                    onClick={() => dispatch(ui.setPages({ blockId: b.id }))}>
                    <span className={s.tag}>{BLOCK_BY_TYPE[b.type]?.label ?? b.type}</span>
                    {renderBlock(b, device)}
                    {(src || act) && <div className={s.binding}>{src && <span className={src.ok ? '' : s.bad}>↳ data: {src.text}{src.ok ? '' : ' (missing)'}</span>}{act && <span className={act.ok ? '' : s.bad}>↳ action: {act.text}{act.ok ? '' : ' (missing)'}</span>}</div>}
                  </div>
                </div>
              )
            })}
            {dropAt === page.blocks.length && <div className={s.dropLine} />}
            {!page.blocks.length && <div className={s.emptyPage}>Drag blocks here from the left panel</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
