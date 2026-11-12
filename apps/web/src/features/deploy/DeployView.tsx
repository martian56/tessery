import { useMemo } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { useProjectPermissions } from '@/app/useProjectPermissions'
import { useCreateReleaseMutation, useReleasesQuery } from '@/api/endpoints/delivery'
import { errorMessage, type ReleaseStatus } from '@/api/types'
import { NewCheckpointButton, PipelineBoard } from '@/features/delivery/PipelineBoard'
import { PROVIDERS, PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { CATEGORY_META, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { checkPlacement, effectivePlacement, placementOptions } from '@tessery/core/catalog/placement'
import { plan, workloads } from '@tessery/core/codegen/deploy'
import { Badge, Button, Empty, Select, Spacer, Toolbar, Tooltip, toast, type Tone } from '@/ui'
import { fmtUsd, timeAgo } from '@/lib/format'
import s from './Deploy.module.css'

const STATUS_TONE: Record<ReleaseStatus, Tone> = { pending: 'warn', queued: 'info', deploying: 'info', released: 'ok', rejected: 'err', cancelled: 'neutral', failed: 'err' }

export function DeployView() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const envId = useUi((u) => u.envId)
  const env = doc.environments.find((e) => e.id === envId) ?? doc.environments[0]
  const { data: all } = useReleasesQuery(doc.id, { pollingInterval: 10_000 })
  const [release, { isLoading: releasing }] = useCreateReleaseMutation()
  const canDeploy = useProjectPermissions().can('deployment:run')
  const history = useMemo(() => (all ?? []).filter((r) => r.env === env?.id), [all, env])
  const liveId = history.find((r) => r.status === 'released')?.id
  const liveCheckpoint = history.find((r) => r.id === liveId)?.checkpointId
  const rows = useMemo(() => env ? doc.nodes.map((n) => ({ n, pl: effectivePlacement(n, env), c: checkPlacement(n, env), overridden: !!env.overrides[n.id] })) : [], [doc.nodes, env])
  const byProvider = useMemo(() => { const m = new Map<string, number>(); rows.forEach((r) => m.set(r.pl.providerId, (m.get(r.pl.providerId) ?? 0) + r.c.monthly)); return [...m.entries()].sort((a, b) => b[1] - a[1]) }, [rows])
  const kind = env?.target?.kind ?? 'git'
  const containers = useMemo(() => (env && kind !== 'git' ? workloads(doc, env) : []), [doc, env, kind])
  const urls = useMemo(() => (env && kind !== 'git' ? new Map(plan(doc, env).endpoints.map((e) => [e.name, e.url])) : new Map<string, string>()), [doc, env, kind])
  if (!env) return <Empty title="No environments" />
  const total = byProvider.reduce((a, [, v]) => a + v, 0)
  const invalid = (env.target?.kind ?? 'git') === 'git' ? rows.filter((r) => !r.c.ok) : []

  const rollBack = async (checkpointId: string, seq: number) => {
    const r = await release({ pid: doc.id, env: env.id, checkpointId, note: `roll back to checkpoint ${seq}` })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else toast(r.data.status === 'pending' ? 'Rollback is waiting for approval' : `${env.name} rolled back to checkpoint ${seq}`, 'ok')
  }

  return (
    <div className={s.center}>
      <Toolbar>
        <b>{env.name}</b>
        <Badge>{env.strategy}</Badge>
        {env.approval && <Badge tone="warn">approval</Badge>}
        <span className="muted" style={{ fontSize: 11 }}>{(env.target?.kind ?? 'git') === 'git' ? `${rows.length} nodes across ${byProvider.length} provider${byProvider.length === 1 ? '' : 's'} · ${fmtUsd(total)}/mo` : `${rows.length} nodes`}</span>
        {invalid.length > 0 && <Badge tone="err">{invalid.length} invalid placement{invalid.length === 1 ? '' : 's'}</Badge>}
        <Spacer />
        <NewCheckpointButton />
      </Toolbar>
      <div className={s.body}>
        <section className={s.block}>
          <div className={s.blockHead}>Pipeline<span className="muted">checkpoints move left to right. Each environment only accepts what the one before it already runs.</span></div>
          <PipelineBoard />
        </section>
        {kind !== 'git' ? (
          <section className={s.block}>
            <div className={s.blockHead}>Containers<span className="muted">what {env.name} runs on {kind === 'docker' ? (env.target?.kind === 'docker' && env.target.host ? env.target.host : 'the Docker engine next to Tessery') : 'Kubernetes'}. Everything, including databases, runs as a container.</span></div>
            <table className={s.table}>
              <thead><tr><th>Node</th><th>Image</th><th className={s.num}>Replicas</th><th className={s.num}>Memory</th><th>Storage</th><th>Public at</th></tr></thead>
              <tbody>
                {containers.map((w) => {
                  const tech = TECH_BY_ID[w.node.techId]
                  const url = urls.get(w.name)
                  return (
                    <tr key={w.name}>
                      <td><span className={s.sw} style={{ background: CATEGORY_META[tech.category].color }} /><button className={s.nodeLink} onClick={() => { dispatch(ui.setWorkspace('design')); dispatch(ui.select({ kind: 'nodes', ids: [w.node.id] })) }}>{w.name}</button>{w.schedule && <Badge>{w.schedule}</Badge>}</td>
                      <td className={s.mono}>{w.build ? `built from ${w.build}` : w.image}</td>
                      <td className={clsx(s.num, s.mono)}>{w.role === 'app' ? Math.max(1, Math.round(w.node.replicas * env.scale)) : 1}</td>
                      <td className={clsx(s.num, s.mono)}>{w.memory}</td>
                      <td className={s.mono}>{w.volume ? 'persistent volume' : '-'}</td>
                      <td className={s.mono}>{url ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : w.public ? 'set a domain' : 'internal'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {doc.nodes.length > containers.length && <div className="muted" style={{ fontSize: 11 }}>{doc.nodes.filter((n) => !containers.some((w) => w.node.id === n.id)).map((n) => n.name).join(', ')} {doc.nodes.length - containers.length === 1 ? 'is' : 'are'} not run as containers: clients, SaaS and external services get their address from a secret.</div>}
          </section>
        ) : (
        <section className={s.block}>
          <div className={s.blockHead}>Placement<span className="muted">where every node runs in {env.name}. Change a provider here to override it for this environment only.</span></div>
          <div className={s.costBar}>{byProvider.map(([pid, v]) => <Tooltip key={pid} content={`${PROVIDER_BY_ID[pid]?.name}: ${fmtUsd(v)}/mo`}><i style={{ width: `${total ? (v / total) * 100 : 0}%`, background: PROVIDER_BY_ID[pid]?.color }} /></Tooltip>)}</div>
          <table className={s.table}>
            <thead><tr><th>Node</th><th>Provider</th><th>Runs as</th><th>Product</th><th>Region</th><th className={s.num}>Replicas</th><th className={s.num}>Est./mo</th><th /></tr></thead>
            <tbody>
              {rows.map(({ n, pl, c, overridden }) => {
                const tech = TECH_BY_ID[n.techId]
                const reps = tech.category === 'compute' || tech.category === 'network' ? Math.max(1, Math.round(n.replicas * env.scale)) : n.replicas
                return (
                  <tr key={n.id} className={clsx(!c.ok && s.bad)}>
                    <td><span className={s.sw} style={{ background: CATEGORY_META[tech.category].color }} /><button className={s.nodeLink} onClick={() => { dispatch(ui.setWorkspace('design')); dispatch(ui.select({ kind: 'nodes', ids: [n.id] })) }}>{n.name}</button>{overridden && <Badge tone="accent">override</Badge>}</td>
                    <td style={{ width: 170 }}>
                      <Select value={pl.providerId} onChange={(pid) => { const p = PROVIDER_BY_ID[pid]; const o = placementOptions(tech, p, n); edit('setOverride', { envId: env.id, nodeId: n.id, placement: { providerId: pid, regionId: p.regions[0]?.id, mode: o.find((x) => x.mode === pl.mode)?.mode ?? o[0]?.mode ?? pl.mode } }) }}
                        options={PROVIDERS.map((p) => ({ value: p.id, label: p.name, disabled: !placementOptions(tech, p, n).length }))} />
                    </td>
                    <td className={s.mono}>{pl.mode === 'external' ? 'SaaS' : pl.mode}</td>
                    <td className={s.product}>{c.ok ? c.product : <span className={s.issue}><AlertTriangle size={12} />{c.issue}</span>}</td>
                    <td className={s.mono}>{pl.regionId ?? '-'}</td>
                    <td className={clsx(s.num, s.mono)}>{reps}</td>
                    <td className={clsx(s.num, s.mono)}>{c.ok ? fmtUsd(c.monthly) : '-'}</td>
                    <td>{overridden && <Tooltip content="Use the node's default placement"><Button size="xs" variant="ghost" icon={<X />} aria-label="Clear override" onClick={() => edit('setOverride', { envId: env.id, nodeId: n.id, placement: null })} /></Tooltip>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
        )}
        <section className={s.block}>
          <div className={s.blockHead}>Release history<span className="muted">{env.name}</span></div>
          {!history.length ? <div className="muted">No releases yet for {env.name}.</div> : (
            <table className={s.table}>
              <thead><tr><th>Checkpoint</th><th>Requested by</th><th>When</th><th>Status</th><th>Decided by</th><th /></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td><span className={s.mono}>#{r.checkpointSeq} {r.commit.slice(0, 8)}</span> {r.checkpointName}{r.note && <div className="muted" style={{ fontSize: 11 }}>{r.note}</div>}</td>
                    <td>{r.requester ?? 'unknown'}{r.fromEnv && <span className="muted"> from {r.fromEnv}</span>}</td>
                    <td className={s.mono}>{timeAgo(new Date(r.requestedAt).getTime())}</td>
                    <td><Badge tone={STATUS_TONE[r.status]}>{r.status}{r.id === liveId ? ', live' : ''}</Badge></td>
                    <td>{r.decider ?? ''}{r.decisionNote && <div className="muted" style={{ fontSize: 11 }}>{r.decisionNote}</div>}</td>
                    <td style={{ textAlign: 'right' }}>{r.status === 'released' && r.checkpointId !== liveCheckpoint && <Button size="xs" disabled={releasing || !canDeploy} onClick={() => rollBack(r.checkpointId, r.checkpointSeq)}>Roll back to this</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
