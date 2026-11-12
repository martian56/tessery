import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, KeyRound, Link2, Plus, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import type { Column, ColumnType, Index } from '@tessery/core/domain/types'
import { useAppDispatch, useDoc, useEdit } from '@/store'
import { ui } from '@/store/uiSlice'
import { Badge, Button, Checkbox, Empty, Field, Input, Section, Select, Textarea, Tooltip, toast } from '@/ui'
import { useCurrentDb } from './useDb'
import ins from '@/features/design/Inspector.module.css'
import s from './Database.module.css'

const TYPES: ColumnType[] = ['uuid', 'text', 'varchar', 'int', 'bigint', 'serial', 'numeric', 'float', 'boolean', 'timestamptz', 'date', 'jsonb', 'bytea', 'enum', 'text[]', 'vector']

export function TableInspector() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const { schema, nodeId, table: t, node } = useCurrentDb()
  const [open, setOpen] = useState<string | null>(null)
  const services = doc.nodes.filter((n) => doc.apis[n.id] && doc.edges.some((e) => e.source === n.id && e.target === nodeId))
  if (!schema || !nodeId) return <Empty title="No database" />
  if (!t) return (
    <div className={ins.wrap}>
      <div className={ins.title}><span className={ins.glyph}>db</span><div><b>{node?.name}</b><span>{schema.tables.length} tables</span></div></div>
      <Section title="Tables">{schema.tables.map((x) => <button key={x.id} className={ins.link} onClick={() => dispatch(ui.setDatabase({ tableId: x.id }))}><span>{x.name}</span><Badge mono>{x.columns.length} cols</Badge></button>)}</Section>
      <div className={ins.actions}><Button size="sm" icon={<Plus />} onClick={() => { const id = edit('addTable', { nodeId, name: `table_${schema.tables.length + 1}` }); dispatch(ui.setDatabase({ tableId: id ?? null })) }}>New table</Button></div>
    </div>
  )
  const upCol = (c: Column, patch: Partial<Column>) => edit('updateColumn', { nodeId, tableId: t.id, columnId: c.id, patch })
  const refOptions = schema.tables.flatMap((x) => x.columns.filter((c) => c.pk || c.unique).map((c) => ({ value: `${x.name}.${c.name}`, label: `${x.name}.${c.name}` })))
  const upIx = (ix: Index, patch: Partial<Index>) => edit('updateIndex', { nodeId, tableId: t.id, indexId: ix.id, patch })

  return (
    <div className={ins.wrap}>
      <div className={ins.title}><span className={ins.glyph}>tbl</span><div><b>{t.name}</b><span>{node?.name} · {t.columns.length} columns</span></div></div>
      <Section title="REST API">
        {services.length ? services.map((svc) => {
          const has = doc.apis[svc.id].operations.filter((o) => new RegExp(`^[A-Z]+ .*/${t.name}(/\\{\\w+\\})?$`).test(o.kind)).length
          return (
            <div key={svc.id} className={ins.link}>
              <span>{svc.name}</span>
              {has >= 5 ? <Badge tone="ok">{has} endpoints</Badge> : <Button size="xs" onClick={() => { const added = edit('addCrudOperations', { nodeId: svc.id, table: t.name }); toast(`${added?.length ?? 0} endpoints added to ${svc.name}; they read and write ${t.name} directly`, 'ok') }}>Add list, get, create, update, delete</Button>}
            </div>
          )
        }) : <span className="muted" style={{ fontSize: 11 }}>Connect a service to {node?.name} on the canvas to expose this table over HTTP.</span>}
      </Section>
      <Section title="Table">
        <Field label="Name"><Input mono value={t.name} onCommit={(v) => edit('updateTable', { nodeId, tableId: t.id, patch: { name: v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || t.name } })} /></Field>
        <Field label="Comment" wide><Textarea value={t.comment ?? ''} placeholder="What this table stores" onCommit={(v) => edit('updateTable', { nodeId, tableId: t.id, patch: { comment: v } })} /></Field>
      </Section>
      <Section title={`Columns · ${t.columns.length}`} actions={<Button size="xs" variant="ghost" icon={<Plus />} onClick={() => { const id = edit('addColumn', { nodeId, tableId: t.id, column: { name: 'new_column' } }); setOpen(id ?? null) }}>Add</Button>}>
        <div className={s.cols}>
          {t.columns.map((c, i) => (
            <div key={c.id} className={clsx(s.colItem, open === c.id && s.colOpen)}>
              <button className={s.colRow} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <ChevronRight size={11} className={s.colChev} />
                <span className={s.colIcon}>{c.pk ? <KeyRound size={11} /> : c.ref ? <Link2 size={11} /> : null}</span>
                <span className={s.colName}>{c.name}</span>
                <span className={s.colType}>{c.type}{c.nullable ? '?' : ''}{c.unique ? ' ·u' : ''}</span>
              </button>
              {open === c.id && (
                <div className={s.colEdit}>
                  <Field label="Name"><Input mono value={c.name} onCommit={(v) => upCol(c, { name: v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || c.name })} /></Field>
                  <Field label="Type"><Select value={c.type} onChange={(v) => upCol(c, { type: v, enumValues: v === 'enum' ? c.enumValues ?? ['a', 'b'] : undefined })} options={TYPES.map((x) => ({ value: x, label: x }))} /></Field>
                  {c.type === 'varchar' && <Field label="Length"><Input mono value={c.length ?? 255} onCommit={(v) => upCol(c, { length: parseInt(v) || 255 })} /></Field>}
                  {c.type === 'enum' && <Field label="Values" hint="comma separated"><Input mono value={(c.enumValues ?? []).join(', ')} onCommit={(v) => upCol(c, { enumValues: v.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>}
                  <Field label="Flags">
                    <div className={s.flags}>
                      <Checkbox checked={!!c.pk} onChange={(v) => upCol(c, { pk: v, nullable: v ? false : c.nullable })} label="PK" />
                      <Checkbox checked={!!c.nullable} onChange={(v) => upCol(c, { nullable: v })} label="NULL" />
                      <Checkbox checked={!!c.unique} onChange={(v) => upCol(c, { unique: v })} label="UNIQUE" />
                    </div>
                  </Field>
                  <Field label="Default"><Input mono value={c.default ?? ''} placeholder="e.g. now(), 0, 'draft'" onCommit={(v) => upCol(c, { default: v || undefined })} /></Field>
                  <Field label="References">
                    <Select value={c.ref ? `${c.ref.table}.${c.ref.column}` : ''} onChange={(v) => { if (!v) return upCol(c, { ref: undefined }); const [rt, rc] = v.split('.'); upCol(c, { ref: { table: rt, column: rc, onDelete: c.ref?.onDelete ?? 'restrict' } }) }} options={[{ value: '', label: 'None' }, ...refOptions]} />
                  </Field>
                  {c.ref && <Field label="On delete"><Select value={c.ref.onDelete} onChange={(v) => upCol(c, { ref: { ...c.ref!, onDelete: v } })} options={(['restrict', 'cascade', 'set null'] as const).map((x) => ({ value: x, label: x }))} /></Field>}
                  <div className={s.colTools}>
                    <Tooltip content="Move up"><Button size="xs" icon={<ArrowUp />} disabled={i === 0} onClick={() => edit('moveColumn', { nodeId, tableId: t.id, columnId: c.id, dir: -1 })} aria-label="Move up" /></Tooltip>
                    <Tooltip content="Move down"><Button size="xs" icon={<ArrowDown />} disabled={i === t.columns.length - 1} onClick={() => edit('moveColumn', { nodeId, tableId: t.id, columnId: c.id, dir: 1 })} aria-label="Move down" /></Tooltip>
                    {c.ref && !t.indexes.some((ix) => ix.columns[0] === c.name) && <Button size="xs" onClick={() => edit('addIndex', { nodeId, tableId: t.id, columns: [c.name] })}>Index this FK</Button>}
                    <span style={{ flex: 1 }} />
                    <Button size="xs" variant="danger" icon={<Trash2 />} onClick={() => edit('removeColumn', { nodeId, tableId: t.id, columnId: c.id })}>Remove</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
      <Section title={`Indexes · ${t.indexes.length}`} actions={<Button size="xs" variant="ghost" icon={<Plus />} onClick={() => edit('addIndex', { nodeId, tableId: t.id, columns: [t.columns.find((c) => !c.pk)?.name ?? t.columns[0].name] })}>Add</Button>}>
        {!t.indexes.length && <span className="muted">No secondary indexes.</span>}
        {t.indexes.map((ix) => (
          <div key={ix.id} className={s.ix}>
            <div className={s.ixHead}><span className="mono">{ix.name}</span><Button size="xs" variant="ghost" icon={<X />} aria-label="Remove index" onClick={() => edit('removeIndex', { nodeId, tableId: t.id, indexId: ix.id })} /></div>
            <div className={s.ixCols}>{t.columns.map((c) => <Checkbox key={c.id} checked={ix.columns.includes(c.name)} label={c.name} onChange={(v) => { const cols = v ? [...ix.columns, c.name] : ix.columns.filter((x) => x !== c.name); if (cols.length) upIx(ix, { columns: cols, name: `${t.name}_${cols.join('_')}_${ix.unique ? 'key' : 'idx'}` }) }} />)}</div>
            <div className={s.flags}>
              <Checkbox checked={ix.unique} label="unique" onChange={(v) => upIx(ix, { unique: v, name: `${t.name}_${ix.columns.join('_')}_${v ? 'key' : 'idx'}` })} />
              <div style={{ width: 110 }}><Select value={ix.method} onChange={(v) => upIx(ix, { method: v })} options={(['btree', 'hash', 'gin', 'gist', 'hnsw'] as const).map((m) => ({ value: m, label: m }))} /></div>
            </div>
          </div>
        ))}
      </Section>
      <div className={ins.actions}>
        <Button size="sm" onClick={() => dispatch(ui.setDatabase({ view: 'data' }))}>Browse rows</Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeTable', { nodeId, tableId: t.id }); dispatch(ui.setDatabase({ tableId: null })) }}>Delete table</Button>
      </div>
    </div>
  )
}
