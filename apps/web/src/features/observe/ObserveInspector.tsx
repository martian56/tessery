import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { Badge, Button, Field, NumberInput, Section, Select, Sparkline } from '@/ui'
import { cpuOf, memoryOf, useEnvStatus } from './useObserve'
import ins from '@/features/design/Inspector.module.css'

export function ObserveInspector() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const nodeId = useUi((u) => u.observe.nodeId)
  const { byNode, samples } = useEnvStatus()
  const n = doc.nodes.find((x) => x.id === nodeId)
  const m = n ? byNode.get(n.id) ?? byNode.get(n.name) : undefined
  const cpu = cpuOf(m), mem = memoryOf(m)
  const o = doc.observability
  return (
    <div className={ins.wrap}>
      {n ? <>
        <div className={ins.title}><span className={ins.glyph}>{TECH_BY_ID[n.techId].glyph}</span><div><b>{n.name}</b><span>{TECH_BY_ID[n.techId].name}</span></div></div>
        <Section title="Now">
          {m ? <>
            <div className={ins.kpis}>
              <div><small>instances</small><b>{m.instances.filter((i) => i.state === 'running').length} / {m.instances.length}</b></div>
              <div><small>cpu</small><b>{cpu == null ? '-' : `${cpu.toFixed(1)}%`}</b></div>
              <div><small>memory</small><b>{mem == null ? '-' : `${Math.round(mem / 1048576)} MB`}</b></div>
            </div>
            {m.instances.map((i) => <div key={i.id} className={ins.link}><span className="mono">{i.id}</span><Badge tone={i.state === 'running' && i.healthy !== false ? 'ok' : 'err'}>{i.healthy === false ? 'unhealthy' : i.state}</Badge></div>)}
            {samples(n.id).cpu.length > 1 && <Sparkline values={samples(n.id).cpu.map((p) => p.v)} color="var(--warn)" />}
          </> : <span className="muted">Not running in this environment.</span>}
          <div style={{ display: 'flex', gap: 4 }}>
            <Button size="xs" onClick={() => dispatch(ui.setObserve({ tab: 'logs' }))}>Logs</Button>
            <Button size="xs" onClick={() => { dispatch(ui.setWorkspace('design')); dispatch(ui.select({ kind: 'nodes', ids: [n.id] })) }}>Show in design</Button>
          </div>
        </Section>
        <Section title="Objectives">
          {o.slos.filter((x) => x.nodeId === n.id).map((x) => <div key={x.id} className={ins.link}><span>{x.name}</span><Badge mono>{x.target}{x.metric === 'latency_p99' ? 'ms' : '%'}</Badge></div>)}
          {o.alerts.filter((x) => x.nodeId === n.id).map((x) => <div key={x.id} className={ins.link}><span>{x.name}</span><Badge tone={x.severity === 'critical' ? 'err' : 'warn'}>{x.severity}</Badge></div>)}
          {!o.slos.some((x) => x.nodeId === n.id) && !o.alerts.some((x) => x.nodeId === n.id) && <span className="muted">No SLOs or alerts for this service.</span>}
        </Section>
      </> : <div className={ins.title}><span className={ins.glyph}>obs</span><div><b>Observability</b><span>live status and logs of the selected environment</span></div></div>}
      <Section title="Telemetry pipeline">
        <Field label="Metrics"><Select value={o.metrics} onChange={(v) => edit('updateObservability', { patch: { metrics: v } })} options={['Prometheus', 'VictoriaMetrics', 'Mimir', 'CloudWatch', 'Cloud Monitoring', 'Azure Monitor', 'Datadog'].map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Logs"><Select value={o.logs} onChange={(v) => edit('updateObservability', { patch: { logs: v } })} options={['Loki', 'OpenSearch', 'ClickHouse', 'CloudWatch Logs', 'Cloud Logging', 'Datadog'].map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Traces" hint="For your own collector. Docker and Kubernetes environments also send traces to Tessery, shown in the Traces tab."><Select value={o.traces} onChange={(v) => edit('updateObservability', { patch: { traces: v } })} options={['Tempo', 'Jaeger', 'X-Ray', 'Cloud Trace', 'Honeycomb', 'Datadog'].map((x) => ({ value: x, label: x }))} /></Field>
        <Field label="Sampling" hint="Fraction of traces kept"><NumberInput value={o.sampling} min={0} max={1} step={0.01} onCommit={(v) => edit('updateObservability', { patch: { sampling: v } })} /></Field>
      </Section>
    </div>
  )
}
