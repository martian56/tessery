import { FileText, Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit } from '@/store'
import { ui } from '@/store/uiSlice'
import { Button, Empty, PanelHeader, useDialogs } from '@/ui'
import { BLOCKS } from './blocks'
import { useCurrentPage } from './usePage'
import s from './Pages.module.css'

export function PagesSidebar() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const dialogs = useDialogs()
  const { apps, page } = useCurrentPage()
  const addPage = async (appNodeId: string) => {
    const first = !doc.pages.some((p) => p.appNodeId === appNodeId && p.route === '/')
    const v = await dialogs.prompt({ title: 'New page', fields: [{ name: 'name', label: 'Name', value: first ? 'Home' : 'About' }, { name: 'route', label: 'Route', value: first ? '/' : '/about' }], ok: 'Create' })
    if (!v?.name.trim()) return
    const id = edit('addPage', { appNodeId, name: v.name.trim(), route: v.route.trim().startsWith('/') ? v.route.trim() : `/${v.route.trim()}` })
    dispatch(ui.setPages({ pageId: id ?? null, blockId: null }))
  }
  const groups = ['Layout', 'Content', 'Data', 'Forms', 'Marketing'] as const
  return (
    <div className={s.side}>
      <div className={s.sideTop}>
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
      <div className={s.sideBottom}>
        <PanelHeader title="Blocks" meta="drag into the page" />
        <div className={s.scroll}>
          {groups.map((g) => (
            <div key={g}>
              <div className={s.group}>{g}</div>
              {BLOCKS.filter((b) => b.group === g).map((b) => (
                <div key={b.type} className={s.blockItem} draggable onDragStart={(e) => { e.dataTransfer.setData('application/tessery-block', b.type); e.dataTransfer.effectAllowed = 'copy' }}
                  onDoubleClick={() => page && edit('addBlock', { pageId: page.id, type: b.type, props: { ...b.defaults } })}>
                  {b.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
