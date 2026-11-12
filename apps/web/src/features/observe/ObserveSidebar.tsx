import clsx from 'clsx'
import { useAppDispatch, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { CATEGORY_META, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { Dot, PanelHeader } from '@/ui'
import { cpuOf, health, useEnvStatus } from './useObserve'
import s from './Observe.module.css'

export function ObserveSidebar() {
  const dispatch = useAppDispatch()
  const cur = useUi((u) => u.observe.nodeId)
  const { services, byNode } = useEnvStatus()
  return (
    <div className={s.side}>
      <PanelHeader title="Nodes" meta={services.length} />
      <div className={s.scroll}>
        <button className={clsx(s.svc, !cur && s.on)} onClick={() => dispatch(ui.setObserve({ nodeId: null }))}><Dot color="var(--acc)" /><span>All nodes</span></button>
        {services.map((n) => {
          const m = byNode.get(n.id) ?? byNode.get(n.name)
          const cpu = cpuOf(m)
          return (
            <button key={n.id} className={clsx(s.svc, cur === n.id && s.on)} onClick={() => dispatch(ui.setObserve({ nodeId: n.id }))}>
              <Dot color={health(m)} />
              <span>{n.name}</span>
              <span className={s.cat} style={{ color: CATEGORY_META[TECH_BY_ID[n.techId].category].color }}>{TECH_BY_ID[n.techId].glyph}</span>
              <span className={s.rps}>{cpu == null ? '' : `${cpu.toFixed(0)}%`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
