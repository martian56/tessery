import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type EdgeChange, type NodeChange, type IsValidConnection,
} from '@xyflow/react'
import { Boxes, Maximize, Minus, Plus, Tags } from 'lucide-react'
import { useAppDispatch, useAppSelector, useDoc, useEdit, useUi } from '@/store'
import { projectActions } from '@/store/projectSlice'
import { ui } from '@/store/uiSlice'
import { PORT_COLORS, TECH_BY_ID, portsCompatible, CATEGORY_META } from '@tessery/core/catalog/technologies'
import { inputType } from '@tessery/core/domain/ops/graph'
import { pauseLive, useLiveResult } from '@/features/live/useLiveSimulation'
import { ContextMenu, Button, Segmented, Tooltip, Empty, type MenuEntry, toast } from '@/ui'
import { bus } from '@/lib/bus'
import { clipboard } from '@/lib/clipboard'
import { NodeView, type CanvasNode } from './NodeView'
import { EdgeView, type CanvasEdge } from './EdgeView'
import { useCommands } from '@/features/shell/commands'
import s from './DesignCanvas.module.css'

const nodeTypes = { tessery: NodeView }
const edgeTypes = { tessery: EdgeView }
const MAX_ANIMATED_EDGES = 50
const QUICK_ADD = ['service', 'worker', 'function', 'postgres', 'redis', 'kafka', 'object-storage', 'api-gateway']

function Canvas() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const rf = useReactFlow()
  const env = useUi((u) => doc.environments.find((e) => e.id === u.envId))
  const selection = useUi((u) => u.selection)
  const layer = useUi((u) => u.layer)
  const showProviders = useUi((u) => u.showProviders)
  const liveNow = useLiveResult()
  const wrap = useRef<HTMLDivElement>(null)
  const [labels, setLabels] = useState(true)
  const [ctx, setCtx] = useState<{ kind: 'pane' | 'node' | 'edge'; id?: string; at: { x: number; y: number } }>({ kind: 'pane', at: { x: 0, y: 0 } })
  const commands = useCommands()
  const cmd = (id: string) => commands.find((c) => c.id === id)!
  const revision = useAppSelector((st) => st.project.revision)
  const readOnly = useAppSelector((st) => st.project.readOnly)

  const selected = useMemo(() => new Set(selection.kind === 'nodes' ? selection.ids : []), [selection])
  const visible = useCallback((techId: string) => {
    const c = TECH_BY_ID[techId].category
    return layer === 'all' || (layer === 'data' ? ['data', 'cache', 'messaging', 'storage'].includes(c) : !['data', 'cache', 'messaging', 'storage'].includes(c))
  }, [layer])

  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }> | null>(null)
  const held = useRef(liveNow)
  if (!dragging) held.current = liveNow
  const live = held.current
  const isDragging = !!dragging
  useEffect(() => { pauseLive(isDragging); return () => pauseLive(false) }, [isDragging])
  const animate = !!live && doc.edges.length <= MAX_ANIMATED_EDGES
  const base: CanvasNode[] = useMemo(() => doc.nodes.map((n) => ({
    id: n.id, type: 'tessery', position: { x: n.x, y: n.y }, selected: selected.has(n.id), measured: sizes[n.id], initialWidth: 200, initialHeight: 80,
    data: { node: n, env, live: live?.nodes[n.id], dim: !visible(n.techId), showProvider: showProviders && (env?.target?.kind ?? 'git') === 'git' },
  })), [doc.nodes, selected, env, live, visible, showProviders, sizes])
  const nodes = useMemo(() => (dragging ? base.map((n) => (dragging[n.id] ? { ...n, position: dragging[n.id], dragging: true } : n)) : base), [base, dragging])

  const byId = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes])
  const edges: CanvasEdge[] = useMemo(() => doc.edges.map((e) => {
    const tgt = byId.get(e.target), src = byId.get(e.source)
    const type = tgt ? inputType(tgt, e.targetPort) : 'http'
    const tl = live?.nodes[e.target]
    return {
      id: e.id, type: 'tessery', source: e.source, target: e.target, sourceHandle: e.sourcePort, targetHandle: e.targetPort,
      selected: selection.kind === 'edge' && selection.id === e.id,
      data: { edge: e, color: PORT_COLORS[type], flow: live ? live.edges[e.id] : undefined, broken: !!tl && (tl.down || tl.errorRate > 5) && !e.async, animate, dim: !!(src && tgt) && (!visible(src.techId) || !visible(tgt.techId)), showLabel: labels },
    }
  }), [doc.edges, byId, live, animate, selection, visible, labels])

  useEffect(() => bus.on('frame', () => rf.fitView({ maxZoom: 1, padding: 0.12, duration: 300 })), [rf])
  useEffect(() => bus.on('focus-node', (id) => { const n = byId.get(id as string); if (n) rf.setCenter(n.x + 100, n.y + 70, { zoom: Math.max(rf.getZoom(), 0.9), duration: 300 }) }), [rf, byId])
  useEffect(() => bus.on('add-at-center', (techId) => {
    const r = wrap.current!.getBoundingClientRect()
    const p = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    const id = edit('addNode', { techId: techId as string, x: p.x - 100, y: p.y - 50 })
    dispatch(ui.select({ kind: 'nodes', ids: [id] }))
  }), [rf, edit, dispatch])
  useEffect(() => { const t = setTimeout(() => rf.fitView({ maxZoom: 1, padding: 0.12 }), 60); return () => clearTimeout(t) }, [rf, doc.id])

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const moves = changes.flatMap((c) => (c.type === 'position' && c.position ? [{ id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) }] : []))
    if (moves.length) setDragging((prev) => { const next = { ...prev }; moves.forEach((m) => { next[m.id] = { x: m.x, y: m.y } }); return next })
    const dims = changes.filter((c) => c.type === 'dimensions' && c.dimensions)
    if (dims.length) setSizes((prev) => { const next = { ...prev }; dims.forEach((c) => { if (c.type === 'dimensions' && c.dimensions) next[c.id] = c.dimensions }); return next })
    const sel = changes.filter((c) => c.type === 'select')
    if (sel.length) {
      const next = new Set(selected)
      sel.forEach((c) => (c.type === 'select' && c.selected ? next.add(c.id) : next.delete(c.id)))
      if (next.size) dispatch(ui.select({ kind: 'nodes', ids: [...next] }))
      else if (selection.kind === 'nodes') dispatch(ui.select({ kind: 'none' }))
    }
  }, [dispatch, selected, selection.kind])
  const onEdgesChange = useCallback((changes: EdgeChange<CanvasEdge>[]) => {
    const on = changes.find((c) => c.type === 'select' && c.selected)
    if (on && on.type === 'select') dispatch(ui.select({ kind: 'edge', id: on.id }))
    else if (changes.some((c) => c.type === 'select' && !c.selected) && selection.kind === 'edge') dispatch(ui.select({ kind: 'none' }))
  }, [dispatch, selection.kind])
  const isValidConnection: IsValidConnection = useCallback((c) => {
    const src = byId.get(c.source!), tgt = byId.get(c.target!)
    if (!src || !tgt || src.id === tgt.id) return false
    const out = TECH_BY_ID[src.techId].outputs.find((p) => p.id === c.sourceHandle)
    return !!out && portsCompatible(out.type, inputType(tgt, c.targetHandle ?? 'in'))
  }, [byId])
  const onConnect = useCallback((c: Connection) => {
    const id = edit('connect', { source: c.source, sourcePort: c.sourceHandle ?? undefined, target: c.target, targetPort: c.targetHandle ?? undefined })
    if (!id) toast('Already connected or incompatible ports', 'warn')
  }, [edit])

  const onDrop = (e: React.DragEvent) => {
    const techId = e.dataTransfer.getData('application/tessery-tech')
    if (!techId) return
    e.preventDefault()
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const id = edit('addNode', { techId, x: p.x - 100, y: p.y - 30 })
    dispatch(ui.select({ kind: 'nodes', ids: [id] }))
  }

  const menu = (): MenuEntry[] => {
    if (ctx.kind === 'node' && ctx.id) {
      const n = byId.get(ctx.id); if (!n) return []
      const down = live?.nodes[n.id]?.down
      return [
        ...(doc.apis[n.id] ? [{ label: 'Open API designer', onSelect: () => { dispatch(ui.setApi({ nodeId: n.id, opId: null })); dispatch(ui.setWorkspace('api')) } }] : []),
        ...(doc.databases[n.id] ? [{ label: 'Open schema designer', onSelect: () => { dispatch(ui.setDatabase({ nodeId: n.id, tableId: null })); dispatch(ui.setWorkspace('database')) } }] : []),
        { label: 'Duplicate', shortcut: 'Shift+D', onSelect: cmd('duplicate').run },
        { label: 'Copy', shortcut: 'Ctrl+C', onSelect: cmd('copy').run },
        { label: 'Select connected', onSelect: () => { const ids = new Set([n.id]); doc.edges.forEach((e) => { if (e.source === n.id) ids.add(e.target); if (e.target === n.id) ids.add(e.source) }); dispatch(ui.select({ kind: 'nodes', ids: [...ids] })) } },
        { kind: 'separator' },
        { label: down ? 'Restore (chaos)' : 'Take down (chaos)', onSelect: () => dispatch(ui.toggleDown(n.id)) },
        { kind: 'separator' },
        { label: 'Delete', shortcut: 'Del', danger: true, onSelect: cmd('delete').run },
      ]
    }
    if (ctx.kind === 'edge') return [{ label: 'Delete connection', danger: true, onSelect: () => { edit('removeEdges', { ids: [ctx.id!] }); dispatch(ui.select({ kind: 'none' })) } }]
    return [
      { kind: 'heading', label: 'Add' },
      ...QUICK_ADD.map((id) => ({ label: TECH_BY_ID[id].name, icon: <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORY_META[TECH_BY_ID[id].category].color, display: 'inline-block' }} />, onSelect: () => { const nid = edit('addNode', { techId: id, x: ctx.at.x - 100, y: ctx.at.y - 30 }); dispatch(ui.select({ kind: 'nodes', ids: [nid] })) } })),
      { kind: 'sub', label: 'More…', items: Object.entries(CATEGORY_META).map(([c, m]) => ({ kind: 'sub' as const, label: m.label, items: Object.values(TECH_BY_ID).filter((t) => t.category === c).map((t) => ({ label: t.name, onSelect: () => { const nid = edit('addNode', { techId: t.id, x: ctx.at.x - 100, y: ctx.at.y - 30 }); dispatch(ui.select({ kind: 'nodes', ids: [nid] })) } })) })) },
      { kind: 'separator' },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard.get(), onSelect: () => { const c = clipboard.get(); if (c) { const ids = edit('pasteNodes', { ...c, at: ctx.at }); dispatch(ui.select({ kind: 'nodes', ids })) } } },
      { label: 'Select all', shortcut: 'Ctrl+A', onSelect: cmd('select-all').run },
      { label: 'Auto-arrange', onSelect: cmd('layout').run },
      { label: 'Frame all', shortcut: 'Home', onSelect: cmd('frame').run },
    ]
  }

  return (
    <div className={s.wrap} ref={wrap} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/tessery-tech')) e.preventDefault() }} onDrop={onDrop} data-rev={revision} data-dragging={dragging ? '' : undefined}>
      <ContextMenu items={menu}>
        <div className={s.flow} onContextMenuCapture={(e) => {
          const el = e.target as HTMLElement
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
          const nodeEl = el.closest('.react-flow__node'), edgeEl = el.closest('.react-flow__edge')
          if (nodeEl) { const id = nodeEl.getAttribute('data-id')!; setCtx({ kind: 'node', id, at }); if (!selected.has(id)) dispatch(ui.select({ kind: 'nodes', ids: [id] })) }
          else if (edgeEl) { const id = edgeEl.getAttribute('data-id')!; setCtx({ kind: 'edge', id, at }); dispatch(ui.select({ kind: 'edge', id })) }
          else setCtx({ kind: 'pane', at })
        }}>
          <ReactFlow<CanvasNode, CanvasEdge>
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
            onNodeDragStop={(_, __, dropped) => {
              const moves = dropped.map((d) => ({ id: d.id, x: Math.round(d.position.x), y: Math.round(d.position.y) })).filter((m) => { const n = byId.get(m.id); return n && (n.x !== m.x || n.y !== m.y) })
              if (moves.length) dispatch(projectActions.edited({ op: 'moveNodes', args: { moves } }))
              setDragging(null)
            }}
            nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={!readOnly}
            onNodeDoubleClick={(_, n) => { const id = n.id; if (doc.apis[id]) { dispatch(ui.setApi({ nodeId: id, opId: null })); dispatch(ui.setWorkspace('api')) } else if (doc.databases[id]) { dispatch(ui.setDatabase({ nodeId: id, tableId: null })); dispatch(ui.setWorkspace('database')) } }}
            deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode="Shift" selectionOnDrag panOnDrag={[1, 2]} panActivationKeyCode="Space"
            snapToGrid snapGrid={[10, 10]} minZoom={0.05} maxZoom={2.5} onlyRenderVisibleElements={doc.nodes.length > 60}
            proOptions={{ hideAttribution: true }} defaultEdgeOptions={{ type: 'tessery' }} connectionLineStyle={{ stroke: 'var(--acc)', strokeWidth: 2 }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#2a2a30" />
            <MiniMap pannable zoomable className={s.minimap} nodeColor={(n) => CATEGORY_META[TECH_BY_ID[(n.data as CanvasNode['data']).node.techId].category].color} maskColor="#13131599" />
          </ReactFlow>
        </div>
      </ContextMenu>
      <div className={s.hudTL}>
        <Tooltip content="Zoom in"><Button size="sm" icon={<Plus />} onClick={() => rf.zoomIn({ duration: 150 })} aria-label="Zoom in" /></Tooltip>
        <Tooltip content="Zoom out"><Button size="sm" icon={<Minus />} onClick={() => rf.zoomOut({ duration: 150 })} aria-label="Zoom out" /></Tooltip>
        <Tooltip content="Frame all" shortcut="Home"><Button size="sm" icon={<Maximize />} onClick={() => rf.fitView({ maxZoom: 1, padding: 0.12, duration: 300 })} aria-label="Frame all" /></Tooltip>
      </div>
      <div className={s.hudTR}>
        <Segmented value={layer} onChange={(v) => dispatch(ui.setLayer(v))} options={[{ value: 'all', label: 'All' }, { value: 'runtime', label: 'Runtime' }, { value: 'data', label: 'Data' }]} />
        <Tooltip content="Provider badges"><Button size="sm" active={showProviders} icon={<Boxes />} onClick={() => dispatch(ui.toggleProviders())} aria-label="Provider badges" /></Tooltip>
        <Tooltip content="Connection labels"><Button size="sm" active={labels} icon={<Tags />} onClick={() => setLabels((v) => !v)} aria-label="Connection labels" /></Tooltip>
      </div>
      {!doc.nodes.length && (
        <div className={s.empty}><Empty icon={<Boxes />} title="Empty canvas">Drag a component from the left, right-click the canvas, or ask the agent: “add a graphql service in go with its own postgres”.</Empty></div>
      )}
    </div>
  )
}

export function DesignCanvas() {
  return <ReactFlowProvider><Canvas /></ReactFlowProvider>
}
