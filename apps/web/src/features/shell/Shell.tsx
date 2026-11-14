import { Suspense, useCallback, useEffect, useState } from 'react'
import { useAppDispatch, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { WORKSPACES } from './workspaces'
import { TopBar } from './TopBar'
import { StatusBar } from './StatusBar'
import { Dock } from '@/features/dock/Dock'
import { RightPanel } from './RightPanel'
import { CommandPalette } from './CommandPalette'
import { HistoryDialogs } from '@/features/delivery/HistoryDialog'
import { RepositoryDialog } from '@/features/delivery/RepositoryDialog'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useLiveSimulation } from '@/features/live/useLiveSimulation'
import { ErrorBoundary } from '@/ui'
import s from './Shell.module.css'

function Resizer({ dir, value, sign, min, max, onChange }: { dir: 'col' | 'row'; value: number; sign: 1 | -1; min: number; max: number; onChange: (v: number) => void }) {
  const down = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const start = value, origin = dir === 'col' ? e.clientX : e.clientY
    const move = (ev: PointerEvent) => {
      const pos = dir === 'col' ? ev.clientX : ev.clientY
      onChange(Math.round(Math.max(min, Math.min(max, start + sign * (pos - origin)))))
    }
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    document.body.style.cursor = dir === 'col' ? 'col-resize' : 'row-resize'
  }, [dir, value, sign, min, max, onChange])
  return <div className={dir === 'col' ? s.colResizer : s.rowResizer} onPointerDown={down} onDoubleClick={() => onChange(sign === 1 && dir === 'col' ? 248 : dir === 'col' ? 320 : 220)} role="separator" aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'} title="Drag to resize · double-click to reset" />
}

const MIN_CENTER = 360
const MIN_SIDE = 180
const MIN_DOCK = 90
const MIN_VIEW_H = 160
const CHROME_H = 34 + 24 + 4

function useViewport() {
  const read = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return vp
}

export function Shell() {
  const dispatch = useAppDispatch()
  const workspace = useUi((u) => u.workspace)
  const panels = useUi((u) => u.panels)
  const ws = WORKSPACES.find((w) => w.id === workspace)!
  useGlobalShortcuts()
  useLiveSimulation()
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('release')) dispatch(ui.setWorkspace('deploy'))
  }, [dispatch])
  const vp = useViewport()

  const avail = vp.w - (panels.left ? 4 : 0) - (panels.right ? 4 : 0) - MIN_CENTER
  let leftW = panels.left ? panels.leftW : 0
  let rightW = panels.right ? panels.rightW : 0
  if (leftW + rightW > avail) {
    const scale = Math.max(0, avail) / (leftW + rightW)
    leftW = panels.left ? Math.max(MIN_SIDE, Math.floor(leftW * scale)) : 0
    rightW = panels.right ? Math.max(MIN_SIDE, Math.floor(rightW * scale)) : 0
  }
  const bottomMax = Math.max(MIN_DOCK, vp.h - CHROME_H - MIN_VIEW_H)
  const bottomH = panels.bottom ? Math.min(panels.bottomH, bottomMax) : 0

  return (
    <div className={s.app}>
      <TopBar />
      <HistoryDialogs />
      <RepositoryDialog />
      <div className={s.main} style={{ gridTemplateColumns: `${leftW}px ${panels.left ? 4 : 0}px minmax(0,1fr) ${panels.right ? 4 : 0}px ${rightW}px` }}>
        <aside className={s.side}>{panels.left && <ErrorBoundary label="Sidebar" resetKey={workspace}><Suspense><ws.Left /></Suspense></ErrorBoundary>}</aside>
        {panels.left ? <Resizer dir="col" value={leftW} sign={1} min={MIN_SIDE} max={Math.max(MIN_SIDE, Math.min(480, avail - rightW))} onChange={(v) => dispatch(ui.resizePanel({ key: 'leftW', value: v }))} /> : <div />}
        <div className={s.center} style={{ gridTemplateRows: `minmax(0,1fr) ${panels.bottom ? 4 : 0}px ${bottomH}px` }}>
          <section className={s.view}><ErrorBoundary label={ws.label} resetKey={workspace}><ws.Center /></ErrorBoundary></section>
          {panels.bottom ? <Resizer dir="row" value={bottomH} sign={-1} min={MIN_DOCK} max={bottomMax} onChange={(v) => dispatch(ui.resizePanel({ key: 'bottomH', value: v }))} /> : <div />}
          <div className={s.dock}>{panels.bottom && <ErrorBoundary label="Panel"><Dock /></ErrorBoundary>}</div>
        </div>
        {panels.right ? <Resizer dir="col" value={rightW} sign={-1} min={MIN_SIDE} max={Math.max(MIN_SIDE, Math.min(620, avail - leftW))} onChange={(v) => dispatch(ui.resizePanel({ key: 'rightW', value: v }))} /> : <div />}
        <aside className={s.side}>{panels.right && <ErrorBoundary label="Inspector" resetKey={workspace}><RightPanel Inspector={ws.Right} /></ErrorBoundary>}</aside>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  )
}
