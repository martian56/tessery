import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Database, Play, RefreshCw, Search } from 'lucide-react'
import { useAppDispatch, useAppSelector, useDoc, useUi } from '@/store'
import { usePermissions } from '@/app/usePermissions'
import { ui } from '@/store/uiSlice'
import { useDbRowsQuery, useDbSqlMutation, type SqlResult } from '@/api/endpoints/runtime'
import { errorMessage } from '@/api/types'
import { Badge, Button, CodeView, DataGrid, Empty, Input, Segmented, Select, Spacer, Toolbar } from '@/ui'
import { migrationSql } from '@tessery/core/codegen/backend'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { ErdCanvas } from './ErdCanvas'
import { useCurrentDb } from './useDb'
import s from './Database.module.css'

export function DatabaseView() {
  const dispatch = useAppDispatch()
  const { schema, node, view } = useCurrentDb()
  if (!schema || !node) return <Empty icon={<Database />} title="No relational databases">Add PostgreSQL, MySQL, ClickHouse, TimescaleDB or CockroachDB on the Design canvas to design its schema here.</Empty>
  return (
    <div className={s.center}>
      <Toolbar>
        <b>{node.name}</b>
        <Badge>{TECH_BY_ID[node.techId].name} {String(node.config.version ?? '')}</Badge>
        <span className="muted" style={{ fontSize: 11 }}>{schema.tables.length} tables · {schema.tables.reduce((a, t) => a + t.columns.length, 0)} columns · {schema.tables.reduce((a, t) => a + t.indexes.length, 0)} indexes</span>
        <Spacer />
        <Segmented value={view} onChange={(v) => dispatch(ui.setDatabase({ view: v }))} options={[{ value: 'diagram', label: 'Diagram' }, { value: 'data', label: 'Data' }, { value: 'sql', label: 'SQL' }, { value: 'migrations', label: 'Migrations' }]} />
      </Toolbar>
      <div className={s.body}>
        {view === 'diagram' ? <ErdCanvas schema={schema} /> : view === 'data' ? <DataBrowser /> : view === 'sql' ? <SqlConsole /> : <div className={s.scrollFill}><CodeView code={migrationSql(schema, node.techId)} lang="sql" /></div>}
      </div>
    </div>
  )
}

function DataBrowser() {
  const dispatch = useAppDispatch()
  const doc = useDoc()
  const { schema, nodeId, table } = useCurrentDb()
  const t = table ?? schema!.tables[0]
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<string | undefined>()
  const [filter, setFilter] = useState('')
  const [applied, setApplied] = useState('')
  useEffect(() => { setPage(0); setSort(undefined); setFilter(''); setApplied('') }, [t?.id])
  const pageSize = 50
  const envId = useUi((u) => u.envId)
  const env = doc.environments.find((e) => e.id === envId)
  const serverSort = sort ? sort.replace(/:asc$/, '').replace(/:desc$/, ' desc') : undefined
  const { data, isFetching, refetch, error } = useDbRowsQuery({ pid: doc.id, env: envId, node: nodeId!, table: t?.name ?? '', page, pageSize, sort: serverSort, filter: applied || undefined }, { skip: !t })
  if (!t) return <Empty title="No tables">Create a table in the Diagram view.</Empty>
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1
  return (
    <div className={s.data}>
      <div className={s.dataBar}>
        <div style={{ width: 200 }}><Select value={t.id} onChange={(id) => dispatch(ui.setDatabase({ tableId: id }))} options={schema!.tables.map((x) => ({ value: x.id, label: x.name }))} /></div>
        <div style={{ width: 260 }}><Input icon={<Search />} placeholder="Filter rows (Enter)" value={filter} onChange={setFilter} onCommit={(v) => { setApplied(v); setPage(0) }} /></div>
        <Button size="sm" icon={<RefreshCw />} onClick={() => refetch()} aria-label="Refresh">{isFetching ? 'Loading…' : 'Refresh'}</Button>
        <Badge>{env?.name ?? envId}</Badge>
        <Spacer />
        <span className="muted mono" style={{ fontSize: 11 }}>{data ? `${(page * pageSize + 1).toLocaleString()}-${Math.min(data.total, (page + 1) * pageSize).toLocaleString()} of ${data.total.toLocaleString()}` : ''}</span>
        <Button size="sm" icon={<ChevronLeft />} disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" />
        <Button size="sm" icon={<ChevronRight />} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="Next page" />
      </div>
      <div className={s.grid}>
        {error ? <Empty title={`No data from ${env?.name ?? envId}`}>{errorMessage(error)}</Empty> : data && <DataGrid columns={data.columns} rows={data.rows as Record<string, unknown>[]} rowOffset={page * pageSize} sort={sort} types={Object.fromEntries(t.columns.map((c) => [c.name, c.type]))}
          onSort={(c) => setSort((cur) => (cur === `${c}:asc` ? `${c}:desc` : `${c}:asc`))} />}
      </div>
    </div>
  )
}

function SqlConsole() {
  const doc = useDoc()
  const { schema, nodeId } = useCurrentDb()
  const first = schema!.tables[0]
  const [sql, setSql] = useState(first ? `SELECT * FROM ${first.name} ORDER BY ${first.columns[0]?.name ?? 'id'} DESC LIMIT 20;` : 'SELECT 1;')
  const envId = useUi((u) => u.envId)
  const env = doc.environments.find((e) => e.id === envId)
  const [run, { isLoading }] = useDbSqlMutation()
  const orgId = useAppSelector((st) => st.project.orgId)
  const perms = usePermissions({ org: orgId ?? undefined, project: doc.id, env: envId })
  const allowed = perms.isLoading || perms.can('data:write')
  const [res, setRes] = useState<SqlResult | { error: string } | null>(null)
  const exec = async () => {
    const r = await run({ pid: doc.id, env: envId, node: nodeId!, sql })
    if ('data' in r && r.data) setRes(r.data)
    else setRes({ error: errorMessage(r.error, 'Query failed') })
  }
  return (
    <div className={s.sql}>
      <div className={s.sqlEditor}>
        <textarea value={sql} spellCheck={false} onChange={(e) => setSql(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (allowed && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); exec() } }} />
        <div className={s.sqlBar}>
          <span className="muted" style={{ fontSize: 11 }}>{allowed ? `Runs against ${env?.name ?? envId}` : 'The SQL console needs the data:write permission. Use the Data tab to read rows.'} · Ctrl+Enter · tables: {schema!.tables.map((t) => t.name).join(', ')}</span>
          <Spacer />
          <Button size="sm" variant="primary" icon={<Play />} disabled={isLoading || !allowed} onClick={exec}>{isLoading ? 'Running…' : 'Run'}</Button>
        </div>
      </div>
      <div className={s.sqlResult}>
        {!res ? <Empty title="Run a query">Results appear here.</Empty>
          : 'error' in res ? <div className={s.sqlErr}>{res.error}</div>
          : !res.columns.length ? <div className={s.sqlMsg}>{res.message} · {res.tookMs} ms</div>
          : <><div className={s.sqlMeta}>{res.message} · {res.tookMs} ms</div><DataGrid columns={res.columns} rows={res.rows as Record<string, unknown>[]} /></>}
      </div>
    </div>
  )
}
