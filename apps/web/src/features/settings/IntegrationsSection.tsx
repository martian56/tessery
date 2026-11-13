import { useState } from 'react'
import { Cloud, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  useCheckIntegrationMutation, useCreateIntegrationMutation, useDeleteIntegrationMutation, useListIntegrationsQuery, useProvidersQuery, useUpdateIntegrationMutation,
} from '@/api/endpoints/integrations'
import { errorMessage, type Integration, type ProviderSpec } from '@/api/types'
import { PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { Badge, Button, Dialog, Field, Input, Textarea, toast, useDialogs } from '@/ui'
import { Card, PageTitle, mono, muted } from '@/features/chrome/PageLayout'
import { timeAgo } from '@/lib/format'
import type { Perms } from './OrgSettings'
import s from './Settings.module.css'

interface Check { ok: boolean; account?: string; error?: string }

export function IntegrationsSection({ org, perms }: { org: string; perms: Perms }) {
  const { data: providers } = useProvidersQuery()
  const { data: integrations } = useListIntegrationsQuery(org)
  const [connecting, setConnecting] = useState<{ provider: ProviderSpec; existing?: Integration } | null>(null)
  const canManage = perms.can('integration:manage')

  return (
    <>
      <PageTitle title="Integrations" description="Cloud accounts Tessery can use to create servers and infrastructure for this organization. Credentials are checked with the provider, stored encrypted and never shown again." />
      <div className={s.providerGrid}>
        {(providers ?? []).map((p) => {
          const connected = (integrations ?? []).filter((i) => i.provider === p.id)
          return (
            <div key={p.id} className={s.providerCard}>
              <div className={s.providerHead}>
                <span className={s.providerDot} style={{ background: PROVIDER_BY_ID[p.id]?.color ?? 'var(--acc)' }} />
                <b>{p.name}</b>
                {connected.length > 0 && <Badge tone="ok">{connected.length} connected</Badge>}
              </div>
              {canManage && <Button size="sm" icon={<Plus />} onClick={() => setConnecting({ provider: p })}>Connect</Button>}
            </div>
          )
        })}
      </div>
      {(integrations ?? []).map((i) => (
        <IntegrationCard key={i.id} org={org} integration={i} provider={providers?.find((p) => p.id === i.provider)} canManage={canManage}
          onReplace={(provider) => setConnecting({ provider, existing: i })} />
      ))}
      {!integrations?.length && <Card><div className={muted}>No cloud accounts yet. Docker servers you add under Servers do not need one.</div></Card>}
      {connecting && <ConnectDialog org={org} provider={connecting.provider} existing={connecting.existing} count={(integrations ?? []).filter((i) => i.provider === connecting.provider.id).length} onClose={() => setConnecting(null)} />}
    </>
  )
}

function IntegrationCard({ org, integration, provider, canManage, onReplace }: { org: string; integration: Integration; provider?: ProviderSpec; canManage: boolean; onReplace: (p: ProviderSpec) => void }) {
  const [check, { isLoading: checking }] = useCheckIntegrationMutation()
  const [remove] = useDeleteIntegrationMutation()
  const dialogs = useDialogs()
  const last = integration.lastCheck as Check | null | undefined
  const summary = Object.entries(integration.summary as Record<string, unknown>).filter(([, v]) => v)

  const run = async () => {
    const r = await check({ org, id: integration.id })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    const c = r.data.lastCheck as Check | null
    toast(c?.ok ? `${integration.name} works` : `${integration.name}: ${c?.error}`, c?.ok ? 'ok' : 'err')
  }
  const del = async () => {
    if (!(await dialogs.confirm({ title: `Disconnect ${integration.name}?`, body: 'Tessery forgets these credentials. Nothing changes in the cloud account.', ok: 'Disconnect', danger: true }))) return
    const r = await remove({ org, id: integration.id })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }

  return (
    <Card title={`${provider?.name ?? integration.provider} · ${integration.name}`} actions={canManage && (
      <div style={{ display: 'flex', gap: 4 }}>
        <Button size="sm" icon={<RefreshCw />} disabled={checking} onClick={run}>{checking ? 'Checking…' : 'Check'}</Button>
        {provider && <Button size="sm" variant="ghost" icon={<KeyRound />} onClick={() => onReplace(provider)}>Replace credentials</Button>}
        <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Disconnect ${integration.name}`} onClick={del} />
      </div>
    )}>
      <div className={s.serverRow}>
        <Cloud size={14} />
        {last?.ok ? <><Badge tone="ok">connected</Badge><span>{last.account}</span></> : <Badge tone="err">failing</Badge>}
        {integration.checkedAt && <span className={muted}>checked {timeAgo(new Date(integration.checkedAt).getTime())}</span>}
      </div>
      {last && !last.ok && <div className={s.serverError}>{last.error}</div>}
      {summary.length > 0 && <div className={s.serverFacts}>{summary.map(([k, v]) => <span key={k}>{k}: <span className={mono}>{String(v)}</span></span>)}</div>}
    </Card>
  )
}

function ConnectDialog({ org, provider, existing, count, onClose }: { org: string; provider: ProviderSpec; existing?: Integration; count: number; onClose: () => void }) {
  const [create, { isLoading: creating }] = useCreateIntegrationMutation()
  const [update, { isLoading: updating }] = useUpdateIntegrationMutation()
  const [name, setName] = useState(existing?.name ?? (count ? `${provider.id}-${count + 1}` : provider.id))
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const busy = creating || updating
  const ready = name.trim() && provider.fields.every((f) => f.optional || fields[f.key]?.trim())

  const save = async () => {
    setError('')
    const r = existing ? await update({ org, id: existing.id, fields }) : await create({ org, provider: provider.id, name: name.trim(), fields })
    if ('error' in r) return setError(errorMessage(r.error).replace(/^fields: /, ''))
    toast(`${provider.name} connected as ${(r.data.lastCheck as Check | null)?.account ?? r.data.name}`, 'ok')
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Replace ${existing.name} credentials` : `Connect ${provider.name}`} width={540} description={provider.help}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ready || busy} onClick={save}>{busy ? `Checking with ${provider.name}…` : existing ? 'Check and replace' : 'Check and connect'}</Button></>}>
      {!existing && <Field label="Name" hint="To tell several accounts of the same provider apart"><Input value={name} onChange={setName} /></Field>}
      {provider.fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.optional ? 'Optional' : undefined}>
          {f.multiline
            ? <Textarea mono rows={8} value={fields[f.key] ?? ''} onChange={(v) => setFields({ ...fields, [f.key]: v })} placeholder={f.placeholder} />
            : <Input mono type={f.secret ? 'password' : 'text'} value={fields[f.key] ?? ''} onChange={(v) => setFields({ ...fields, [f.key]: v })} placeholder={f.placeholder} />}
        </Field>
      ))}
      {error && <div className={s.serverError}>{error}</div>}
    </Dialog>
  )
}
