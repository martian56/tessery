import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { CATEGORY_META, TECHNOLOGIES, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import type { Category } from '@tessery/core/domain/types'
import { Input, PanelHeader, Tooltip } from '@/ui'
import { useLiveResult } from '@/features/live/useLiveSimulation'
import { bus } from '@/lib/bus'
import s from './DesignSidebar.module.css'

export function DesignSidebar() {
  return (
    <div className={s.wrap}>
      <Palette />
      <Outliner />
    </div>
  )
}

const collapsed = new Set<string>()

function Palette() {
  const [q, setQ] = useState('')
  const [, force] = useState(0)
  const groups = useMemo(() => {
    const needle = q.toLowerCase()
    const g = new Map<Category, typeof TECHNOLOGIES>()
    TECHNOLOGIES.filter((t) => !needle || `${t.name} ${t.description} ${t.category} ${t.id} ${t.config.map((c) => c.options?.join(' ')).join(' ')}`.toLowerCase().includes(needle))
      .forEach((t) => { if (!g.has(t.category)) g.set(t.category, []); g.get(t.category)!.push(t) })
    return [...g.entries()].sort((a, b) => CATEGORY_META[a[0]].order - CATEGORY_META[b[0]].order)
  }, [q])
  return (
    <div className={s.palette}>
      <PanelHeader title="Add" meta={`${TECHNOLOGIES.length} technologies`} />
      <div className={s.search}><Input icon={<Search />} placeholder="Search: kafka, graphql, vector…" value={q} onChange={setQ} onKeyDown={(e) => { if (e.key === 'Enter' && groups[0]) bus.emit('add-at-center', groups[0][1][0].id) }} /></div>
      <div className={s.scroll}>
        {groups.map(([cat, items]) => {
          const closed = !q && collapsed.has(cat)
          return (
            <div key={cat} className={s.cat}>
              <button className={s.catHead} onClick={() => { collapsed.has(cat) ? collapsed.delete(cat) : collapsed.add(cat); force((x) => x + 1) }}>
                <ChevronDown className={clsx(s.chev, closed && s.closed)} />
                <span className={s.sw} style={{ background: CATEGORY_META[cat].color }} />
                {CATEGORY_META[cat].label}<span className={s.count}>{items.length}</span>
              </button>
              {!closed && items.map((t) => (
                <Tooltip key={t.id} side="right" content={<span style={{ maxWidth: 220 }}>{t.description}{t.saas ? ' · SaaS' : ''}{t.image && t.image !== 'build' ? ' · self-hostable' : ''}</span>}>
                  <div className={s.item} draggable onDragStart={(e) => { e.dataTransfer.setData('application/tessery-tech', t.id); e.dataTransfer.effectAllowed = 'copy' }} onDoubleClick={() => bus.emit('add-at-center', t.id)}>
                    <span className={s.glyph} style={{ color: CATEGORY_META[cat].color }}>{t.glyph}</span>
                    <span className={s.label}>{t.name}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Outliner() {
  const dispatch = useAppDispatch()
  const doc = useDoc()
  const selection = useUi((u) => u.selection)
  const live = useLiveResult()
  const sel = new Set(selection.kind === 'nodes' ? selection.ids : [])
  const grouped = useMemo(() => {
    const g = new Map<Category, typeof doc.nodes>()
    doc.nodes.forEach((n) => { const c = TECH_BY_ID[n.techId].category; if (!g.has(c)) g.set(c, []); g.get(c)!.push(n) })
    return [...g.entries()].sort((a, b) => CATEGORY_META[a[0]].order - CATEGORY_META[b[0]].order)
  }, [doc.nodes])
  return (
    <div className={s.outliner}>
      <PanelHeader title="Outliner" meta={doc.nodes.length} />
      <div className={s.scroll}>
        {grouped.map(([cat, nodes]) => (
          <div key={cat}>
            <div className={s.group}>{CATEGORY_META[cat].label}</div>
            {nodes.map((n) => {
              const l = live?.nodes[n.id]
              const h = l ? (l.down || l.errorRate > 5 ? 'var(--err)' : l.errorRate > 2 || l.util > 0.85 ? 'var(--warn)' : null) : null
              return (
                <button key={n.id} className={clsx(s.row, sel.has(n.id) && s.sel)} onClick={(e) => {
                  dispatch(ui.select({ kind: 'nodes', ids: e.shiftKey ? [...sel, n.id] : [n.id] }))
                  bus.emit('focus-node', n.id)
                }}>
                  <span className={s.sw} style={{ background: CATEGORY_META[cat].color }} />
                  <span className={s.label}>{n.name}</span>
                  {h && <span className={s.hdot} style={{ background: h }} />}
                  <span className={s.prov} style={{ color: PROVIDER_BY_ID[n.placement.providerId]?.color }}>{PROVIDER_BY_ID[n.placement.providerId]?.name.split(' ')[0]}</span>
                </button>
              )
            })}
          </div>
        ))}
        {!doc.nodes.length && <div className={s.none}>No nodes yet</div>}
      </div>
    </div>
  )
}
