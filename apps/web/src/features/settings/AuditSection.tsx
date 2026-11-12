import { useEffect, useState } from 'react'
import { Download, FileDown, RotateCw } from 'lucide-react'
import { useAuditLogQuery, useCreateExportMutation, useGetExportQuery, type AuditFilter } from '@/api/endpoints/orgs'
import { errorMessage, type AuditEvent, type AuditResult } from '@/api/types'
import { API_URL } from '@/config/env'
import { Badge, Button, Field, Input, Select, toast, type Tone } from '@/ui'
import { Card, PageTitle, Table, mono, muted } from '@/features/chrome/PageLayout'
import s from './Settings.module.css'

const TONE: Record<AuditResult, Tone> = { allowed: 'ok', denied: 'err', bypassed: 'warn' }
const PAGE = 50

export function AuditSection({ org }: { org: string }) {
  const [draft, setDraft] = useState({ action: '', actor: '', result: '' })
  const [filter, setFilter] = useState<AuditFilter>({})
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined])
  const [exportId, setExportId] = useState<string | null>(null)
  const [createExport, { isLoading: exporting }] = useCreateExportMutation()

  const apply = () => {
    setFilter({ action: draft.action.trim() || undefined, actor: draft.actor.trim() || undefined, result: (draft.result || undefined) as AuditResult | undefined })
    setCursors([undefined])
  }
  const startExport = async (format: 'csv' | 'json') => {
    const r = await createExport({ org, format, ...filter })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else setExportId(r.data.id)
  }

  return (
    <>
      <PageTitle title="Audit log" description="Every change and every denied attempt in this organization, newest first. Records cannot be edited or deleted."
        actions={<>
          <Button icon={<FileDown />} disabled={exporting} onClick={() => startExport('csv')}>Export CSV</Button>
          <Button icon={<FileDown />} disabled={exporting} onClick={() => startExport('json')}>Export JSON</Button>
        </>} />
      {exportId && <ExportStatus org={org} id={exportId} onDismiss={() => setExportId(null)} />}
      <div className={s.filters}>
        <Field label="Action"><Input value={draft.action} placeholder="project.save" onChange={(v) => setDraft((d) => ({ ...d, action: v }))} onKeyDown={(e) => e.key === 'Enter' && apply()} /></Field>
        <Field label="Actor email"><Input value={draft.actor} placeholder="someone@company.com" onChange={(v) => setDraft((d) => ({ ...d, actor: v }))} onKeyDown={(e) => e.key === 'Enter' && apply()} /></Field>
        <Field label="Result">
          <Select value={draft.result || 'any'} onChange={(v) => setDraft((d) => ({ ...d, result: v === 'any' ? '' : v }))} options={[{ value: 'any', label: 'Any' }, { value: 'allowed', label: 'Allowed' }, { value: 'denied', label: 'Denied' }, { value: 'bypassed', label: 'Bypassed' }]} />
        </Field>
        <Button variant="primary" onClick={apply}>Apply</Button>
      </div>
      <Table head={['Time', 'Actor', 'Action', 'Resource', 'Result', 'Details']} empty="No events match">
        {cursors.map((c, i) => <AuditPageRows key={`${i}-${c}`} org={org} filter={filter} before={c} last={i === cursors.length - 1} onMore={(n) => setCursors((cs) => [...cs, n])} />)}
      </Table>
    </>
  )
}

function AuditPageRows({ org, filter, before, last, onMore }: { org: string; filter: AuditFilter; before?: number; last: boolean; onMore: (cursor: number) => void }) {
  const { data, isFetching, refetch } = useAuditLogQuery({ org, before, limit: PAGE, ...filter })
  if (!data) return isFetching ? <tr><td colSpan={6} className={muted}>Loading…</td></tr> : null
  return (
    <>
      {data.events.map((e) => <EventRow key={e.id} e={e} />)}
      {last && (
        <tr>
          <td colSpan={6}>
            <div className={s.more}>
              {data.nextCursor ? <Button size="sm" onClick={() => onMore(data.nextCursor!)}>Load older events</Button>
                : before === undefined ? <Button size="sm" variant="ghost" icon={<RotateCw />} onClick={() => refetch()}>Refresh</Button>
                : <span className={muted}>Start of the log</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function EventRow({ e }: { e: AuditEvent }) {
  const details = Object.keys(e.details ?? {}).length ? JSON.stringify(e.details) : ''
  return (
    <tr>
      <td className={muted} style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString()}</td>
      <td>{e.actorEmail ?? <span className={muted}>system</span>}</td>
      <td className={mono}>{e.action}</td>
      <td className={mono}>{e.resourceType}{e.resourceId ? `:${e.resourceId.slice(0, 8)}` : ''}</td>
      <td><Badge tone={TONE[e.result]}>{e.result}</Badge></td>
      <td><div className={s.details} title={details}>{details}</div></td>
    </tr>
  )
}

function ExportStatus({ org, id, onDismiss }: { org: string; id: string; onDismiss: () => void }) {
  const [poll, setPoll] = useState(1000)
  const { data } = useGetExportQuery({ org, id }, { pollingInterval: poll })
  const finished = data?.status === 'done' || data?.status === 'failed'
  useEffect(() => { if (finished) setPoll(0) }, [finished])
  return (
    <Card title="Export" actions={<Button variant="ghost" size="xs" onClick={onDismiss}>Dismiss</Button>}>
      {!data || data.status === 'queued' || data.status === 'running' ? <p className={muted}>Preparing the {data?.format.toUpperCase() ?? ''} export…</p>
        : data.status === 'failed' ? <p>The export failed: {data.error}</p>
        : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{data.rowCount ?? 0} events exported as {data.format.toUpperCase()}.</span>
            <Button variant="primary" size="sm" icon={<Download />} onClick={() => { window.location.href = `${API_URL}/orgs/${org}/audit/exports/${id}/download` }}>Download</Button>
          </div>
        )}
    </Card>
  )
}
