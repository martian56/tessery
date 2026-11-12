import { Trash2 } from 'lucide-react'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import type { Environment } from '@tessery/core/domain/types'
import { PROVIDERS, PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { Badge, Button, Empty, Field, Input, NumberInput, Section, Select, Switch, useDialogs } from '@/ui'
import ins from '@/features/design/Inspector.module.css'
import { SecretsSection, TargetSection } from './EnvTarget'

export function EnvInspector() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const dialogs = useDialogs()
  const envId = useUi((u) => u.envId)
  const env = doc.environments.find((e) => e.id === envId)
  if (!env) return <Empty title="No environment selected" />
  const up = (patch: Partial<Omit<Environment, 'id'>>) => edit('updateEnv', { envId: env.id, patch })
  const p = PROVIDER_BY_ID[env.defaultProvider]
  return (
    <div className={ins.wrap}>
      <div className={ins.title}><span className={ins.glyph}>env</span><div><b>{env.name}</b><span>{p?.name} · {env.defaultRegion}</span></div></div>
      <Section title="Environment">
        <Field label="Name"><Input value={env.name} onCommit={(v) => up({ name: v })} /></Field>
        <Field label="Default provider"><Select value={env.defaultProvider} onChange={(v) => up({ defaultProvider: v, defaultRegion: PROVIDER_BY_ID[v].regions[0].id })} options={PROVIDERS.filter((x) => x.id !== 'saas').map((x) => ({ value: x.id, label: x.name, hint: x.kind }))} /></Field>
        <Field label="Default region"><Select value={env.defaultRegion} onChange={(v) => up({ defaultRegion: v })} options={(p?.regions ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.id }))} /></Field>
        <Field label="Scale factor" hint="Multiplies replicas of compute nodes"><NumberInput value={env.scale} min={0.5} max={20} step={0.5} onCommit={(v) => up({ scale: v })} /></Field>
      </Section>
      <Section title="Release strategy">
        <Field label="Strategy"><Select value={env.strategy} onChange={(v) => up({ strategy: v })} options={[{ value: 'recreate', label: 'Recreate' }, { value: 'rolling', label: 'Rolling update' }, { value: 'canary', label: 'Canary 10% → 50% → 100%' }, { value: 'blue-green', label: 'Blue / green' }]} /></Field>
        <Field label="Approval"><Switch checked={env.approval} onChange={(v) => up({ approval: v })} label={env.approval ? 'required' : 'not required'} /></Field>
        <Field label="Auto-rollback"><Switch checked={env.autoRollback} onChange={(v) => up({ autoRollback: v })} label="on SLO breach" /></Field>
      </Section>
      <TargetSection doc={doc} env={env} />
      <SecretsSection doc={doc} env={env} />
      <Section title="Overrides">
        {Object.keys(env.overrides).length ? Object.entries(env.overrides).map(([nid, o]) => <div key={nid} className={ins.link}><span>{doc.nodes.find((n) => n.id === nid)?.name}</span><Badge mono>{PROVIDER_BY_ID[o.providerId ?? '']?.name ?? '-'} · {o.mode}</Badge></div>) : <span className="muted">Every node uses its default placement.</span>}
      </Section>
      <div className={ins.actions}>
        <Button size="sm" variant="danger" icon={<Trash2 />} disabled={doc.environments.length < 2} onClick={async () => { if (await dialogs.confirm({ title: `Delete ${env.name}?`, body: 'Its overrides and settings are removed. Release history stays on the server.', ok: 'Delete', danger: true })) { edit('removeEnv', { envId: env.id }); dispatch(ui.setEnv(doc.environments.find((e) => e.id !== env.id)!.id)) } }}>Delete environment</Button>
      </div>
    </div>
  )
}
