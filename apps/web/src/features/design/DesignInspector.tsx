import { useMemo } from 'react'
import { Database, Network, Trash2, Copy } from 'lucide-react'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { CATEGORY_META, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { API_STYLE_META, LANGUAGES, frameworksFor } from '@tessery/core/catalog/languages'
import { checkPlacement, projectCost } from '@tessery/core/catalog/placement'
import type { ApiStyle, SystemNode } from '@tessery/core/domain/types'
import { Badge, Button, Empty, Field, Input, NumberInput, Section, Select, Sparkline, Switch, Textarea, Kbd } from '@/ui'
import { useLiveResult, useNodeHistory } from '@/features/live/useLiveSimulation'
import { fmtMs, fmtNum, fmtUsd } from '@/lib/format'
import { bus } from '@/lib/bus'
import { ConfigEditor } from './ConfigEditor'
import { PlacementEditor } from './PlacementEditor'
import s from './Inspector.module.css'

export function DesignInspector() {
  const doc = useDoc()
  const selection = useUi((u) => u.selection)
  if (selection.kind === 'edge') return <EdgeInspector id={selection.id} />
  if (selection.kind === 'nodes' && selection.ids.length === 1) {
    const n = doc.nodes.find((x) => x.id === selection.ids[0])
    if (n) return <NodeInspector node={n} />
  }
  if (selection.kind === 'nodes' && selection.ids.length > 1) return <MultiInspector ids={selection.ids} />
  return <ProjectInspector />
}

function NodeInspector({ node }: { node: SystemNode }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const env = useUi((u) => doc.environments.find((e) => e.id === u.envId))
  const tech = TECH_BY_ID[node.techId]
  const spec = doc.apis[node.id]
  const style = (node.config.apiStyle as ApiStyle) ?? 'rest'
  const lang = String(node.config.language ?? 'TypeScript')
  const fws = frameworksFor(lang, style)
  const hiddenKeys = tech.id === 'service' ? new Set(['language', 'framework', 'apiStyle']) : new Set<string>()
  const calls = doc.edges.filter((e) => e.source === node.id).map((e) => ({ e, n: doc.nodes.find((x) => x.id === e.target)! })).filter((x) => x.n)
  const callers = doc.edges.filter((e) => e.target === node.id).map((e) => ({ e, n: doc.nodes.find((x) => x.id === e.source)! })).filter((x) => x.n)
  const go = (id: string) => { dispatch(ui.select({ kind: 'nodes', ids: [id] })); bus.emit('focus-node', id) }

  return (
    <div className={s.wrap}>
      <div className={s.title}>
        <span className={s.glyph} style={{ color: CATEGORY_META[tech.category].color }}>{tech.glyph}</span>
        <div><b>{node.name}</b><span>{tech.name} · {CATEGORY_META[tech.category].label}</span></div>
      </div>
      <Section title="Identity">
        <Field label="Name"><Input value={node.name} onCommit={(v) => edit('updateNode', { id: node.id, patch: { name: v } })} /></Field>
        {(tech.category === 'compute' || tech.category === 'network') && <Field label="Replicas"><NumberInput value={node.replicas} min={1} max={500} onCommit={(v) => edit('updateNode', { id: node.id, patch: { replicas: v } })} /></Field>}
        <p className={s.desc}>{tech.description}</p>
      </Section>
      {tech.id === 'service' && (
        <Section title="Interface">
          <Field label="API style"><Select value={style} onChange={(v) => edit('setConfig', { id: node.id, key: 'apiStyle', value: v })} options={(Object.keys(API_STYLE_META) as ApiStyle[]).map((k) => ({ value: k, label: API_STYLE_META[k].label }))} /></Field>
          <Field label="Language"><Select value={lang} onChange={(v) => edit('setConfig', { id: node.id, key: 'language', value: v })} options={LANGUAGES.map((l) => ({ value: l.id, label: l.name, hint: `${frameworksFor(l.id, style).length} fw` , disabled: !frameworksFor(l.id, style).length }))} /></Field>
          <Field label="Framework">
            {fws.length ? <Select value={String(node.config.framework)} onChange={(v) => edit('setConfig', { id: node.id, key: 'framework', value: v })} options={fws.map((f) => ({ value: f.name, label: f.name }))} />
              : <Input value={String(node.config.framework)} onCommit={(v) => edit('setConfig', { id: node.id, key: 'framework', value: v })} />}
          </Field>
          {spec && <Button size="sm" block icon={<Network />} onClick={() => { dispatch(ui.setApi({ nodeId: node.id, opId: null })); dispatch(ui.setWorkspace('api')) }}>Design API · {spec.operations.length} operations</Button>}
        </Section>
      )}
      {doc.databases[node.id] && (
        <Section title="Schema">
          <Button size="sm" block icon={<Database />} onClick={() => { dispatch(ui.setDatabase({ nodeId: node.id, tableId: null })); dispatch(ui.setWorkspace('database')) }}>Design schema · {doc.databases[node.id].tables.length} tables</Button>
        </Section>
      )}
      {tech.config.filter((f) => !hiddenKeys.has(f.key)).length > 0 && (
        <Section title="Configuration">
          <ConfigEditor fields={tech.config.filter((f) => !hiddenKeys.has(f.key))} values={node.config} coalesceKey={node.id} onChange={(key, value, coalesce) => edit('setConfig', { id: node.id, key, value }, { coalesce })} />
        </Section>
      )}
      <PlacementEditor node={node} env={env} />
      <LiveSection node={node} />
      <Section title={`Connections · ${calls.length + callers.length}`}>
        {calls.length > 0 && <div className={s.subhead}>calls</div>}
        {calls.map(({ e, n }) => <button key={e.id} className={s.link} onClick={() => go(n.id)}><span>{n.name}</span><Badge mono>{e.protocol}</Badge></button>)}
        {callers.length > 0 && <div className={s.subhead}>called by</div>}
        {callers.map(({ e, n }) => <button key={e.id} className={s.link} onClick={() => go(n.id)}><span>{n.name}</span><Badge mono>{e.protocol}</Badge></button>)}
        {!calls.length && !callers.length && <span className="muted">Drag from a port on the canvas to connect.</span>}
      </Section>
      <Section title="Notes" defaultOpen={!!node.notes}>
        <Textarea value={node.notes ?? ''} placeholder="Why this exists, owners, runbooks…" onCommit={(v) => edit('updateNode', { id: node.id, patch: { notes: v } })} />
      </Section>
      <div className={s.actions}>
        <Button size="sm" icon={<Copy />} onClick={() => { const ids = edit('duplicateNodes', { ids: [node.id] }); if (ids) dispatch(ui.select({ kind: 'nodes', ids })) }}>Duplicate</Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeNodes', { ids: [node.id] }); dispatch(ui.select({ kind: 'none' })) }}>Delete</Button>
      </div>
    </div>
  )
}

function LiveSection({ node }: { node: SystemNode }) {
  const dispatch = useAppDispatch()
  const live = useLiveResult()
  const hist = useNodeHistory(node.id)
  const tech = TECH_BY_ID[node.techId]
  const l = live?.nodes[node.id]
  return (
    <Section title="Live" defaultOpen>
      {!l ? <div className="muted">Press <Kbd>R</Kbd> or <b>Simulate</b> to push traffic through the design.</div> : <>
        <div className={s.kpis}>
          <div><small>throughput</small><b>{fmtNum(l.rps)}/s</b></div>
          <div><small>p99</small><b>{l.down ? '-' : fmtMs(l.latency)}</b></div>
          <div><small>errors</small><b className={l.errorRate > 5 ? s.bad : ''}>{l.errorRate.toFixed(1)}%</b></div>
        </div>
        <div className={s.subhead}>requests/s · 60s</div>
        <Sparkline values={hist.map((h) => h.rps)} color="var(--info)" />
        <div className={s.subhead}>p99 latency</div>
        <Sparkline values={hist.map((h) => h.lat)} color="var(--warn)" />
        {tech.capacity ? <div className="muted" style={{ fontSize: 11 }}>Utilisation {Math.round(l.util * 100)}% of {fmtNum(tech.capacity * node.replicas)} rps capacity ({node.replicas} × {fmtNum(tech.capacity)})</div> : null}
        <Button size="xs" onClick={() => dispatch(ui.toggleDown(node.id))}>{l.down ? 'Restore service' : 'Take down (chaos)'}</Button>
      </>}
    </Section>
  )
}

function EdgeInspector({ id }: { id: string }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const e = doc.edges.find((x) => x.id === id)
  if (!e) return <Empty title="Connection removed" />
  const a = doc.nodes.find((n) => n.id === e.source)!, b = doc.nodes.find((n) => n.id === e.target)!
  const up = (patch: Partial<typeof e>) => edit('updateEdge', { id, patch })
  return (
    <div className={s.wrap}>
      <div className={s.title}><span className={s.glyph}>→</span><div><b>{a.name} → {b.name}</b><span>{e.protocol || 'connection'}</span></div></div>
      <Section title="Connection">
        <Field label="Protocol"><Input value={e.protocol ?? ''} mono onCommit={(v) => up({ protocol: v })} /></Field>
        <Field label="Timeout"><NumberInput value={e.timeoutMs} min={50} step={100} suffix="ms" onCommit={(v) => up({ timeoutMs: v })} /></Field>
        <Field label="Retries"><NumberInput value={e.retries} min={0} max={10} onCommit={(v) => up({ retries: v })} /></Field>
        <Field label="mTLS"><Switch checked={e.mtls} onChange={(v) => up({ mtls: v })} label={e.mtls ? 'enforced' : 'off'} /></Field>
        <Field label="Async"><Switch checked={!!e.async} onChange={(v) => up({ async: v })} label={e.async ? 'fire-and-forget' : 'request/response'} /></Field>
      </Section>
      <div className={s.actions}><Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeEdges', { ids: [id] }); dispatch(ui.select({ kind: 'none' })) }}>Delete connection</Button></div>
    </div>
  )
}

function MultiInspector({ ids }: { ids: string[] }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const env = useUi((u) => doc.environments.find((e) => e.id === u.envId))
  const nodes = doc.nodes.filter((n) => ids.includes(n.id))
  return (
    <div className={s.wrap}>
      <div className={s.title}><span className={s.glyph}>{nodes.length}</span><div><b>{nodes.length} nodes selected</b><span>{fmtUsd(projectCost(nodes, env))}/mo combined</span></div></div>
      <Section title="Move all to">
        <Select value="" placeholder="Choose provider…" onChange={(pid) => nodes.forEach((n) => { const p = PROVIDER_BY_ID[pid]; edit('setPlacement', { id: n.id, placement: { providerId: pid, regionId: p.regions[0]?.id, mode: p.offers[TECH_BY_ID[n.techId].capability ?? 'vm'] ? 'managed' : 'self-hosted' } }) })}
          options={Object.values(PROVIDER_BY_ID).filter((p) => p.id !== 'saas').map((p) => ({ value: p.id, label: p.name }))} />
      </Section>
      <Section title="Nodes">{nodes.map((n) => <button key={n.id} className={s.link} onClick={() => dispatch(ui.select({ kind: 'nodes', ids: [n.id] }))}><span>{n.name}</span><Badge mono>{TECH_BY_ID[n.techId].glyph}</Badge></button>)}</Section>
      <div className={s.actions}>
        <Button size="sm" icon={<Copy />} onClick={() => { const r = edit('duplicateNodes', { ids }); if (r) dispatch(ui.select({ kind: 'nodes', ids: r })) }}>Duplicate</Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeNodes', { ids }); dispatch(ui.select({ kind: 'none' })) }}>Delete</Button>
      </div>
    </div>
  )
}

function ProjectInspector() {
  const edit = useEdit()
  const doc = useDoc()
  const env = useUi((u) => doc.environments.find((e) => e.id === u.envId))
  const byProvider = useMemo(() => {
    const m = new Map<string, { cost: number; count: number }>()
    doc.nodes.forEach((n) => { const c = checkPlacement(n, env); const pid = (env?.overrides[n.id]?.providerId) ?? n.placement.providerId; const x = m.get(pid) ?? { cost: 0, count: 0 }; x.cost += c.monthly; x.count++; m.set(pid, x) })
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost)
  }, [doc.nodes, env])
  const total = byProvider.reduce((a, [, x]) => a + x.cost, 0)
  return (
    <div className={s.wrap}>
      <div className={s.title}><span className={s.glyph}>{doc.icon}</span><div><b>{doc.name}</b><span>{doc.nodes.length} nodes · {doc.edges.length} connections</span></div></div>
      <Section title="Project">
        <Field label="Name"><Input value={doc.name} onCommit={(v) => edit('renameProject', { name: v })} /></Field>
        <Field label="Description" wide><Textarea value={doc.description} onCommit={(v) => edit('renameProject', { description: v })} /></Field>
      </Section>
      <Section title={`Cost · ${env?.name ?? ''}`} actions={<Badge tone="accent" mono>{fmtUsd(total)}/mo</Badge>}>
        {byProvider.map(([pid, x]) => (
          <div key={pid} className={s.costRow}>
            <span className={s.pdot} style={{ background: PROVIDER_BY_ID[pid]?.color }} />
            <span className={s.cName}>{PROVIDER_BY_ID[pid]?.name}</span>
            <span className="muted">{x.count} nodes</span>
            <span className={s.cPrice}>{fmtUsd(x.cost)}</span>
            <div className={s.bar}><i style={{ width: `${total ? (x.cost / total) * 100 : 0}%`, background: PROVIDER_BY_ID[pid]?.color }} /></div>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 11 }}>List-price estimates; scale factor ×{env?.scale ?? 1} applied to compute.</div>
      </Section>
      <Section title="Tips">
        <div className={s.tips}>
          <span>Drag technologies from the left onto the canvas.</span>
          <span>Every node can run on any provider: managed, self-hosted on a VPS, or as SaaS.</span>
          <span><Kbd>Ctrl K</Kbd> command palette · <Kbd>R</Kbd> simulate · <Kbd>?</Kbd> shortcuts</span>
        </div>
      </Section>
    </div>
  )
}
