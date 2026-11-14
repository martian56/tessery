import { useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit } from '@/store'
import { ui } from '@/store/uiSlice'
import { Button, Empty, PanelHeader, TabStrip, useDialogs } from '@/ui'
import { BLOCKS } from './blocks'
import { Layers } from './Layers'
import { ELEMENTS, SECTIONS } from './sections'
import type { ElementSeed } from './canvas/tools'
import { useCurrentPage } from './usePage'
import s from './Pages.module.css'

export function PagesSidebar() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const dialogs = useDialogs()
  const { apps, page } = useCurrentPage()
  const [tab, setTab] = useState<'layers' | 'insert'>('layers')
  const addPage = async (appNodeId: string) => {
    const first = !doc.pages.some((p) => p.appNodeId === appNodeId && p.route === '/')
    const v = await dialogs.prompt({ title: 'New page', fields: [{ name: 'name', label: 'Name', value: first ? 'Home' : 'About' }, { name: 'route', label: 'Route', value: first ? '/' : '/about' }], ok: 'Create' })
    if (!v?.name.trim()) return
    const id = edit('addPage', { appNodeId, name: v.name.trim(), route: v.route.trim().startsWith('/') ? v.route.trim() : `/${v.route.trim()}` })
    dispatch(ui.setPages({ pageId: id ?? null, blockId: null }))
  }
  const insert = (seed: ElementSeed) => {
    if (!page) return
    const id = edit('addElement', { pageId: page.id, element: seed })
    if (id) dispatch(ui.setPages({ blockId: id }))
  }
  const item = (key: string, label: string, data: [string, string], onAdd: () => void) => (
    <div key={key} className={s.paletteItem} draggable title="Drag onto the page, or double-click to add at the end"
      onDragStart={(e) => { e.dataTransfer.setData(data[0], data[1]); e.dataTransfer.effectAllowed = 'copy' }} onDoubleClick={onAdd}>
      <div className={s.paletteThumb}>{label.slice(0, 1)}</div>{label}
    </div>
  )
  return (
    <div className={s.side}>
      <div className={s.sideTop} style={{ flex: '0 1 34%' }}>
        <PanelHeader title="Apps & pages" meta={doc.pages.length} />
        <div className={s.scroll}>
          {!apps.length && <Empty title="No client apps">Add a Web, Mobile or Desktop App on the Design canvas.</Empty>}
          {apps.map((a) => (
            <div key={a.id} className={s.app}>
              <div className={s.appHead}><span className={s.appName}>{a.name}</span><span className="muted mono" style={{ fontSize: 10 }}>{String(a.config.framework)}</span></div>
              {doc.pages.filter((p) => p.appNodeId === a.id).map((p) => (
                <button key={p.id} className={clsx(s.pageRow, page?.id === p.id && s.on)} onClick={() => dispatch(ui.setPages({ pageId: p.id, blockId: null }))}>
                  <FileText size={12} /><span>{p.name}</span><span className={s.route}>{p.route}</span>
                </button>
              ))}
              <Button size="xs" variant="ghost" icon={<Plus />} onClick={() => addPage(a.id)}>New page</Button>
            </div>
          ))}
        </div>
      </div>
      <div className={s.sideBottom} style={{ flex: '1 1 66%' }}>
        <TabStrip value={tab} onChange={setTab} tabs={[{ value: 'layers', label: 'Layers' }, { value: 'insert', label: 'Insert' }]} />
        <div className={s.scroll}>
          {page && tab === 'layers' && <Layers page={page} />}
          {page && tab === 'insert' && (
            <>
              <div className={s.group}>Sections</div>
              <div className={s.palette}>{SECTIONS.map((x) => item(x.label, x.label, ['application/tessery-element', JSON.stringify(x.seed)], () => insert(x.seed)))}</div>
              <div className={s.group}>Elements</div>
              <div className={s.palette}>{ELEMENTS.map((x) => item(x.label, x.label, ['application/tessery-element', JSON.stringify(x.seed)], () => insert(x.seed)))}</div>
              <div className={s.group}>Data and forms</div>
              <div className={s.palette}>{BLOCKS.map((b) => item(b.type, b.label, ['application/tessery-block', b.type], () => insert({ type: 'block', name: b.label, props: { block: b.type } })))}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
