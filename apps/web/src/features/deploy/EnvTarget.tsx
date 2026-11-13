import { useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import type { DeployTarget, Environment, ProjectDoc } from '@tessery/core/domain/types'
import { dockerPublicHost, isHostname, namespaceOf, workloads } from '@tessery/core/codegen/deploy'
import { useDeleteSecretMutation, usePutSecretMutation } from '@/api/endpoints/delivery'
import { errorMessage } from '@/api/types'
import { usePermissions } from '@/app/usePermissions'
import { useAppSelector, useEdit } from '@/store'
import { Badge, Button, Dialog, Field, Input, NumberInput, Section, Segmented, Textarea, Tooltip, toast, useDialogs } from '@/ui'
import { useEnvSecrets } from './useEnvSecrets'
import s from './Deploy.module.css'

type Kind = DeployTarget['kind']

const DEFAULTS: Record<Kind, DeployTarget> = {
  docker: { kind: 'docker' },
  kubernetes: { kind: 'kubernetes' },
  git: { kind: 'git' },
}

export function TargetSection({ doc, env }: { doc: ProjectDoc; env: Environment }) {
  const edit = useEdit()
  const target = env.target ?? { kind: 'git' }
  const set = (t: DeployTarget) => edit('updateEnv', { envId: env.id, patch: { target: t } })
  const patch = (p: Record<string, unknown>) => {
    const next = { ...target, ...p } as Record<string, unknown>
    Object.keys(next).forEach((k) => { if (next[k] === '' || next[k] === undefined) delete next[k] })
    set(next as DeployTarget)
  }
  return (
    <Section title="Deploys to">
      <Segmented<Kind> value={target.kind} onChange={(k) => set(DEFAULTS[k])}
        options={[{ value: 'docker', label: 'Docker' }, { value: 'kubernetes', label: 'Kubernetes' }, { value: 'git', label: 'Git only' }]} />
      {target.kind === 'docker' && (
        <>
          <Field label="Host" hint="Empty runs on the Docker engine Tessery uses. ssh://user@server runs on any machine with Docker and SSH, like a small VPS.">
            <Input mono value={target.host ?? ''} placeholder="this machine" onCommit={(v) => patch({ host: v.trim() })} />
          </Field>
          <Field label="Domain" hint="Public nodes get <node>.<domain> with HTTPS. Point a wildcard DNS record at the host. Empty publishes them on host ports instead.">
            <Input mono value={target.domain ?? ''} placeholder="apps.example.com" onCommit={(v) => {
              const domain = v.trim().toLowerCase()
              if (domain && !isHostname(domain)) return toast(`${domain} is not a domain name. Use just the name, like apps.example.com.`, 'err')
              patch(domain ? { domain } : { domain: undefined, hosts: undefined })
            }} />
          </Field>
          {target.domain && <PublicHosts doc={doc} env={env} target={target} onChange={(hosts) => patch({ hosts: Object.keys(hosts).length ? hosts : undefined })} />}
          <div className={s.hint}>Runs every node as a container with Docker Compose. Databases and queues run as containers too, so this costs nothing beyond the machine. Good for development, staging and small production setups.{target.host?.startsWith('ssh://') && ' Needs an SSH_PRIVATE_KEY secret below for a user that may run docker on that host. SSH_KNOWN_HOSTS is optional and pins the host key; the deploy log prints it the first time.'}</div>
        </>
      )}
      {target.kind === 'kubernetes' && (
        <>
          <Field label="Namespace"><Input mono value={target.namespace ?? ''} placeholder={namespaceOf(doc, env)} onCommit={(v) => patch({ namespace: v.trim() })} /></Field>
          <Field label="Registry" hint="Images are pushed here; the cluster must be able to pull from it."><Input mono value={target.registry ?? ''} placeholder="ghcr.io/acme" onCommit={(v) => patch({ registry: v.trim() })} /></Field>
          <Field label="Domain" hint="Public nodes get <node>.<project>-<env>.<domain>"><Input mono value={target.domain ?? ''} placeholder="apps.example.com" onCommit={(v) => patch({ domain: v.trim() })} /></Field>
          <Field label="Ingress class"><Input mono value={target.ingressClass ?? ''} placeholder="cluster default" onCommit={(v) => patch({ ingressClass: v.trim() })} /></Field>
          <Field label="Public port" hint="Only when the ingress is not on port 80"><NumberInput value={target.publicPort ?? 80} min={1} max={65535} onCommit={(v) => patch({ publicPort: v === 80 ? undefined : v })} /></Field>
          <div className={s.hint}>Needs a KUBECONFIG secret below. Data stores run as StatefulSets with persistent volumes.</div>
        </>
      )}
      {target.kind === 'git' && <div className={s.hint}>Tessery only moves the <code>env/{env.id}</code> branch. Deploy from it with your own CI.</div>}
    </Section>
  )
}

type DockerTarget = Extract<DeployTarget, { kind: 'docker' }>

function PublicHosts({ doc, env, target, onChange }: { doc: ProjectDoc; env: Environment; target: DockerTarget; onChange: (hosts: Record<string, string>) => void }) {
  const nodes = workloads(doc, env).filter((w) => w.public && w.port && !w.schedule)
  if (!nodes.length) return null
  const set = (name: string, v: string) => {
    const next = { ...target.hosts }
    const host = v.trim().toLowerCase()
    if (host && !isHostname(host)) return toast(`${host} is not a domain name. Use just the name, like shop.example.com.`, 'err')
    if (host) next[name] = host
    else delete next[name]
    onChange(next)
  }
  return (
    <Field label="Public addresses" hint="Give a node its own domain, like shop.example.com. Its DNS must point at the host too.">
      {nodes.map((w) => (
        <div key={w.name} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 4, alignItems: 'center' }}>
          <span className={s.mono}>{w.name}</span>
          <Input mono value={target.hosts?.[w.name] ?? ''} placeholder={dockerPublicHost(w.name, { ...target, hosts: undefined })} onCommit={(v) => set(w.name, v)} />
        </div>
      ))}
    </Field>
  )
}

const MULTILINE: Record<string, string> = {
  KUBECONFIG: 'apiVersion: v1\nclusters: ...',
  SSH_PRIVATE_KEY: '-----BEGIN OPENSSH PRIVATE KEY-----\n...',
  SSH_KNOWN_HOSTS: '203.0.113.7 ssh-ed25519 AAAA...',
}

export function SecretsSection({ doc, env }: { doc: ProjectDoc; env: Environment }) {
  const edit = useEdit()
  const dialogs = useDialogs()
  const org = useAppSelector((st) => st.project.orgId) ?? undefined
  const perms = usePermissions({ org, project: doc.id, env: env.id })
  const canWrite = perms.can('secret:write')
  const { rows, error } = useEnvSecrets(doc, env)
  const [put, { isLoading: saving }] = usePutSecretMutation()
  const [del] = useDeleteSecretMutation()
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState('')


  const save = async () => {
    if (!editing) return
    const r = await put({ pid: doc.id, env: env.id, name: editing, value })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    toast(`${editing} saved for ${env.name}. Redeploy it from the pipeline to apply the change.`, 'ok')
    setEditing(null)
    setValue('')
  }
  const remove = async (name: string) => {
    if (!(await dialogs.confirm({ title: `Delete ${name}?`, body: `Deploys to ${env.name} that need it will fail until it is set again. Generated secrets are recreated with a new value, which breaks existing data stores.`, ok: 'Delete', danger: true }))) return
    const r = await del({ pid: doc.id, env: env.id, name })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    if (env.secrets.includes(name)) edit('setSecrets', { envId: env.id, secrets: env.secrets.filter((x) => x !== name) })
  }
  const add = () => {
    const name = adding.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    if (!name) return
    if (!env.secrets.includes(name)) edit('setSecrets', { envId: env.id, secrets: [...env.secrets, name] })
    setAdding('')
    setEditing(name)
  }
  const missing = rows.filter((r) => r.required && !r.generate && !r.stored).length

  return (
    <Section title={<>Secrets{missing > 0 && <Badge tone="warn">{missing} missing</Badge>}</>}>
      {error && <div className={s.hint}>{errorMessage(error)}</div>}
      <div className={s.secretList}>
        {rows.map((r) => (
          <div key={r.name} className={s.secretRow}>
            <KeyRound size={12} />
            <div className={s.secretMain}>
              <span className={s.mono}>{r.name}</span>
              <span className={s.hint}>{r.description}</span>
            </div>
            {r.stored ? <Badge tone="ok">{r.stored.generated ? 'generated' : 'set'}</Badge> : r.generate ? <Tooltip content="Tessery creates a random value on the first deploy"><span><Badge>auto</Badge></span></Tooltip> : r.required ? <Badge tone="warn">missing</Badge> : <Badge>optional</Badge>}
            {canWrite && <Button size="xs" variant="ghost" onClick={() => { setEditing(r.name); setValue('') }}>{r.stored ? 'Replace' : 'Set'}</Button>}
            {canWrite && r.stored && <Button size="xs" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${r.name}`} onClick={() => remove(r.name)} />}
          </div>
        ))}
        {!rows.length && <span className={s.hint}>This environment needs no secrets yet.</span>}
      </div>
      {canWrite && (
        <div style={{ display: 'flex', gap: 4 }}>
          <Input mono value={adding} placeholder="STRIPE_SECRET_KEY" onChange={setAdding} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button size="sm" icon={<Plus />} onClick={add} aria-label="Add a secret" />
        </div>
      )}
      <div className={s.hint}>Secrets you add are passed to every service and web app as environment variables. Values are encrypted and never shown again.</div>
      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)} title={`${editing} for ${env.name}`} description="The value is encrypted with the server key. Nobody can read it back, including you."
          footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={!value || saving} onClick={save}>Save</Button></>}>
          {MULTILINE[editing]
            ? <Textarea mono value={value} onChange={setValue} rows={12} placeholder={MULTILINE[editing]} />
            : <Input mono type="password" autoFocus value={value} onChange={setValue} onKeyDown={(e) => e.key === 'Enter' && value && save()} />}
        </Dialog>
      )}
    </Section>
  )
}
