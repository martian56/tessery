import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import type { Page, StyleMap, UIElement } from '@tessery/core/domain/types'
import { Tree, type TreeProps } from '@tessery/core/render/tree'
import * as Shared from '@tessery/core/render/blocks'
import { BLOCK_CATALOG } from '@tessery/core/render/catalog'
import BLOCK_STYLES from '@tessery/core/render/styles.txt'
import { contains, find, themeOf } from '@tessery/core/domain/tree'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui, type PageTool } from '@/store/uiSlice'
import { AssetPicker } from '@/features/assets/AssetPicker'
import { DEVICE_WIDTH, boxFrom, effective, normalizePath, penPath, px, simplify, smoothPath, type Anchor, type Box, type Breakpoint, type Pt } from './geometry'
import { BOX_TOOLS, SEEDS, TOOL_KEYS, type ElementSeed } from './tools'
import s from './Canvas.module.css'

const BLOCKS = Object.fromEntries(BLOCK_CATALOG.map((b) => [b.type, b.type === 'form' ? Shared.FormView : (Shared as unknown as Record<string, ComponentType<Record<string, unknown>>>)[b.component]])) as unknown as TreeProps['blocks']
const DEFAULTS = Object.fromEntries(BLOCK_CATALOG.map((b) => [b.type, b.defaults]))
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]

/** Applies in-progress styles (a drag or resize not yet committed) to a copy of the tree. */
function withOverrides(e: UIElement, over: Record<string, { key: Breakpoint; style: StyleMap }>): UIElement {
  const o = over[e.id]
  const next = o ? { ...e, [o.key]: { ...(e[o.key] ?? {}), ...o.style } } : e
  return e.children ? { ...next, children: e.children.map((c) => withOverrides(c, over)) } : next
}

type Drag =
  | { kind: 'move-abs'; id: string; start: Pt; left: number; top: number; moved: boolean }
  | { kind: 'move-flow'; id: string; start: Pt; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; start: Pt; box: Box; left: number; top: number; abs: boolean; ratio: number }
  | { kind: 'draw'; tool: PageTool; start: Pt }
  | { kind: 'pencil'; points: Pt[] }
  | { kind: 'pen'; anchor: Anchor }

export function Canvas({ page }: { page: Page }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const { device, tool, blockId: selected, selection, hover: hoverState } = useUi((u) => u.pages)
  const theme = themeOf(doc, page.appNodeId)
  const width = DEVICE_WIDTH[device]
  const geoKey: Breakpoint = device === 'desktop' ? 'style' : device

  const stageRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(1200)
  const scale = Math.min(1, (stageW - 64) / width)

  const [over, setOver] = useState<Record<string, { key: Breakpoint; style: StyleMap }>>({})
  const [hovered, setHovered] = useState<string | null>(null)
  const [rects, setRects] = useState<Record<string, Box>>({})
  const [drop, setDrop] = useState<{ parentId: string; index: number; line: Box } | null>(null)
  const [drawBox, setDrawBox] = useState<Box | null>(null)
  const [anchors, setAnchors] = useState<Anchor[]>([])
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [pencil, setPencil] = useState<Pt[]>([])
  const [editing, setEditing] = useState<{ id: string; box: Box; css: React.CSSProperties; text: string } | null>(null)
  const [picker, setPicker] = useState<{ tool: 'image' | 'video'; parentId: string; index?: number; style: StyleMap } | null>(null)
  const drag = useRef<Drag | null>(null)

  const tree = useMemo(() => {
    const extra: Record<string, { key: Breakpoint; style: StyleMap }> = { ...over }
    if (hoverState && selected) {
      const e = find(page.root, selected)?.el
      if (e?.hover) extra[selected] = { key: geoKey, style: { ...e.hover, ...(over[selected]?.style ?? {}) } }
    }
    return Object.keys(extra).length ? withOverrides(page.root, extra) : page.root
  }, [page.root, over, hoverState, selected, geoKey])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const toPage = useCallback((clientX: number, clientY: number): Pt => {
    const r = pageRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale }
  }, [scale])

  const boxOf = useCallback((id: string): Box | null => {
    const el = pageRef.current?.querySelector(`[data-node="${CSS.escape(id)}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const p = pageRef.current!.getBoundingClientRect()
    return { x: (r.left - p.left) / scale, y: (r.top - p.top) / scale, w: r.width / scale, h: r.height / scale }
  }, [scale])

  const measure = useCallback(() => {
    const ids = new Set([...selection, ...(hovered ? [hovered] : [])])
    const next: Record<string, Box> = {}
    ids.forEach((id) => { const b = boxOf(id); if (b) next[id] = b })
    setRects(next)
  }, [selection, hovered, boxOf])

  useLayoutEffect(() => { measure() }, [measure, tree, width, scale])
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    const t = window.setTimeout(measure, 300)
    return () => { ro.disconnect(); window.clearTimeout(t) }
  }, [measure])

  const nodeAt = (target: EventTarget | null) => (target instanceof Element ? (target.closest('[data-node]') as HTMLElement | null)?.dataset.node ?? null : null)

  const frameAt = useCallback((clientX: number, clientY: number, exclude?: string): string => {
    const stack = document.elementsFromPoint(clientX, clientY)
    for (const hit of stack) {
      if (!pageRef.current?.contains(hit)) continue
      let n = hit.closest('[data-node]') as HTMLElement | null
      while (n && pageRef.current.contains(n)) {
        const id = n.dataset.node!
        const e = find(page.root, id)?.el
        const dragged = exclude ? find(page.root, exclude)?.el : null
        if (e?.type === 'frame' && id !== exclude && !(dragged && contains(dragged, id))) return id
        n = n.parentElement?.closest('[data-node]') as HTMLElement | null
      }
    }
    return page.root.id
  }, [page.root])

  /** Where a dragged element or palette item would land in a frame's flow, and the line to show for it. */
  const flowDrop = useCallback((clientX: number, clientY: number, exclude?: string) => {
    const parentId = frameAt(clientX, clientY, exclude)
    const parent = find(page.root, parentId)!.el
    const frameEl = pageRef.current!.querySelector(`[data-node="${CSS.escape(parentId)}"]`) as HTMLElement | null
    const pb = boxOf(parentId)
    if (!frameEl || !pb) return null
    const cs = getComputedStyle(frameEl)
    const axis = cs.display.includes('grid') ? 'grid' : cs.display.includes('flex') && cs.flexDirection.startsWith('row') ? 'x' : 'y'
    const p = toPage(clientX, clientY)
    const kids = (parent.children ?? []).map((c, i) => ({ c, i, b: boxOf(c.id) })).filter((k) => k.b && k.c.id !== exclude && !k.c.hidden && getComputedStyle(pageRef.current!.querySelector(`[data-node="${CSS.escape(k.c.id)}"]`)!).position !== 'absolute') as { c: UIElement; i: number; b: Box }[]
    let index = parent.children?.length ?? 0
    let line: Box = axis === 'x' ? { x: pb.x + pb.w - 2, y: pb.y, w: 2, h: pb.h } : { x: pb.x, y: pb.y + pb.h - 2, w: pb.w, h: 2 }
    for (const k of kids) {
      const before = axis === 'x' ? p.x < k.b.x + k.b.w / 2 : axis === 'y' ? p.y < k.b.y + k.b.h / 2 : (p.y < k.b.y + k.b.h && p.x < k.b.x + k.b.w / 2) || p.y < k.b.y
      if (before) {
        index = k.i
        line = axis === 'y' ? { x: k.b.x, y: k.b.y - 2, w: k.b.w, h: 3 } : { x: k.b.x - 2, y: k.b.y, w: 3, h: k.b.h }
        break
      }
      line = axis === 'y' ? { x: k.b.x, y: k.b.y + k.b.h, w: k.b.w, h: 3 } : { x: k.b.x + k.b.w, y: k.b.y, w: 3, h: k.b.h }
    }
    return { parentId, index, line }
  }, [frameAt, page.root, boxOf, toPage])

  const select = (id: string | null, add = false) => {
    if (!id) return dispatch(ui.setPages({ blockId: null, selection: [] }))
    if (add) {
      const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]
      dispatch(ui.setPages({ blockId: next[next.length - 1] ?? null, selection: next }))
    } else dispatch(ui.setPages({ blockId: id, selection: [id] }))
  }

  const insert = (seed: ElementSeed, parentId: string, index?: number) => {
    const id = edit('addElement', { pageId: page.id, parentId, index, element: seed })
    if (id) dispatch(ui.setPages({ blockId: id, selection: [id], tool: 'select' }))
    return id
  }

  const startEdit = useCallback((id: string) => {
    const e = find(page.root, id)?.el
    const el = pageRef.current?.querySelector(`[data-node="${CSS.escape(id)}"]`) as HTMLElement | null
    const b = boxOf(id)
    if (!e || !el || !b || (e.type !== 'text' && e.type !== 'button')) return
    const cs = getComputedStyle(el)
    setEditing({
      id,
      box: b,
      text: String(e.props.text ?? ''),
      css: { font: cs.font, letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight, color: cs.color, textAlign: cs.textAlign as React.CSSProperties['textAlign'], padding: cs.padding, textTransform: cs.textTransform as React.CSSProperties['textTransform'], background: cs.backgroundColor, borderRadius: cs.borderRadius, display: cs.display === 'inline-flex' ? 'flex' : 'block', alignItems: 'center', justifyContent: cs.justifyContent },
    })
  }, [page.root, boxOf])

  const commitText = (text: string) => {
    if (editing && text !== editing.text) edit('updateElement', { pageId: page.id, elementId: editing.id, patch: { props: { text } } })
    setEditing(null)
  }

  const finishPath = (d: string, pts: Pt[], closed: boolean, startClient: { x: number; y: number }) => {
    if (pts.length < 2) return
    const strokeWidth = 3
    const { box, shift } = normalizePath(pts, strokeWidth)
    const parentId = frameAt(startClient.x, startClient.y)
    const pb = boxOf(parentId) ?? { x: 0, y: 0, w: 0, h: 0 }
    const moved = d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x: string, y: string) => { const q = shift({ x: Number(x), y: Number(y) }); return `${Math.round(q.x * 10) / 10} ${Math.round(q.y * 10) / 10}` })
    insert({
      type: 'path', name: closed ? 'Shape' : 'Stroke',
      props: { d: moved, viewBox: `0 0 ${Math.round(box.w)} ${Math.round(box.h)}` },
      style: { position: 'absolute', left: Math.round(box.x - pb.x), top: Math.round(box.y - pb.y), width: Math.round(box.w), height: Math.round(box.h), stroke: 'var(--c-text)', strokeWidth, fill: closed ? 'var(--c-primary)' : 'none' },
    }, parentId)
  }
  const penStart = useRef<{ x: number; y: number } | null>(null)
  const finishPen = (closed: boolean) => {
    if (anchors.length > 1) finishPath(penPath(anchors, closed), anchors.flatMap((a) => (a.h ? [a.p, a.h, { x: 2 * a.p.x - a.h.x, y: 2 * a.p.y - a.h.y }] : [a.p])), closed, penStart.current!)
    setAnchors([]); setCursor(null); penStart.current = null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return
    const p = toPage(e.clientX, e.clientY)
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
    if (tool === 'select' && handle && selected) {
      const el = find(page.root, selected)?.el
      const b = boxOf(selected)
      if (!el || !b) return
      const st = effective(el, device)
      drag.current = { kind: 'resize', id: selected, handle, start: p, box: b, left: px(st.left) ?? 0, top: px(st.top) ?? 0, abs: st.position === 'absolute', ratio: b.w / Math.max(b.h, 1) }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'select') {
      const id = nodeAt(e.target)
      if (!id) return select(null)
      if (e.shiftKey) return select(id, true)
      if (!selection.includes(id) || selection.length > 1) select(id)
      const el = find(page.root, id)?.el
      if (!el || id === page.root.id) return
      const st = effective(el, device)
      drag.current = st.position === 'absolute' ? { kind: 'move-abs', id, start: p, left: px(st.left) ?? 0, top: px(st.top) ?? 0, moved: false } : { kind: 'move-flow', id, start: p, moved: false }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (tool === 'pencil') { drag.current = { kind: 'pencil', points: [p] }; setPencil([p]); penStart.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); return }
    if (tool === 'pen') {
      if (!anchors.length) penStart.current = { x: e.clientX, y: e.clientY }
      if (anchors.length > 2 && Math.hypot(anchors[0].p.x - p.x, anchors[0].p.y - p.y) < 8 / scale) return finishPen(true)
      drag.current = { kind: 'pen', anchor: { p } }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (BOX_TOOLS.has(tool)) { drag.current = { kind: 'draw', tool, start: p }; penStart.current = { x: e.clientX, y: e.clientY }; setDrawBox({ ...p, w: 0, h: 0 }); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const p = toPage(e.clientX, e.clientY)
    if (!d) {
      if (tool === 'select' && !editing) setHovered(nodeAt(e.target))
      if (tool === 'pen' && anchors.length) setCursor(p)
      return
    }
    const snap = (v: number) => (e.shiftKey && d.kind !== 'resize' ? Math.round(v / 8) * 8 : Math.round(v))
    switch (d.kind) {
      case 'move-abs': {
        const dx = p.x - d.start.x, dy = p.y - d.start.y
        if (!d.moved && Math.hypot(dx, dy) < 3) return
        d.moved = true
        setOver({ [d.id]: { key: geoKey, style: { left: snap(d.left + dx), top: snap(d.top + dy) } } })
        return
      }
      case 'move-flow': {
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 5) return
        d.moved = true
        setOver({ [d.id]: { key: geoKey, style: { opacity: 0.35 } } })
        setDrop(flowDrop(e.clientX, e.clientY, d.id))
        return
      }
      case 'resize': {
        let dx = p.x - d.start.x, dy = p.y - d.start.y
        const h = d.handle
        let w = d.box.w + (h.includes('e') ? dx : h.includes('w') ? -dx : 0)
        let ht = d.box.h + (h.includes('s') ? dy : h.includes('n') ? -dy : 0)
        if (e.shiftKey && h.length === 2) { ht = w / d.ratio; dy = h.includes('n') ? d.box.h - ht : ht - d.box.h }
        w = Math.max(8, Math.round(w)); ht = Math.max(8, Math.round(ht))
        const style: StyleMap = {}
        if (h !== 'n' && h !== 's') style.width = w
        if (h !== 'e' && h !== 'w') style.height = ht
        if (d.abs && h.includes('w')) style.left = Math.round(d.left + (d.box.w - w))
        if (d.abs && h.includes('n')) style.top = Math.round(d.top + (d.box.h - ht))
        void dx
        setOver({ [d.id]: { key: geoKey, style } })
        return
      }
      case 'draw':
        setDrawBox(boxFrom(d.start, p))
        return
      case 'pencil':
        d.points.push(p)
        setPencil([...d.points])
        return
      case 'pen':
        if (Math.hypot(p.x - d.anchor.p.x, p.y - d.anchor.p.y) > 3) { d.anchor.h = p; setCursor(p) }
        return
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const p = toPage(e.clientX, e.clientY)
    switch (d.kind) {
      case 'move-abs':
      case 'resize': {
        const o = over[d.id]
        setOver({})
        if (o && (d.kind === 'resize' || d.moved)) edit('updateElement', { pageId: page.id, elementId: d.id, patch: { [geoKey]: o.style } })
        return
      }
      case 'move-flow': {
        setOver({})
        const target = drop
        setDrop(null)
        if (d.moved && target) edit('moveElement', { pageId: page.id, elementId: d.id, parentId: target.parentId, index: target.index })
        return
      }
      case 'draw': {
        const box = boxFrom(d.start, p)
        setDrawBox(null)
        const click = box.w < 6 && box.h < 6
        const parentId = frameAt(penStart.current!.x, penStart.current!.y)
        const pb = boxOf(parentId) ?? { x: 0, y: 0, w: 0, h: 0 }
        const seed = SEEDS[d.tool]!(click ? undefined : { w: Math.round(box.w), h: Math.round(box.h) })
        if (!click) seed.style = { ...seed.style, position: 'absolute', left: Math.round(box.x - pb.x), top: Math.round(box.y - pb.y) }
        if (d.tool === 'image' || d.tool === 'video') return setPicker({ tool: d.tool, parentId, style: seed.style ?? {} })
        const id = insert(seed, parentId)
        if (id && (d.tool === 'text' || d.tool === 'button')) window.setTimeout(() => startEdit(id), 60)
        return
      }
      case 'pencil': {
        const pts = simplify(d.points, 1.5)
        setPencil([])
        if (pts.length > 1) finishPath(smoothPath(pts), d.points, false, penStart.current!)
        return
      }
      case 'pen':
        setAnchors((a) => [...a, d.anchor])
        return
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"], [role="listbox"]')) return
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation() }
      const k = e.key.toLowerCase()
      if (tool === 'pen' && anchors.length && (k === 'enter' || k === 'escape')) { stop(); return k === 'enter' ? finishPen(false) : (setAnchors([]), setCursor(null)) }
      if (k === 'escape') {
        stop()
        if (tool !== 'select') return dispatch(ui.setPages({ tool: 'select' }))
        const parent = selected ? find(page.root, selected)?.parent : null
        return parent ? select(parent.id) : select(null)
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k === 'p' && e.shiftKey) { stop(); return dispatch(ui.setPages({ tool: 'pencil' })) }
        if (TOOL_KEYS[k] && !e.shiftKey) { stop(); return dispatch(ui.setPages({ tool: TOOL_KEYS[k] })) }
      }
      const ids = selection.filter((id) => id !== page.root.id)
      if (!ids.length) return
      if (k === 'delete' || k === 'backspace') {
        stop()
        ids.forEach((id) => { if (find(page.root, id)) edit('removeElement', { pageId: page.id, elementId: id }) })
        return select(null)
      }
      if ((e.ctrlKey || e.metaKey) && k === 'd') { stop(); const id = edit('duplicateElement', { pageId: page.id, elementId: ids[ids.length - 1] }); if (id) select(id); return }
      if ((e.ctrlKey || e.metaKey) && k === 'g') {
        stop()
        try { const id = edit('groupElements', { pageId: page.id, elementIds: ids }); if (id) select(id) } catch { /* elements from different frames are not grouped */ }
        return
      }
      if (k.startsWith('arrow')) {
        const id = ids[ids.length - 1]
        const el = find(page.root, id)?.el
        const st = el ? effective(el, device) : {}
        if (st.position !== 'absolute') return
        stop()
        const step = e.shiftKey ? 10 : 1
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0
        const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0
        edit('updateElement', { pageId: page.id, elementId: id, patch: { [geoKey]: { left: (px(st.left) ?? 0) + dx, top: (px(st.top) ?? 0) + dy } } }, { coalesce: `nudge:${id}` })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/tessery-block') && !e.dataTransfer.types.includes('application/tessery-element')) return
    e.preventDefault()
    setDrop(flowDrop(e.clientX, e.clientY))
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const target = drop ?? flowDrop(e.clientX, e.clientY)
    setDrop(null)
    if (!target) return
    const block = e.dataTransfer.getData('application/tessery-block')
    const element = e.dataTransfer.getData('application/tessery-element')
    if (block) insert({ type: 'block', name: BLOCK_CATALOG.find((b) => b.type === block)?.label, props: { block } }, target.parentId, target.index)
    else if (element) insert(JSON.parse(element) as ElementSeed, target.parentId, target.index)
  }

  const sel = selected ? rects[selected] : null
  const label = selected ? find(page.root, selected)?.el : null
  const hoverBox = hovered && hovered !== selected && !selection.includes(hovered) ? rects[hovered] : null
  const penPreview = anchors.length ? penPath(cursor ? [...anchors, { p: cursor }] : anchors, false) : ''

  return (
    <div ref={stageRef} className={s.stage} onPointerDown={(e) => { if (e.target === e.currentTarget && tool === 'select') select(null) }}>
      <style>{BLOCK_STYLES}</style>
      {editing && <style>{`[data-node="${CSS.escape(editing.id)}"]{visibility:hidden}`}</style>}
      <div className={s.sizer} style={{ width: width * scale }}>
        <div className={s.frame} style={{ width, transform: `scale(${scale})` }} data-tool={tool}>
          <div ref={pageRef} className={s.page}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHovered(null)}
            onDoubleClick={(e) => { if (tool === 'pen') return finishPen(false); const id = nodeAt(e.target); if (id) startEdit(id) }}
            onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a, button, summary, label')) e.preventDefault() }}
            onSubmitCapture={(e) => e.preventDefault()}
            onDragOver={onDragOver} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrop(null) }} onDrop={onDrop}>
            <Tree root={tree} theme={theme} blocks={BLOCKS} defaults={DEFAULTS} assetBase="/api/assets/" />
          </div>
          <div className={s.overlay}>
            {hoverBox && <div className={s.hover} style={{ left: hoverBox.x, top: hoverBox.y, width: hoverBox.w, height: hoverBox.h }} />}
            {selection.filter((id) => id !== selected && rects[id]).map((id) => <div key={id} className={s.sel} style={{ left: rects[id].x, top: rects[id].y, width: rects[id].w, height: rects[id].h }} />)}
            {sel && tool === 'select' && !editing && (
              <div className={s.sel} style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}>
                <span className={s.tag} style={{ transform: `scale(${1 / scale})` }}>{label?.name ?? label?.type}{hoverState ? ' · hover' : ''}</span>
                <span className={s.size} style={{ transform: `scale(${1 / scale})` }}>{Math.round(sel.w)} × {Math.round(sel.h)}</span>
                {selected !== page.root.id && HANDLES.map((h) => <span key={h} data-handle={h} className={s.handle} data-pos={h} style={{ transform: `scale(${1 / scale})` }} />)}
              </div>
            )}
            {drop && <div className={s.drop} style={{ left: drop.line.x, top: drop.line.y, width: drop.line.w, height: drop.line.h }} />}
            {drawBox && <div className={s.draw} style={{ left: drawBox.x, top: drawBox.y, width: drawBox.w, height: drawBox.h }} />}
            {(penPreview || pencil.length > 1) && (
              <svg className={s.ink}><path d={penPreview || smoothPath(pencil)} />{anchors.map((a, i) => <circle key={i} cx={a.p.x} cy={a.p.y} r={4 / scale} />)}</svg>
            )}
            {editing && (
              <div className={s.editor} style={{ left: editing.box.x, top: editing.box.y, minWidth: editing.box.w, minHeight: editing.box.h, ...editing.css }}
                contentEditable suppressContentEditableWarning
                ref={(el) => { if (el && document.activeElement !== el) { el.innerText = editing.text; el.focus(); const r = document.createRange(); r.selectNodeContents(el); const s2 = window.getSelection(); s2?.removeAllRanges(); s2?.addRange(r) } }}
                onBlur={(e) => commitText(e.currentTarget.innerText.replace(/\n$/, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { e.preventDefault(); setEditing(null) } }} />
            )}
          </div>
        </div>
      </div>
      <AssetPicker pid={doc.id} open={!!picker} accept={picker?.tool ?? 'image'} onClose={() => setPicker(null)}
        onPick={(a) => { if (picker) insert({ ...SEEDS[picker.tool]!(), style: { ...picker.style, ...(a.width && a.height && !picker.style.position ? { width: Math.min(a.width, 720), height: Math.round(Math.min(a.width, 720) * a.height / a.width) } : {}) }, props: { src: a.reference, alt: '' } }, picker.parentId, picker.index) }} />
    </div>
  )
}
