import { Plus } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { usePipelineQuery } from '@/api/endpoints/delivery'
import { PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { projectCost } from '@tessery/core/catalog/placement'
import { Button, Dot, PanelHeader, useDialogs } from '@/ui'
import { fmtUsd, timeAgo } from '@/lib/format'
import { useDockerHostLabel } from './useDockerHostLabel'
import s from './Deploy.module.css'

export function DeploySidebar() {
  const hostLabel = useDockerHostLabel()
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const envId = useUi((u) => u.envId)
  const dialogs = useDialogs()
  const { data: pipeline } = usePipelineQuery(doc.id, { pollingInterval: 10_000 })
  const add = async () => {
    const v = await dialogs.prompt({ title: 'New environment', body: 'It deploys to Docker until you pick another target in the inspector.', fields: [{ name: 'name', label: 'Name', value: 'Preview' }], ok: 'Create' })
    if (!v?.name.trim()) return
    const last = doc.environments[doc.environments.length - 1]
    const id = edit('addEnv', { name: v.name.trim(), provider: last?.defaultProvider ?? 'self', region: last?.defaultRegion ?? 'onprem' })
    if (id) dispatch(ui.setEnv(id))
  }
  return (
    <div className={s.side}>
      <PanelHeader title="Environments" meta={doc.environments.length} actions={<Button size="xs" variant="ghost" icon={<Plus />} onClick={add} aria-label="New environment" />} />
      <div className={s.scroll}>
        {doc.environments.map((e) => {
          const stage = pipeline?.stages.find((x) => x.key === e.id)
          const color = stage?.active ? 'var(--info)' : stage?.pending ? 'var(--warn)' : stage?.head ? 'var(--ok)' : 'var(--tx-3)'
          const kind = e.target?.kind ?? 'git'
          return (
            <button key={e.id} className={clsx(s.env, envId === e.id && s.on)} onClick={() => dispatch(ui.setEnv(e.id))}>
              <div className={s.envTop}><Dot color={color} pulse={!!stage?.pending || !!stage?.active} /><b>{e.name}</b>{kind === 'git' && <span className={s.cost}>{fmtUsd(projectCost(doc.nodes, e))}</span>}</div>
              <div className={s.envMeta}>
                {kind === 'git'
                  ? <><span style={{ color: PROVIDER_BY_ID[e.defaultProvider]?.color }}>{PROVIDER_BY_ID[e.defaultProvider]?.name}</span> · {e.defaultRegion} · your CI deploys</>
                  : <>{e.target?.kind === 'docker' ? `Docker on ${hostLabel(e.target)}` : 'Kubernetes'}{e.approval ? ' · approval' : ''}</>}
              </div>
              <div className={s.envMeta}>
                {stage?.head ? `#${stage.head.seq} ${stage.head.name}${stage.releasedAt ? ` · ${timeAgo(new Date(stage.releasedAt).getTime())}` : ''}` : 'nothing released'}
                {stage?.pending ? ` · #${stage.pending.checkpointSeq} awaiting approval` : ''}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
