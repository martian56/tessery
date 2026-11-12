import { Plus, Table2 } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit } from '@/store'
import { ui } from '@/store/uiSlice'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { Button, Empty, PanelHeader, useDialogs } from '@/ui'
import { useCurrentDb } from './useDb'
import s from './Database.module.css'

export function DatabaseSidebar() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const dialogs = useDialogs()
  const { ids, nodeId, table } = useCurrentDb()
  const addTable = async (dbId: string) => {
    const v = await dialogs.prompt({ title: 'New table', fields: [{ name: 'name', label: 'Table name', value: 'new_table' }], ok: 'Create' })
    if (!v?.name.trim()) return
    const id = edit('addTable', { nodeId: dbId, name: v.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') })
    dispatch(ui.setDatabase({ nodeId: dbId, tableId: id ?? null }))
  }
  return (
    <div className={s.side}>
      <PanelHeader title="Databases" meta={ids.length} />
      <div className={s.scroll}>
        {!ids.length && <Empty title="No SQL databases">Add PostgreSQL, MySQL, ClickHouse, TimescaleDB, CockroachDB… on the Design canvas.</Empty>}
        {ids.map((id) => {
          const n = doc.nodes.find((x) => x.id === id)!
          const sc = doc.databases[id]
          return (
            <div key={id} className={s.db}>
              <button className={clsx(s.dbHead, nodeId === id && s.on)} onClick={() => dispatch(ui.setDatabase({ nodeId: id, tableId: null }))}>
                <span className={s.glyph}>{TECH_BY_ID[n.techId].glyph}</span>
                <span className={s.dbName}>{n.name}</span>
                <span className={s.count}>{sc.tables.length}</span>
              </button>
              {nodeId === id && (
                <div className={s.tables}>
                  {sc.tables.map((t) => (
                    <button key={t.id} className={clsx(s.tRow, table?.id === t.id && s.on)} onClick={() => dispatch(ui.setDatabase({ tableId: t.id }))}>
                      <Table2 size={12} /><span>{t.name}</span><span className={s.count}>{t.columns.length}</span>
                    </button>
                  ))}
                  <Button size="xs" variant="ghost" icon={<Plus />} onClick={() => addTable(id)}>New table</Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
