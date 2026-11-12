import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Background, BackgroundVariant, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps } from '@xyflow/react'
import { KeyRound, Link2 } from 'lucide-react'
import clsx from 'clsx'
import type { DbSchema, Table } from '@tessery/core/domain/types'
import { useAppDispatch, useEdit, useUi } from '@/store'
import { projectActions } from '@/store/projectSlice'
import { ui } from '@/store/uiSlice'
import { ContextMenu, type MenuEntry } from '@/ui'
import s from './Database.module.css'

type TableNode = Node<{ table: Table }, 'table'>

const TableView = memo(function TableView({ data, selected }: NodeProps<TableNode>) {
  const t = data.table
  return (
    <div className={clsx(s.tnode, selected && s.tsel)}>
      <div className={s.thead}>{t.name}<span>{t.columns.length}</span></div>
      {t.columns.map((c) => (
        <div key={c.id} className={s.tcol}>
          <Handle id={`in-${c.name}`} type="target" position={Position.Left} className={s.thandle} />
          <span className={s.ticon}>{c.pk ? <KeyRound size={10} /> : c.ref ? <Link2 size={10} /> : null}</span>
          <span className={clsx(s.tname, c.pk && s.pk)}>{c.name}</span>
          <span className={s.ttype}>{c.type === 'enum' ? 'enum' : c.type}{c.nullable ? '?' : ''}</span>
          <Handle id={`out-${c.name}`} type="source" position={Position.Right} className={s.thandle} />
        </div>
      ))}
    </div>
  )
})
const nodeTypes = { table: TableView }

function Erd({ schema }: { schema: DbSchema }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const rf = useReactFlow()
  const tableId = useUi((u) => u.database.tableId)
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  const [ctxAt, setCtxAt] = useState({ x: 40, y: 40 })
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }> | null>(null)
  const base: TableNode[] = useMemo(() => schema.tables.map((t) => ({ id: t.id, type: 'table', position: { x: t.x, y: t.y }, data: { table: t }, selected: t.id === tableId, measured: sizes[t.id] })), [schema, tableId, sizes])
  const nodes = useMemo(() => (dragging ? base.map((n) => (dragging[n.id] ? { ...n, position: dragging[n.id], dragging: true } : n)) : base), [base, dragging])
  const edges: Edge[] = useMemo(() => schema.tables.flatMap((t) => t.columns.filter((c) => c.ref).map((c) => {
    const target = schema.tables.find((x) => x.name === c.ref!.table)
    if (!target) return null
    return { id: `${t.id}-${c.id}`, source: t.id, sourceHandle: `out-${c.name}`, target: target.id, targetHandle: `in-${c.ref!.column}`, type: 'smoothstep', animated: false, style: { stroke: c.ref!.onDelete === 'cascade' ? 'var(--warn)' : 'var(--c-data)', strokeWidth: 1.5 }, label: c.ref!.onDelete === 'cascade' ? 'cascade' : undefined, labelStyle: { fill: 'var(--tx-3)', fontSize: 9 }, labelBgStyle: { fill: 'var(--bg-0)' } } as Edge
  }).filter((e): e is Edge => !!e)), [schema])

  useEffect(() => { const t = setTimeout(() => rf.fitView({ maxZoom: 1, padding: 0.15 }), 50); return () => clearTimeout(t) }, [rf, schema.nodeId])

  const onNodesChange = useCallback((changes: NodeChange<TableNode>[]) => {
    const moves = changes.flatMap((c) => (c.type === 'position' && c.position ? [{ id: c.id, x: Math.round(c.position.x), y: Math.round(c.position.y) }] : []))
    if (moves.length) setDragging((prev) => { const next = { ...prev }; moves.forEach((m) => { next[m.id] = { x: m.x, y: m.y } }); return next })
    const dims = changes.filter((c) => c.type === 'dimensions' && c.dimensions)
    if (dims.length) setSizes((p) => { const n = { ...p }; dims.forEach((c) => { if (c.type === 'dimensions' && c.dimensions) n[c.id] = c.dimensions }); return n })
    const sel = changes.find((c) => c.type === 'select' && c.selected)
    if (sel && sel.type === 'select') dispatch(ui.setDatabase({ tableId: sel.id }))
  }, [dispatch, schema.nodeId])

  const menu = (): MenuEntry[] => [
    { label: 'New table here', onSelect: () => { const id = edit('addTable', { nodeId: schema.nodeId, name: `table_${schema.tables.length + 1}`, x: ctxAt.x, y: ctxAt.y }); dispatch(ui.setDatabase({ tableId: id ?? null })) } },
    ...(tableId ? [{ kind: 'separator' as const }, { label: 'Delete selected table', danger: true, onSelect: () => { edit('removeTable', { nodeId: schema.nodeId, tableId }); dispatch(ui.setDatabase({ tableId: null })) } }] : []),
    { kind: 'separator' }, { label: 'Frame all', onSelect: () => rf.fitView({ maxZoom: 1, padding: 0.15, duration: 250 }) },
  ]

  return (
    <ContextMenu items={menu}>
      <div className={s.erd} onContextMenuCapture={(e) => setCtxAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange}
          onNodeDragStop={(_, __, dropped) => {
            const moves = dropped.map((d) => ({ id: d.id, x: Math.round(d.position.x), y: Math.round(d.position.y) }))
            if (moves.length) dispatch(projectActions.edited({ op: 'moveTables', args: { nodeId: schema.nodeId, moves } }))
            setDragging(null)
          }} onPaneClick={() => dispatch(ui.setDatabase({ tableId: null }))}
          proOptions={{ hideAttribution: true }} nodesConnectable={false} deleteKeyCode={null} panOnDrag={[1, 2]} selectionOnDrag minZoom={0.2} snapToGrid snapGrid={[10, 10]}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#2a2a30" />
        </ReactFlow>
      </div>
    </ContextMenu>
  )
}

export function ErdCanvas({ schema }: { schema: DbSchema }) {
  return <ReactFlowProvider><Erd schema={schema} /></ReactFlowProvider>
}
