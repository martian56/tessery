import { useDeferredValue, useEffect, useMemo } from 'react'
import { Copy, Download, FileCode2, ListChecks, SquareTerminal } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useAppSelector, useDoc, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { Button, CodeView, Empty, TabStrip, Tooltip, langOf, toast } from '@/ui'
import { contextFiles } from '@/features/codegen'
import { downloadText } from '@/features/codegen/exportZip'
import { useProblems, type Problem } from '@/features/problems/useProblems'
import { bus } from '@/lib/bus'
import { Terminal } from './Terminal'
import s from './Dock.module.css'

export function Dock() {
  const dispatch = useAppDispatch()
  const tab = useUi((u) => u.dock)
  const problems = useProblems()
  const errs = problems.filter((p) => p.severity === 'error').length
  return (
    <div className={s.dock}>
      <TabStrip className={s.tabs} value={tab === 'output' ? 'code' : tab} onChange={(v) => dispatch(ui.setDock(v))}
        tabs={[{ value: 'code', label: 'Generated', icon: <FileCode2 /> }, { value: 'terminal', label: 'Terminal', icon: <SquareTerminal /> }, { value: 'problems', label: 'Problems', icon: <ListChecks />, badge: problems.length ? `${errs ? `${errs}✕ ` : ''}${problems.length - errs}⚠` : '' }]}
        right={tab === 'code' ? <FileTabs /> : undefined} />
      <div className={s.body}>
        {tab === 'terminal' ? <Terminal /> : tab === 'problems' ? <ProblemList problems={problems} /> : <CodePane />}
      </div>
    </div>
  )
}

function useFiles() {
  const doc = useDeferredValue(useDoc())
  const u = useDeferredValue(useAppSelector((st) => st.ui))
  return useMemo(() => contextFiles(doc, u), [doc, u])
}

function FileTabs() {
  const dispatch = useAppDispatch()
  const files = useFiles()
  const keys = Object.keys(files)
  const file = useUi((u) => u.file)
  const cur = file && keys.includes(file) ? file : keys[0]
  return (
    <div className={s.files}>
      {keys.map((k) => <button key={k} className={clsx(s.file, k === cur && s.on)} title={k} onClick={() => dispatch(ui.setFile(k))}>{k.split('/').slice(-2).join('/')}</button>)}
      <Tooltip content="Copy file"><Button variant="ghost" size="xs" icon={<Copy />} aria-label="Copy file" onClick={() => navigator.clipboard?.writeText(files[cur]).then(() => toast(`Copied ${cur}`), () => toast('Clipboard blocked', 'warn'))} /></Tooltip>
      <Tooltip content="Download file"><Button variant="ghost" size="xs" icon={<Download />} aria-label="Download file" onClick={() => downloadText(cur.split('/').pop()!, files[cur])} /></Tooltip>
    </div>
  )
}

function CodePane() {
  const files = useFiles()
  const keys = Object.keys(files)
  const file = useUi((u) => u.file)
  const cur = file && keys.includes(file) ? file : keys[0]
  if (!cur) return <Empty title="Nothing to generate yet" />
  return <div className={s.code}><CodeView code={files[cur]} lang={langOf(cur)} /></div>
}

function ProblemList({ problems }: { problems: Problem[] }) {
  const dispatch = useAppDispatch()
  useEffect(() => undefined, [])
  if (!problems.length) return <Empty title="No problems">Every node has a valid placement, connections and contracts.</Empty>
  const open = (p: Problem) => {
    if (p.target?.pageId) { dispatch(ui.setPages({ pageId: p.target.pageId, blockId: p.target.blockId ?? null })); dispatch(ui.setWorkspace('pages')); return }
    if (p.area === 'database' && p.nodeId) { dispatch(ui.setDatabase({ nodeId: p.nodeId, tableId: p.target?.tableId ?? null })); dispatch(ui.setWorkspace('database')); return }
    if (p.area === 'api' && p.nodeId) { dispatch(ui.setApi({ nodeId: p.nodeId, opId: p.target?.opId ?? null })); dispatch(ui.setWorkspace('api')); return }
    if (p.nodeId) { dispatch(ui.setWorkspace('design')); dispatch(ui.select({ kind: 'nodes', ids: [p.nodeId] })); setTimeout(() => bus.emit('focus-node', p.nodeId), 30) }
  }
  return (
    <div className={s.problems}>
      {problems.map((p) => (
        <button key={p.id} className={s.problem} onClick={() => open(p)}>
          <span className={clsx(s.sev, s[p.severity])}>{p.severity === 'error' ? '✕' : p.severity === 'warning' ? '⚠' : 'i'}</span>
          <span className={s.msg}>{p.message}</span>
          <span className={s.area}>{p.area}</span>
        </button>
      ))}
    </div>
  )
}
