import { Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { API_STYLE_META } from '@tessery/core/catalog/languages'
import { Button, Empty, PanelHeader, Tooltip } from '@/ui'
import { newOperation, opView } from './apiMeta'
import s from './Api.module.css'

export function ApiSidebar() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const cur = useUi((u) => u.api)
  const specs = Object.values(doc.apis).filter((a) => doc.nodes.some((n) => n.id === a.nodeId))
  return (
    <div className={s.side}>
      <PanelHeader title="Services" meta={`${specs.length} APIs`} />
      <div className={s.scroll}>
        {!specs.length && <Empty title="No APIs yet">Add a Service on the Design canvas and pick an API style.</Empty>}
        {specs.map((sp) => {
          const n = doc.nodes.find((x) => x.id === sp.nodeId)!
          const st = API_STYLE_META[sp.style]
          const open = (cur.nodeId && doc.apis[cur.nodeId] ? cur.nodeId : specs[0]?.nodeId) === sp.nodeId
          return (
            <div key={sp.nodeId} className={s.svc}>
              <button className={clsx(s.svcHead, open && s.on)} onClick={() => dispatch(ui.setApi({ nodeId: sp.nodeId, opId: sp.operations[0]?.id ?? null, typeId: null }))}>
                <span className={s.svcName}>{n.name}</span>
                <span className={s.style} style={{ color: st.color }}>{st.label}</span>
                <span className={s.count}>{sp.operations.length}</span>
              </button>
              {open && (
                <div className={s.ops}>
                  {sp.operations.map((o) => {
                    const v = opView(sp.style, o)
                    return (
                      <button key={o.id} className={clsx(s.opRow, cur.opId === o.id && s.on)} onClick={() => dispatch(ui.setApi({ opId: o.id, tab: 'operations' }))}>
                        <span className={s.badge} style={{ color: v.color }}>{v.badge}</span>
                        <span className={s.opTitle}>{v.title}</span>
                      </button>
                    )
                  })}
                  <Tooltip content="Add operation"><Button size="xs" variant="ghost" icon={<Plus />} onClick={() => { const id = edit('addOperation', { nodeId: sp.nodeId, ...newOperation(sp) }); dispatch(ui.setApi({ opId: id ?? null, tab: 'operations' })) }}>Add operation</Button></Tooltip>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
