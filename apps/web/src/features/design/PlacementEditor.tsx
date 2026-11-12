import { useMemo } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import type { SystemNode, Environment, PlacementMode } from '@tessery/core/domain/types'
import { PROVIDERS, PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { checkPlacement, effectivePlacement, fitPlan, placementOptions } from '@tessery/core/catalog/placement'
import { useEdit } from '@/store'
import { Badge, Button, Field, Section, Segmented, Select, Switch } from '@/ui'
import { fmtUsd } from '@/lib/format'
import s from './Inspector.module.css'

export function PlacementEditor({ node, env }: { node: SystemNode; env?: Environment }) {
  const edit = useEdit()
  const tech = TECH_BY_ID[node.techId]
  const override = env?.overrides[node.id]
  const pl = effectivePlacement(node, env)
  const provider = PROVIDER_BY_ID[pl.providerId]
  const options = placementOptions(tech, provider, node)
  const check = checkPlacement(node, env)
  const set = (patch: Partial<typeof pl>) => {
    if (override && env) edit('setOverride', { envId: env.id, nodeId: node.id, placement: patch })
    else edit('setPlacement', { id: node.id, placement: patch })
  }
  const setProvider = (pid: string) => {
    const p = PROVIDER_BY_ID[pid]
    const opts = placementOptions(tech, p, node)
    const mode: PlacementMode = opts.find((o) => o.mode === pl.mode)?.mode ?? opts[0]?.mode ?? pl.mode
    set({ providerId: pid, regionId: p.regions[0]?.id, mode })
  }
  const compare = useMemo(() => PROVIDERS.filter((p) => p.kind !== 'self' && p.id !== 'saas').map((p) => {
    const o = placementOptions(tech, p, node)[0]
    return { p, o }
  }).filter((x) => x.o).sort((a, b) => a.o!.monthly - b.o!.monthly).slice(0, 8), [tech, node])

  return (
    <Section title="Placement" actions={<Badge tone={check.ok ? 'ok' : 'err'} mono>{check.ok ? `${fmtUsd(check.monthly)}/mo` : 'unsupported'}</Badge>}>
      {env && (
        <Field label={`In ${env.name}`}>
          <Switch checked={!!override} onChange={(on) => edit('setOverride', { envId: env.id, nodeId: node.id, placement: on ? { ...node.placement } : null })} label={override ? 'override' : 'use default'} />
        </Field>
      )}
      <Field label="Provider">
        <Select value={pl.providerId} onChange={setProvider} options={PROVIDERS.map((p) => {
          const has = placementOptions(tech, p, node).length > 0
          return { value: p.id, label: p.name, hint: has ? p.kind : 'n/a', disabled: !has, group: p.kind === 'hyperscaler' ? 'Hyperscalers' : p.kind === 'vps' || p.kind === 'cloud' ? 'Cloud & VPS' : p.kind === 'paas' ? 'Platforms & SaaS' : 'Self-managed' }
        })} />
      </Field>
      <Field label="Run as">
        <Segmented value={pl.mode} onChange={(m) => set({ mode: m })} options={(['managed', 'self-hosted', 'external'] as PlacementMode[]).filter((m) => options.some((o) => o.mode === m) || m === pl.mode).map((m) => ({ value: m, label: m === 'external' ? 'SaaS' : m }))} />
      </Field>
      <Field label="Product"><span className={s.product}>{check.ok ? check.product : '-'}</span></Field>
      {provider.regions.length > 1 && (
        <Field label="Region"><Select value={pl.regionId ?? provider.regions[0].id} onChange={(r) => set({ regionId: r })} options={provider.regions.map((r) => ({ value: r.id, label: r.name, hint: r.id, group: r.geo.toUpperCase() }))} /></Field>
      )}
      {pl.mode === 'self-hosted' && provider.plans.length > 0 && (
        <Field label="Server plan">
          <Select value={pl.planId ?? fitPlan(provider, node, tech)?.id ?? ''} onChange={(planId) => set({ planId })} options={provider.plans.map((p) => ({ value: p.id, label: p.name, hint: `${p.vcpu} vCPU · ${p.ramGb} GB · $${p.monthly}` }))} />
        </Field>
      )}
      {!check.ok && (
        <div className={s.issue}><AlertTriangle size={13} /><div>{check.issue}{check.suggestion && <><br /><span className="muted">{check.suggestion}</span></>}</div></div>
      )}
      <div className={s.compareHead}>Cheapest options</div>
      <div className={s.compare}>
        {compare.map(({ p, o }) => (
          <button key={p.id} className={s.compareRow} data-on={p.id === pl.providerId || undefined} onClick={() => set({ providerId: p.id, regionId: p.regions[0]?.id, mode: o!.mode })}>
            <span className={s.pdot} style={{ background: p.color }} />
            <span className={s.cName}>{p.name}</span>
            <span className={s.cMode}>{o!.mode === 'external' ? 'SaaS' : o!.mode}</span>
            <span className={s.cPrice}>{fmtUsd(o!.monthly * Math.max(1, node.replicas))}</span>
            {p.id === pl.providerId && <Check size={12} />}
          </button>
        ))}
      </div>
      {override && env && <Button size="xs" variant="ghost" onClick={() => edit('setOverride', { envId: env.id, nodeId: node.id, placement: null })}>Reset {env.name} override</Button>}
    </Section>
  )
}
