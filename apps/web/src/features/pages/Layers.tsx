import { useState } from 'react'
import { Box, ChevronDown, ChevronRight, ChevronsUpDown, Code2, Eye, EyeOff, Frame, ImageIcon, LayoutGrid, RectangleHorizontal, Repeat, Shapes, Spline, Square, TextCursorInput, Type, Video } from 'lucide-react'
import clsx from 'clsx'
import type { Page, UIElement } from '@tessery/core/domain/types'
import { find } from '@tessery/core/domain/tree'
import { BLOCK_META } from '@tessery/core/render/catalog'
import { useAppDispatch, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import s from './Layers.module.css'

const ICON: Record<string, React.ReactNode> = { frame: <Frame />, text: <Type />, image: <ImageIcon />, video: <Video />, button: <RectangleHorizontal />, shape: <Square />, path: <Spline />, embed: <Code2 />, block: <LayoutGrid />, icon: <Shapes />, input: <TextCursorInput />, select: <ChevronsUpDown /> }
export const elementLabel = (e: UIElement) => e.name ?? (e.type === 'block' ? BLOCK_META[String(e.props.block)]?.label ?? 'Block' : e.type === 'text' ? String(e.props.text ?? 'Text').slice(0, 28) : e.type[0].toUpperCase() + e.type.slice(1))

export function Layers({ page }: { page: Page }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const { selection } = useUi((u) => u.pages)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; where: 'before' | 'inside' | 'after' } | null>(null)

  const pick = (id: string, add: boolean) => {
    if (add) {
      const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]
      dispatch(ui.setPages({ blockId: next[next.length - 1] ?? null, selection: next }))
    } else dispatch(ui.setPages({ blockId: id, selection: [id] }))
  }
  const dropOn = (dragId: string, id: string, where: 'before' | 'inside' | 'after') => {
    if (dragId === id) return
    const hit = find(page.root, id)
    if (!hit) return
    try {
      if (where === 'inside' && hit.el.type === 'frame') edit('moveElement', { pageId: page.id, elementId: dragId, parentId: id, index: hit.el.children?.length ?? 0 })
      else if (hit.parent) edit('moveElement', { pageId: page.id, elementId: dragId, parentId: hit.parent.id, index: hit.index + (where === 'after' ? 1 : 0) })
    } catch { /* moving an element into itself is ignored */ }
  }

  const row = (e: UIElement, depth: number): React.ReactNode => {
    const open = !closed.has(e.id)
    const kids = e.children ?? []
    return (
      <div key={e.id}>
        <div className={clsx(s.row, selection.includes(e.id) && s.on, e.hidden && s.hidden, over?.id === e.id && s[over.where])} style={{ paddingLeft: 6 + depth * 14 }}
          draggable={e.id !== page.root.id}
          onDragStart={(ev) => { ev.dataTransfer.setData('application/tessery-layer', e.id); ev.dataTransfer.effectAllowed = 'move' }}
          onDragOver={(ev) => {
            if (!ev.dataTransfer.types.includes('application/tessery-layer')) return
            ev.preventDefault()
            const r = ev.currentTarget.getBoundingClientRect()
            const y = (ev.clientY - r.top) / r.height
            setOver({ id: e.id, where: e.type === 'frame' && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after' })
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(ev) => { ev.preventDefault(); const d = ev.dataTransfer.getData('application/tessery-layer'); if (d && over) dropOn(d, e.id, over.where); setOver(null) }}
          onClick={(ev) => pick(e.id, ev.shiftKey)}
          onDoubleClick={() => e.id !== page.root.id && setRenaming(e.id)}>
          {kids.length ? <button className={s.twist} aria-label={open ? 'Collapse' : 'Expand'} onClick={(ev) => { ev.stopPropagation(); setClosed((c) => { const n = new Set(c); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n }) }}>{open ? <ChevronDown /> : <ChevronRight />}</button> : <span className={s.twist} />}
          <span className={s.icon}>{e.type === 'frame' && e.props.source ? <Repeat /> : ICON[e.type] ?? <Box />}</span>
          {renaming === e.id
            ? <input className={s.name} autoFocus defaultValue={elementLabel(e)} onClick={(ev) => ev.stopPropagation()} onBlur={(ev) => { edit('updateElement', { pageId: page.id, elementId: e.id, patch: { name: ev.currentTarget.value.trim() } }); setRenaming(null) }} onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); if (ev.key === 'Escape') setRenaming(null) }} />
            : <span className={s.label}>{elementLabel(e)}</span>}
          {e.id !== page.root.id && (
            <button className={s.eye} aria-label={e.hidden ? `Show ${elementLabel(e)}` : `Hide ${elementLabel(e)}`} onClick={(ev) => { ev.stopPropagation(); edit('updateElement', { pageId: page.id, elementId: e.id, patch: { hidden: !e.hidden } }) }}>{e.hidden ? <EyeOff /> : <Eye />}</button>
          )}
        </div>
        {open && kids.map((c) => row(c, depth + 1))}
      </div>
    )
  }
  return <div className={s.tree} role="tree" aria-label="Layers">{row(page.root, 0)}</div>
}
