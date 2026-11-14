import { Circle, Code2, Frame, ImageIcon, LayoutTemplate, Monitor, MousePointer2, PenTool, Pencil, RectangleHorizontal, Smartphone, Square, Tablet, Type, Video } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppDispatch, useDoc, useUi } from '@/store'
import { ui, type ElementState, type PageTool } from '@/store/uiSlice'
import { Badge, Empty, Segmented, Select, Spacer, Toolbar, Tooltip } from '@/ui'
import { Canvas } from './canvas/Canvas'
import { STATE_LABEL, TOOL_LABEL } from './canvas/tools'
import { useCurrentPage } from './usePage'
import s from './Pages.module.css'

const TOOLS: { id: PageTool; icon: ReactNode }[] = [
  { id: 'select', icon: <MousePointer2 /> },
  { id: 'frame', icon: <Frame /> },
  { id: 'text', icon: <Type /> },
  { id: 'button', icon: <RectangleHorizontal /> },
  { id: 'image', icon: <ImageIcon /> },
  { id: 'video', icon: <Video /> },
  { id: 'rect', icon: <Square /> },
  { id: 'ellipse', icon: <Circle /> },
  { id: 'pen', icon: <PenTool /> },
  { id: 'pencil', icon: <Pencil /> },
  { id: 'embed', icon: <Code2 /> },
]

export function PageBuilder() {
  const dispatch = useAppDispatch()
  const doc = useDoc()
  const { page, device } = useCurrentPage()
  const { tool, state } = useUi((u) => u.pages)
  if (!page) {
    const hasApp = doc.nodes.some((n) => n.techId === 'web-app')
    return <Empty icon={<LayoutTemplate />} title="No pages yet">{hasApp ? 'Create a page with New page in the left panel.' : 'Add a Web App on the Design canvas, then create pages for it from the left panel.'}</Empty>
  }
  const app = doc.nodes.find((n) => n.id === page.appNodeId)
  return (
    <div className={s.center}>
      <Toolbar>
        <div className={s.tools} role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <Tooltip key={t.id} content={TOOL_LABEL[t.id]}>
              <button className={s.tool} data-on={tool === t.id || undefined} aria-label={TOOL_LABEL[t.id]} aria-pressed={tool === t.id} onClick={() => dispatch(ui.setPages({ tool: t.id }))}>{t.icon}</button>
            </Tooltip>
          ))}
        </div>
        <Spacer />
        <b>{page.name}</b>
        <span className="muted mono" style={{ fontSize: 11 }}>{page.route}</span>
        <Badge tone={page.access === 'public' ? 'neutral' : 'warn'}>{page.access}</Badge>
        <span className="muted" style={{ fontSize: 11 }}>{app?.name}</span>
        <Spacer />
        <Select className={s.stateSelect} value={state} onChange={(v) => dispatch(ui.setPages({ state: v }))} aria-label="Style state" options={(Object.keys(STATE_LABEL) as ElementState[]).map((v) => ({ value: v, label: STATE_LABEL[v] }))} />
        <Segmented value={device} onChange={(v) => dispatch(ui.setPages({ device: v }))} options={[{ value: 'desktop', icon: <Monitor />, tooltip: 'Desktop, 1280' }, { value: 'tablet', icon: <Tablet />, tooltip: 'Tablet, 820 and below' }, { value: 'mobile', icon: <Smartphone />, tooltip: 'Mobile, 390 and below' }]} />
      </Toolbar>
      <Canvas key={page.id} page={page} />
    </div>
  )
}
