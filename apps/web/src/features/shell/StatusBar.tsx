import { useMemo } from 'react'
import { useAppDispatch, useDoc, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { projectCost } from '@tessery/core/catalog/placement'
import { useProblems } from '@/features/problems/useProblems'
import { useLiveResult } from '@/features/live/useLiveSimulation'
import { fmtMs, fmtNum, fmtUsd } from '@/lib/format'
import { API_URL } from '@/config/env'
import s from './StatusBar.module.css'

export function StatusBar() {
  const dispatch = useAppDispatch()
  const doc = useDoc()
  const env = useUi((u) => doc.environments.find((e) => e.id === u.envId))
  const selection = useUi((u) => u.selection)
  const live = useUi((u) => u.live.on)
  const sim = useLiveResult()
  const problems = useProblems()
  const cost = useMemo(() => projectCost(doc.nodes, env), [doc.nodes, env])
  const errs = problems.filter((p) => p.severity === 'error').length
  return (
    <footer className={s.bar}>
      <span><b>{doc.nodes.length}</b> nodes · <b>{doc.edges.length}</b> links</span>
      {selection.kind === 'nodes' && <span>{selection.ids.length} selected</span>}
      {live && sim && (
        <span className={s.live}>
          <i />LIVE <b>{fmtNum(sim.edge.rps)}</b> rps · p99 <b>{fmtMs(sim.edge.p99)}</b> · err <b className={sim.edge.errorRate > 2 ? s.bad : sim.edge.errorRate > 0.5 ? s.warn : ''}>{sim.edge.errorRate.toFixed(2)}%</b>
        </span>
      )}
      <span className={s.spacer} />
      <button className={s.btn} onClick={() => dispatch(ui.setDock('problems'))}>
        {problems.length ? <><span className={errs ? s.bad : s.warn}>{errs ? `✕ ${errs}` : ''}{errs && problems.length - errs ? ' · ' : ''}{problems.length - errs ? `⚠ ${problems.length - errs}` : ''}</span></> : <span className={s.ok}>✓ valid</span>}
      </button>
      {env && (env.target?.kind ?? 'git') === 'git'
        ? <span>{env.name}: <b>{fmtUsd(cost)}</b>/mo</span>
        : <span>{env?.name}: <b>{env?.target?.kind === 'kubernetes' ? 'Kubernetes' : 'Docker'}</b></span>}
      <span title={API_URL}>{API_URL}</span>
    </footer>
  )
}
