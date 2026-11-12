import { Dialog as D } from 'radix-ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useAppDispatch, useDoc, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { Kbd } from '@/ui'
import { TECHNOLOGIES } from '@tessery/core/catalog/technologies'
import { useCommands } from './commands'
import { bus } from '@/lib/bus'
import s from './CommandPalette.module.css'

interface Item { id: string; label: string; group: string; shortcut?: string; run: () => void }

export function CommandPalette() {
  const dispatch = useAppDispatch()
  const open = useUi((u) => u.commandOpen)
  const doc = useDoc()
  const commands = useCommands()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = () => dispatch(ui.setCommandOpen(false))

  const items = useMemo<Item[]>(() => [
    ...commands.filter((c) => !c.enabled || c.enabled()),
    ...doc.nodes.map((n) => ({ id: `node-${n.id}`, group: 'Nodes', label: n.name, run: () => { dispatch(ui.setWorkspace('design')); dispatch(ui.select({ kind: 'nodes', ids: [n.id] })); setTimeout(() => bus.emit('focus-node', n.id), 30) } })),
    ...TECHNOLOGIES.map((t) => ({ id: `add-${t.id}`, group: 'Add', label: `Add ${t.name}`, run: () => { dispatch(ui.setWorkspace('design')); setTimeout(() => bus.emit('add-at-center', t.id), 30) } })),
    ...doc.pages.map((p) => ({ id: `page-${p.id}`, group: 'Pages', label: `${p.name} ${p.route}`, run: () => { dispatch(ui.setWorkspace('pages')); dispatch(ui.setPages({ pageId: p.id, blockId: null })) } })),
    ...Object.values(doc.databases).flatMap((d) => d.tables.map((t) => ({ id: `table-${t.id}`, group: 'Tables', label: `${doc.nodes.find((n) => n.id === d.nodeId)?.name}.${t.name}`, run: () => { dispatch(ui.setWorkspace('database')); dispatch(ui.setDatabase({ nodeId: d.nodeId, tableId: t.id })) } }))),
  ], [commands, doc, dispatch])

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter((it) => words.every((w) => `${it.label} ${it.group}`.toLowerCase().includes(w))).slice(0, 80)
  }, [items, q])
  useEffect(() => { setI(0) }, [q, open])
  useEffect(() => { if (!open) setQ('') }, [open])
  useEffect(() => { list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }) }, [i])

  const run = (it?: Item) => { if (!it) return; close(); setTimeout(it.run, 0) }
  return (
    <D.Root open={open} onOpenChange={(o) => dispatch(ui.setCommandOpen(o))}>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content className={s.box} aria-describedby={undefined} onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(filtered.length - 1, x + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
          if (e.key === 'Enter') { e.preventDefault(); run(filtered[i]) }
        }}>
          <D.Title className={s.sr}>Command palette</D.Title>
          <div className={s.search}><Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search commands, nodes, technologies, pages, tables…" spellCheck={false} /></div>
          <div className={s.list} ref={list}>
            {filtered.map((it, idx) => (
              <div key={it.id} className={s.item} data-active={idx === i || undefined} onMouseMove={() => setI(idx)} onClick={() => run(it)}>
                <span className={s.label}>{it.label}</span>
                <span className={s.group}>{it.group}</span>
                {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
              </div>
            ))}
            {!filtered.length && <div className={s.none}>No matches</div>}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
