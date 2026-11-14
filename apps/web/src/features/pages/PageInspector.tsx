import { ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react'
import { useAppDispatch, useDoc, useEdit } from '@/store'
import { primaryKey, tableForOperation } from '@tessery/core/codegen/services/crud'
import { ui } from '@/store/uiSlice'
import type { ConfigValue } from '@tessery/core/domain/types'
import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { Button, Empty, Field, Input, NumberInput, Section, Select, Switch, Textarea } from '@/ui'
import { AssetPicker } from '@/features/assets/AssetPicker'
import { BLOCK_BY_TYPE } from './blocks'
import { useBindableOps, useCurrentPage } from './usePage'
import ins from '@/features/design/Inspector.module.css'

export function PageInspector() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const { page, block } = useCurrentPage()
  const ops = useBindableOps()
  const [picking, setPicking] = useState<string | null>(null)
  if (!page) return <Empty title="No page selected" />

  if (block) {
    const def = BLOCK_BY_TYPE[block.type]
    const props = { ...def?.defaults, ...block.props }
    const set = (key: string, value: ConfigValue, coalesce?: string) => edit('updateBlock', { pageId: page.id, blockId: block.id, key, value }, { coalesce })
    const idx = page.blocks.findIndex((b) => b.id === block.id)
    const title = (c: string) => c.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase())
    const fill = (k: string, binding: string) => {
      const [nodeId, opName] = binding.split(':')
      const hit = nodeId && opName ? tableForOperation(doc, nodeId, opName) : undefined
      if (!hit) return
      const key = primaryKey(hit.table)?.name
      const cols = hit.table.columns.map((c) => c.name).filter((c) => c !== key)
      if (k === 'source' && 'columns' in props && (hit.action === 'list')) set('columns', cols.map(title).join(', '))
      if (k === 'action' && 'fields' in props && (hit.action === 'create' || hit.action === 'update')) {
        const fields = hit.table.columns.filter((c) => c.name !== key && !c.default && c.name !== hit.parent?.column).map((c) => c.name)
        set('fields', fields.map(title).join(', '))
      }
    }
    const ctl = (k: string, v: ConfigValue) => {
      if (k === 'image') return <div style={{ display: 'flex', gap: 6, width: '100%' }}><Input mono value={String(v)} onCommit={(x) => set(k, x)} /><Button size="sm" icon={<ImagePlus />} aria-label="Choose an image" onClick={() => setPicking(k)} /></div>
      if (typeof v === 'boolean') return <Switch checked={v} onChange={(x) => set(k, x)} label={v ? 'on' : 'off'} />
      if (typeof v === 'number') return <NumberInput value={v} min={1} max={24} onCommit={(x) => set(k, x)} />
      if (/^#[0-9a-f]{6}$/i.test(String(v))) return <div style={{ display: 'flex', gap: 6, width: '100%' }}><span style={{ width: 24, height: 24, borderRadius: 3, background: String(v), border: '1px solid var(--line-2)', flexShrink: 0 }} /><Input mono value={String(v)} onCommit={(x) => /^#[0-9a-f]{6}$/i.test(x) && set(k, x)} /></div>
      if (['body', 'sub', 'items', 'quote'].includes(k)) return <Textarea value={String(v)} onChange={(x) => set(k, x, `${block.id}:${k}`)} />
      return <Input value={String(v)} onChange={(x) => set(k, x, `${block.id}:${k}`)} />
    }
    return (
      <div className={ins.wrap}>
        <div className={ins.title}><span className={ins.glyph}>blk</span><div><b>{def?.label ?? block.type}</b><span>{page.name} · block {idx + 1} of {page.blocks.length}</span></div></div>
        <AssetPicker pid={doc.id} open={picking !== null} onClose={() => setPicking(null)} onPick={(a) => picking && set(picking, a.reference)} />
        <Section title="Content">{Object.entries(props).filter(([k]) => k !== 'source' && k !== 'action').map(([k, v]) => <Field key={k} label={k}>{ctl(k, v)}</Field>)}</Section>
        {def?.dataKeys && (
          <Section title="Data binding">
            {def.dataKeys.map((k) => (
              <Field key={k} label={k === 'source' ? 'Reads from' : 'Submits to'}>
                <Select value={String(block.props[k] ?? '')} onChange={(v) => { set(k, v); fill(k, v) }} options={[{ value: '', label: 'Not bound' }, ...ops.map((o) => ({ value: o.key, label: o.label, group: o.style.toUpperCase() }))]} />
              </Field>
            ))}
            <div className="muted" style={{ fontSize: 11 }}>Bindings become typed calls in the generated <code>lib/api.ts</code>.</div>
          </Section>
        )}
        <div className={ins.actions}>
          <Button size="sm" icon={<ArrowUp />} disabled={idx === 0} onClick={() => edit('moveBlock', { pageId: page.id, blockId: block.id, to: idx - 1 })} aria-label="Move up" />
          <Button size="sm" icon={<ArrowDown />} disabled={idx === page.blocks.length - 1} onClick={() => edit('moveBlock', { pageId: page.id, blockId: block.id, to: idx + 1 })} aria-label="Move down" />
          <Button size="sm" icon={<Copy />} onClick={() => { const id = edit('duplicateBlock', { pageId: page.id, blockId: block.id }); dispatch(ui.setPages({ blockId: id ?? null })) }}>Duplicate</Button>
          <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeBlock', { pageId: page.id, blockId: block.id }); dispatch(ui.setPages({ blockId: null })) }}>Delete</Button>
        </div>
      </div>
    )
  }
  const up = (patch: Parameters<typeof edit<'updatePage'>>[1]['patch']) => edit('updatePage', { pageId: page.id, patch })
  return (
    <div className={ins.wrap}>
      <div className={ins.title}><span className={ins.glyph}>pg</span><div><b>{page.name}</b><span>{page.route} · {page.blocks.length} blocks</span></div></div>
      <Section title="Page">
        <Field label="Name"><Input value={page.name} onCommit={(v) => up({ name: v })} /></Field>
        <Field label="Route"><Input mono value={page.route} onCommit={(v) => up({ route: v.startsWith('/') ? v : `/${v}` })} /></Field>
        <Field label="Rendering"><Select value={page.render} onChange={(v) => up({ render: v })} options={[{ value: 'ssr', label: 'SSR, per request' }, { value: 'ssg', label: 'SSG, build time' }, { value: 'isr', label: 'ISR, revalidate 60s' }, { value: 'csr', label: 'CSR, client only' }]} /></Field>
        <Field label="Access"><Select value={page.access} onChange={(v) => up({ access: v })} options={[{ value: 'public', label: 'public' }, { value: 'user', label: 'signed-in users' }, { value: 'admin', label: 'admins' }]} /></Field>
      </Section>
      <Section title="SEO"><Field label="Title"><Input value={page.title} onCommit={(v) => up({ title: v })} /></Field></Section>
      <Section title={`Blocks · ${page.blocks.length}`}>
        {page.blocks.map((b, i) => <button key={b.id} className={ins.link} onClick={() => dispatch(ui.setPages({ blockId: b.id }))}><span>{i + 1}. {BLOCK_BY_TYPE[b.type]?.label ?? b.type}</span></button>)}
      </Section>
      <div className={ins.actions}>
        <Button size="sm" icon={<Copy />} onClick={() => { const id = edit('duplicatePage', { pageId: page.id }); dispatch(ui.setPages({ pageId: id ?? null })) }}>Duplicate page</Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removePage', { pageId: page.id }); dispatch(ui.setPages({ pageId: null, blockId: null })) }}>Delete</Button>
      </div>
    </div>
  )
}
