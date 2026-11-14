import { useState } from 'react'
import { Activity, Pause, Play, Plus, Search, Server, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { useAddLiveAlertMutation, useDeleteLiveAlertMutation, useEnvLogsQuery, useEnvMetricsQuery, useEnvTraceQuery, useEnvTracesQuery, useLiveAlertsQuery, type TraceSpan } from '@/api/endpoints/runtime'
import { errorMessage } from '@/api/types'
import type { AlertRule, SloDef } from '@tessery/core/domain/types'
import { Badge, Button, Dot, Empty, Input, LineChart, Segmented, Select, Spacer, Sparkline, Switch, TabStrip, Toolbar, NumberInput, toast } from '@/ui'
import { cpuOf, health, limitOf, memoryOf, useEnvStatus } from './useObserve'
import s from './Observe.module.css'

const PALETTE = ['#5b8def', '#4fb57a', '#d6a23a', '#e06aa8', '#3fb3c4', '#a374db', '#e05a55', '#d98b4e', '#8a8a94', '#c4c46a']
const mb = (b: number | null) => (b == null ? '-' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`)

export function ObserveView() {
  const dispatch = useAppDispatch()
  const o = useUi((u) => u.observe)
  const doc = useDoc()
  const env = doc.environments.find((e) => e.id === useUi((u) => u.envId))
  const node = doc.nodes.find((n) => n.id === o.nodeId)
  return (
    <div className={s.center}>
      <TabStrip className={s.tabs} value={o.tab} onChange={(v) => dispatch(ui.setObserve({ tab: v }))}
        tabs={[{ value: 'overview', label: 'Overview' }, { value: 'metrics', label: 'Resources' }, { value: 'logs', label: 'Logs' }, { value: 'traces', label: 'Traces' }, { value: 'slos', label: `SLOs · ${doc.observability.slos.length}` }, { value: 'alerts', label: `Alerts · ${doc.observability.alerts.length}` }]}
        right={<span className="muted" style={{ fontSize: 11 }}>{env?.name ?? ''} · {node ? node.name : 'all nodes'}</span>} />
      <div className={s.body}>
        {o.tab === 'overview' ? <Overview /> : o.tab === 'metrics' ? <Resources /> : o.tab === 'logs' ? <Logs /> : o.tab === 'traces' ? <Traces /> : o.tab === 'slos' ? <Slos /> : <Alerts />}
      </div>
    </div>
  )
}

function NotRunning({ error }: { error: unknown }) {
  return <Empty icon={<Server />} title="Nothing to observe here yet">{errorMessage(error, 'This environment is not reachable.')} Release a checkpoint to this environment from the Deploy tab.</Empty>
}

function Overview() {
  const dispatch = useAppDispatch()
  const { data, error, byNode, services, samples, isFetching } = useEnvStatus()
  if (error) return <NotRunning error={error} />
  const nodes = data?.nodes ?? []
  const instances = nodes.flatMap((n) => n.instances)
  const up = instances.filter((i) => i.state === 'running' && i.healthy !== false).length
  const memory = nodes.reduce((a, n) => a + (memoryOf(n) ?? 0), 0)
  const cpu = nodes.reduce((a, n) => a + (cpuOf(n) ?? 0), 0)
  const shown = services.filter((n) => byNode.has(n.id) || byNode.has(n.name))
  return (
    <div className={s.pad}>
      <div className={s.kpis}>
        <div><small>Instances up</small><b className={up < instances.length ? s.bad : ''}>{up} / {instances.length}</b></div>
        <div><small>CPU (all containers)</small><b>{data?.target === 'kubernetes' ? 'n/a' : `${cpu.toFixed(1)}%`}</b></div>
        <div><small>Memory in use</small><b>{data?.target === 'kubernetes' ? 'n/a' : mb(memory)}</b></div>
        <div><small>Runs on</small><b>{data?.target === 'kubernetes' ? 'Kubernetes' : data ? 'Docker' : '…'}</b></div>
      </div>
      <table className={s.table}>
        <thead><tr><th>Node</th><th>Instances</th><th>State</th><th>CPU</th><th>Memory</th><th style={{ width: 160 }}>CPU, recent</th></tr></thead>
        <tbody>
          {shown.map((n) => {
            const st = byNode.get(n.id) ?? byNode.get(n.name)
            const states = [...new Set(st?.instances.map((i) => (i.healthy === false ? 'unhealthy' : i.state)))].join(', ')
            const restarts = st?.instances.reduce((a, i) => a + (i.restarts ?? 0), 0) ?? 0
            return (
              <tr key={n.id} onClick={() => dispatch(ui.setObserve({ nodeId: n.id, tab: 'logs' }))}>
                <td><Dot color={health(st)} /> {n.name}</td>
                <td className={s.mono}>{st?.instances.length ?? 0}</td>
                <td className={s.mono}>{states || '-'}{restarts > 0 && <Badge tone="warn">{restarts} restarts</Badge>}</td>
                <td className={s.mono}>{cpuOf(st) == null ? '-' : `${cpuOf(st)!.toFixed(1)}%`}</td>
                <td className={s.mono}>{mb(memoryOf(st))}{limitOf(st) ? <span className="muted"> / {mb(limitOf(st))}</span> : null}</td>
                <td><Sparkline values={samples(n.id).cpu.map((p) => p.v)} height={22} color="var(--info)" /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {data && data.nodes.length > shown.length && <div className="muted" style={{ fontSize: 11 }}>Also running: {data.nodes.filter((n) => !shown.some((x) => x.id === n.nodeId || x.name === n.name)).map((n) => n.name).join(', ')}</div>}
      <div className="muted" style={{ fontSize: 11 }}>Live from the {data?.target ?? ''} environment, refreshed every 5 seconds{isFetching ? ' (refreshing)' : ''}. Click a node for its logs.</div>
    </div>
  )
}

const RANGES = [{ value: 'live', label: 'Live' }, { value: '1h', label: '1 hour' }, { value: '1d', label: '1 day' }, { value: '1w', label: '1 week' }]

function Resources() {
  const nodeId = useUi((u) => u.observe.nodeId)
  const doc = useDoc()
  const envId = useUi((u) => u.envId)
  const [range, setRange] = useState('live')
  const { data, error, services, byNode, samples } = useEnvStatus()
  const stored = useEnvMetricsQuery({ pid: doc.id, env: envId, range }, { skip: range === 'live', pollingInterval: 30_000 })
  const picker = <div style={{ gridColumn: '1 / -1' }}><Segmented value={range} onChange={setRange} options={RANGES} /></div>
  if (range === 'live' && error) return <div className={s.charts}>{picker}<div style={{ gridColumn: '1 / -1' }}><NotRunning error={error} /></div></div>
  if (range === 'live' && data?.target === 'kubernetes') return <div className={s.charts}>{picker}<div style={{ gridColumn: '1 / -1' }}><Empty icon={<Activity />} title="Live resource use needs metrics-server">Kubernetes reports CPU and memory through metrics-server. Stored history, status and logs work without it.</Empty></div></div>
  if (range !== 'live' && stored.isError) return <div className={s.charts}>{picker}<div style={{ gridColumn: '1 / -1' }}><Empty title="History could not be loaded" action={<Button onClick={() => stored.refetch()}>Retry</Button>}>{errorMessage(stored.error)}</Empty></div></div>
  if (range !== 'live' && !stored.data) return <div className={s.charts}>{picker}<div className="muted" style={{ gridColumn: '1 / -1' }}>Loading history…</div></div>
  const shown = (nodeId ? services.filter((n) => n.id === nodeId) : services.filter((n) => byNode.has(n.id) || range !== 'live')).slice(0, 10)
  const color = (name: string) => PALETTE[Math.max(0, services.findIndex((n) => n.name === name)) % PALETTE.length]
  const live = (key: 'cpu' | 'memory') => shown.map((n) => ({ name: n.name, color: color(n.name), points: samples(n.id)[key] })).filter((x) => x.points.length)
  const names = new Set(shown.map((n) => n.name))
  const history = (stored.data?.nodes ?? []).filter((n) => !nodeId || names.has(n.name))
  const past = (key: 'cpu' | 'memory') => history.map((n) => ({
    name: n.name,
    color: color(n.name),
    points: n.points.flatMap((p) => {
      const v = key === 'cpu' ? p.cpu : p.memoryBytes == null ? null : p.memoryBytes / 1024 ** 2
      return v == null ? [] : [{ t: p.t, v }]
    }),
  })).filter((x) => x.points.length)
  const troubled = history.filter((n) => n.points.some((p) => p.ok === false)).map((n) => n.name)
  const restarts = history.map((n) => ({ name: n.name, d: Math.max(0, (n.points[n.points.length - 1]?.restarts ?? 0) - (n.points[0]?.restarts ?? 0)) })).filter((x) => x.d > 0)
  const cpu = range === 'live' ? live('cpu') : past('cpu')
  const memory = range === 'live' ? live('memory') : past('memory')
  return (
    <div className={s.charts}>
      {picker}
      <div className={s.chart}><div className={s.chartHead}>CPU</div><LineChart series={cpu} unit="%" /></div>
      <div className={s.chart}><div className={s.chartHead}>Memory</div><LineChart series={memory} unit=" MB" /></div>
      {cpu.length > 1 && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
          {cpu.map((x) => <span key={x.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 3, borderRadius: 2, background: x.color, display: 'inline-block' }} />{x.name}</span>)}
        </div>
      )}
      <div className="muted" style={{ fontSize: 11, gridColumn: '1 / -1' }}>
        {range === 'live'
          ? 'Sampled every 5 seconds while this page is open.'
          : `Stored every 30 seconds by the server, averaged per ${!stored.data ? '…' : stored.data.stepSeconds < 60 ? `${stored.data.stepSeconds} s` : `${stored.data.stepSeconds / 60} min`}.${troubled.length ? ` Not healthy at some point: ${troubled.join(', ')}.` : ''}${restarts.length ? ` Restarts: ${restarts.map((r) => `${r.name} ${r.d}`).join(', ')}.` : ''}`}
        {' '}Request rates, latency and traces need telemetry, which generated services can export over OpenTelemetry.
      </div>
    </div>
  )
}

function Logs() {
  const doc = useDoc()
  const env = useUi((u) => u.envId)
  const nodeId = useUi((u) => u.observe.nodeId)
  const [level, setLevel] = useState('info')
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  const [tail, setTail] = useState(true)
  const { data, error, isFetching } = useEnvLogsQuery({ pid: doc.id, env, node: nodeId ?? undefined, level, q: applied || undefined, limit: 400 }, { pollingInterval: tail ? 4000 : 0, skipPollingIfUnfocused: true })
  if (error) return <NotRunning error={error} />
  return (
    <div className={s.logs}>
      <Toolbar>
        <div style={{ width: 120 }}><Select value={level} onChange={setLevel} options={['debug', 'info', 'warn', 'error'].map((l) => ({ value: l, label: l === 'debug' ? 'everything' : `${l} and worse` }))} /></div>
        <div style={{ width: 280 }}><Input icon={<Search />} placeholder="Search messages (Enter)" value={q} onChange={setQ} onCommit={setApplied} /></div>
        <Button size="sm" icon={tail ? <Pause /> : <Play />} onClick={() => setTail((t) => !t)}>{tail ? 'Pause tail' : 'Live tail'}</Button>
        <Spacer />
        <span className="muted mono" style={{ fontSize: 11 }}>{data?.length ?? 0} lines{isFetching ? ' · …' : ''}</span>
      </Toolbar>
      <div className={s.logList}>
        {(data ?? []).map((l, i) => (
          <div key={i} className={clsx(s.logLine, s[l.level as 'info'])}>
            <span className={s.ts}>{new Date(l.t).toLocaleTimeString()}</span>
            <span className={s.lvl}>{l.level}</span>
            <span className={s.svcName}>{l.node}</span>
            <span className={s.msg}>{l.msg}</span>
          </div>
        ))}
        {data && !data.length && <Empty title="No log lines match" />}
      </div>
    </div>
  )
}

const ms = (us: number) => (us >= 1_000_000 ? `${(us / 1_000_000).toFixed(2)} s` : us >= 1000 ? `${(us / 1000).toFixed(us >= 100_000 ? 0 : 1)} ms` : `${us} µs`)

function Traces() {
  const doc = useDoc()
  const env = useUi((u) => u.envId)
  const nodeId = useUi((u) => u.observe.nodeId)
  const service = doc.nodes.find((n) => n.id === nodeId)?.name
  const [errors, setErrors] = useState(false)
  const [live, setLive] = useState(true)
  const [picked, setPicked] = useState<string | null>(null)
  const { data, error, isFetching } = useEnvTracesQuery({ pid: doc.id, env, service, errors, limit: 150 }, { pollingInterval: live ? 5000 : 0, skipPollingIfUnfocused: true })
  const traces = data ?? []
  const selected = picked && traces.some((t) => t.traceId === picked) ? picked : traces[0]?.traceId ?? null
  const longest = Math.max(1, ...traces.map((t) => t.durationUs))
  const colors = new Map(doc.nodes.map((n, i) => [n.name, PALETTE[i % PALETTE.length]]))
  if (error) return <NotRunning error={error} />
  if (data && !traces.length && !errors && !service) {
    return (
      <Empty icon={<Activity />} title="No traces yet">
        Services deployed by Tessery send traces here on their own. They show up once requests reach a service; checkpoints released before trace collection was added need one more release.
      </Empty>
    )
  }
  return (
    <div className={s.traces}>
      <div className={s.traceList}>
        <div className={s.traceBar}>
          <Switch checked={errors} onChange={setErrors} label="errors only" />
          <Spacer />
          <Button size="xs" variant="ghost" icon={live ? <Pause /> : <Play />} onClick={() => setLive((v) => !v)} aria-label={live ? 'Pause' : 'Follow new traces'} />
          <span className="muted mono" style={{ fontSize: 10 }}>{traces.length}{isFetching ? ' …' : ''}</span>
        </div>
        {traces.map((t) => (
          <button key={t.traceId} className={clsx(s.traceRow, selected === t.traceId && s.on)} onClick={() => setPicked(t.traceId)}>
            <div className={s.traceTop}>
              <Dot color={t.error ? 'var(--err)' : colors.get(t.rootService) ?? 'var(--ok)'} />
              <span className={s.traceName}>{t.rootName}</span>
              <span className="mono" style={{ fontSize: 11 }}>{ms(t.durationUs)}</span>
            </div>
            <div className={s.durBar}><i style={{ width: `${Math.max(2, (t.durationUs / longest) * 100)}%`, background: t.error ? 'var(--err)' : colors.get(t.rootService) ?? 'var(--acc)' }} /></div>
            <div className={s.traceMeta}>{new Date(t.startedAt).toLocaleTimeString()} · {t.services.join(' → ')} · {t.spans} span{t.spans === 1 ? '' : 's'}</div>
          </button>
        ))}
        {data && !traces.length && <Empty title="No traces match" />}
      </div>
      {selected ? <Waterfall pid={doc.id} env={env} trace={selected} colors={colors} /> : <Empty title="Pick a trace" />}
    </div>
  )
}

function ordered(spans: TraceSpan[]) {
  const ids = new Set(spans.map((x) => x.spanId))
  const kids = new Map<string | null, TraceSpan[]>()
  for (const x of spans) {
    const parent = x.parentId && ids.has(x.parentId) ? x.parentId : null
    kids.set(parent, [...(kids.get(parent) ?? []), x])
  }
  const out: { span: TraceSpan; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const x of (kids.get(parent) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt))) {
      out.push({ span: x, depth })
      walk(x.spanId, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function Waterfall({ pid, env, trace, colors }: { pid: string; env: string; trace: string; colors: Map<string, string> }) {
  const { data, error } = useEnvTraceQuery({ pid, env, trace })
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <Empty title="Trace not found">{errorMessage(error)}</Empty>
  if (!data) return <Empty title="Loading…" />
  const at = (x: TraceSpan) => Date.parse(x.startAt) * 1000 + Number((x.startAt.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6))
  const t0 = Math.min(...data.map(at))
  const total = Math.max(1, ...data.map((x) => at(x) - t0 + x.durationUs))
  const rows = ordered(data)
  const shown = data.find((x) => x.spanId === open)
  return (
    <div className={s.waterfall}>
      <div className={s.wfHead}>
        <b>{rows[0]?.span.name}</b>
        <span className="muted mono" style={{ fontSize: 11 }}>{ms(total)} · {data.length} spans · {trace.slice(0, 16)}</span>
        {data.some((x) => x.error) && <Badge tone="err">error</Badge>}
      </div>
      {rows.map(({ span: x, depth }) => {
        const left = ((at(x) - t0) / total) * 100
        const width = Math.max(0.4, (x.durationUs / total) * 100)
        return (
          <div key={x.spanId} className={s.span} onClick={() => setOpen(open === x.spanId ? null : x.spanId)} style={{ cursor: 'pointer' }}>
            <div className={s.spanLabel} style={{ paddingLeft: depth * 12 }}>
              <span className={s.spanSvc} style={{ color: colors.get(x.service) }}>{x.service}</span>
              <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
            </div>
            <div className={s.spanTrack}>
              <i style={{ left: `${left}%`, width: `${width}%`, background: x.error ? 'var(--err)' : colors.get(x.service) ?? 'var(--acc)' }} />
              <span className={s.spanDur} style={left + width > 80 ? { right: `${100 - left + 1}%` } : { left: `calc(${left + width}% + 4px)` }}>{ms(x.durationUs)}</span>
            </div>
          </div>
        )
      })}
      {shown && (
        <div className={s.card} style={{ marginTop: 12 }}>
          <div className={s.rowHead}><b>{shown.name}</b><span className="muted">{shown.service} · {['unspecified', 'internal', 'server', 'client', 'producer', 'consumer'][shown.kind] ?? 'span'}</span></div>
          <table className={s.table}>
            <tbody>
              {Object.entries(shown.attributes as Record<string, unknown>).map(([k, v]) => (
                <tr key={k} style={{ cursor: 'default' }}><td className={s.mono} style={{ color: 'var(--tx-3)', width: '40%' }}>{k}</td><td className={s.mono}>{String(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Slos() {
  const edit = useEdit()
  const doc = useDoc()
  const { services } = useEnvStatus()
  const add = () => { const n = services.find((x) => x.techId === 'service') ?? services[0]; if (n) edit('addSlo', { nodeId: n.id, name: `${n.name} availability`, metric: 'availability', target: 99.9, window: '30d' }) }
  const up = (sl: SloDef, patch: Partial<SloDef>) => edit('updateSlo', { id: sl.id, patch })
  return (
    <div className={s.pad}>
      <div className={s.rowHead}><b>Service level objectives</b><Spacer /><Button size="sm" icon={<Plus />} onClick={add}>New SLO</Button></div>
      {!doc.observability.slos.length && <Empty title="No SLOs">Define what “healthy” means: availability, latency or error-rate targets.</Empty>}
      {doc.observability.slos.map((sl) => {
        return (
          <div key={sl.id} className={s.card}>
            <div className={s.cardTop}>
              <Input value={sl.name} onCommit={(x) => up(sl, { name: x })} />
              <Badge>not measured</Badge>
              <Button size="xs" variant="ghost" icon={<Trash2 />} aria-label="Delete SLO" onClick={() => edit('removeSlo', { id: sl.id })} />
            </div>
            <div className={s.cardGrid}>
              <Select value={sl.nodeId} onChange={(x) => up(sl, { nodeId: x })} options={services.map((n) => ({ value: n.id, label: n.name }))} />
              <Select value={sl.metric} onChange={(x) => up(sl, { metric: x, target: x === 'availability' ? 99.9 : x === 'latency_p99' ? 300 : 1 })} options={[{ value: 'availability', label: 'Availability %' }, { value: 'latency_p99', label: 'p99 latency (ms)' }, { value: 'error_rate', label: 'Error rate %' }]} />
              <NumberInput value={sl.target} step={sl.metric === 'availability' ? 0.1 : 1} onCommit={(x) => up(sl, { target: x })} suffix={sl.metric === 'latency_p99' ? 'ms' : '%'} />
              <Select value={sl.window} onChange={(x) => up(sl, { window: x })} options={(['7d', '28d', '30d'] as const).map((w) => ({ value: w, label: `${w} window` }))} />
            </div>
            <div className="muted" style={{ fontSize: 11 }}>Exported as Prometheus recording and burn-rate alert rules in observability/prometheus/alerts.yml.</div>
          </div>
        )
      })}
    </div>
  )
}

function Alerts() {
  const edit = useEdit()
  const doc = useDoc()
  const { services } = useEnvStatus()
  const firing = (_: AlertRule) => false
  const up = (a: AlertRule, patch: Partial<AlertRule>) => edit('updateAlert', { id: a.id, patch })
  return (
    <div className={s.pad}>
      <LiveAlerts />
      <div className={s.rowHead}><b>Alert rules</b><span className="muted" style={{ fontSize: 11 }}>exported to prometheus/alerts.yml</span><Spacer /><Button size="sm" icon={<Plus />} onClick={() => edit('addAlert', { nodeId: services[0]?.id, name: 'High error rate', expr: 'error_rate > 2% for 5m', severity: 'critical', channel: '#oncall', enabled: true })}>New rule</Button></div>
      {!doc.observability.alerts.length && <Empty title="No alert rules" />}
      <table className={s.table}>
        <thead><tr><th>On</th><th>Name</th><th>Service</th><th>Condition</th><th>Severity</th><th>Notify</th><th>State</th><th /></tr></thead>
        <tbody>
          {doc.observability.alerts.map((a) => (
            <tr key={a.id}>
              <td><Switch checked={a.enabled} onChange={(v) => up(a, { enabled: v })} /></td>
              <td><Input value={a.name} onCommit={(v) => up(a, { name: v })} /></td>
              <td style={{ width: 150 }}><Select value={a.nodeId ?? ''} onChange={(v) => up(a, { nodeId: v })} options={services.map((n) => ({ value: n.id, label: n.name }))} /></td>
              <td><Input mono value={a.expr} onCommit={(v) => up(a, { expr: v })} /></td>
              <td style={{ width: 110 }}><Select value={a.severity} onChange={(v) => up(a, { severity: v })} options={(['info', 'warning', 'critical'] as const).map((x) => ({ value: x, label: x }))} /></td>
              <td style={{ width: 130 }}><Input mono value={a.channel} onCommit={(v) => up(a, { channel: v })} /></td>
              <td>{firing(a) ? <Badge tone="err">firing</Badge> : <Badge tone={a.enabled ? 'ok' : 'neutral'}>{a.enabled ? 'ok' : 'off'}</Badge>}</td>
              <td><Button size="xs" variant="ghost" icon={<Trash2 />} aria-label="Delete rule" onClick={() => edit('removeAlert', { id: a.id })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
const METRICS = [
  { value: 'restarts', label: 'Restarts', unit: 'times' },
  { value: 'memory', label: 'Memory above', unit: '%' },
  { value: 'cpu', label: 'CPU above', unit: '%' },
  { value: 'unhealthy', label: 'Unhealthy', unit: '' },
]

function LiveAlerts() {
  const doc = useDoc()
  const envId = useUi((u) => u.envId)
  const { services } = useEnvStatus()
  const rulesQ = useLiveAlertsQuery({ pid: doc.id, env: envId }, { pollingInterval: 30_000 })
  const rules = rulesQ.data
  const [add, { isLoading }] = useAddLiveAlertMutation()
  const [remove] = useDeleteLiveAlertMutation()
  const [removing, setRemoving] = useState<string | null>(null)
  const del = async (id: string) => {
    setRemoving(id)
    const r = await remove({ pid: doc.id, id })
    setRemoving(null)
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const [form, setForm] = useState({ node: '', metric: 'restarts', threshold: 3, minutes: 5 })
  const unit = METRICS.find((m) => m.value === form.metric)?.unit ?? ''
  const save = async () => {
    const r = await add({ pid: doc.id, env: envId, body: { ...form, threshold: form.metric === 'unhealthy' ? 0 : form.threshold } })
    toast('error' in r ? errorMessage(r.error) : 'Alert rule added', 'error' in r ? 'err' : 'ok')
  }
  return (
    <div style={{ marginBottom: 'var(--sp-6)' }}>
      <div className={s.rowHead}><b>Live alerts</b><span className="muted" style={{ fontSize: 11 }}>checked by Tessery every 30 seconds, sent through Deploy, Notifications</span></div>
      <table className={s.table}>
        <thead><tr><th>Rule</th><th>State</th><th /></tr></thead>
        <tbody>
          {rulesQ.isLoading && <tr><td colSpan={3} className="muted">Loading rules…</td></tr>}
          {rulesQ.isError && <tr><td colSpan={3} style={{ color: 'var(--err)' }}>Rules could not be loaded: {errorMessage(rulesQ.error)} <Button size="xs" variant="ghost" onClick={() => rulesQ.refetch()}>Retry</Button></td></tr>}
          {rules && !rules.length && <tr><td colSpan={3} className="muted">No live alert rules for this environment yet.</td></tr>}
          {(rules ?? []).map((r) => (
            <tr key={r.id}>
              <td>{r.summary}</td>
              <td>{r.firing.length ? <Badge tone="err">firing on {r.firing.join(', ')}</Badge> : <Badge tone="ok">ok</Badge>}</td>
              <td><Button size="xs" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${r.summary}`} disabled={removing === r.id} onClick={() => del(r.id)} /></td>
            </tr>
          ))}
          <tr>
            <td colSpan={3}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: 140 }}><Select value={form.node || '__any'} onChange={(v) => setForm({ ...form, node: v === '__any' ? '' : v })} aria-label="Node"
                  options={[{ value: '__any', label: 'Any node' }, ...services.map((n) => ({ value: n.name, label: n.name }))]} /></div>
                <div style={{ width: 140 }}><Select value={form.metric} onChange={(v) => setForm({ ...form, metric: v, threshold: v === 'restarts' ? 3 : 90 })} aria-label="Condition" options={METRICS.map(({ value, label }) => ({ value, label }))} /></div>
                {form.metric !== 'unhealthy' && <><div style={{ width: 70 }}><NumberInput value={form.threshold} min={form.metric === 'restarts' ? 1 : 1} max={form.metric === 'cpu' ? 6400 : form.metric === 'memory' ? 99 : 1000} onCommit={(v) => setForm({ ...form, threshold: v })} /></div><span className="muted">{unit}</span></>}
                <span className="muted">{form.metric === 'restarts' ? 'within' : 'for'}</span>
                <div style={{ width: 70 }}><NumberInput value={form.minutes} min={1} max={1440} onCommit={(v) => setForm({ ...form, minutes: v })} /></div>
                <span className="muted">min</span>
                <Button size="sm" icon={<Plus />} disabled={isLoading} onClick={save}>Add</Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
