import { useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, Server as ServerIcon, Trash2 } from 'lucide-react'
import { useCheckServerMutation, useCreateServerMutation, useDeleteServerMutation, useListServersQuery, useUpdateServerMutation } from '@/api/endpoints/servers'
import { errorMessage, type Server } from '@/api/types'
import { Badge, Button, Dialog, Field, Input, Segmented, Textarea, toast, useDialogs } from '@/ui'
import { Card, PageTitle, mono, muted } from '@/features/chrome/PageLayout'
import { timeAgo } from '@/lib/format'
import type { Perms } from './OrgSettings'
import s from './Settings.module.css'

const gb = (bytes?: unknown) => (typeof bytes === 'number' ? `${(bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1)} GB` : '?')

interface Check { ok: boolean; error?: string; docker?: string; os?: string; arch?: string; cpus?: number; memoryBytes?: number; diskFreeBytes?: number; diskTotalBytes?: number }

export function ServersSection({ org, perms }: { org: string; perms: Perms }) {
  const { data: servers, isLoading } = useListServersQuery(org)
  const [adding, setAdding] = useState(false)
  const canManage = perms.can('server:manage')

  return (
    <>
      <PageTitle title="Servers" description="Machines with Docker that environments deploy to over SSH, such as a VPS. Add one here, then pick it in an environment's Deploys to settings."
        actions={canManage && <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add server</Button>} />
      {!isLoading && !servers?.length && (
        <Card>
          <div className={muted}>No servers yet. Environments can still run on the Docker engine Tessery itself uses.</div>
        </Card>
      )}
      {(servers ?? []).map((sv) => <ServerCard key={sv.id} org={org} server={sv} canManage={canManage} />)}
      {adding && <AddServerDialog org={org} onClose={() => setAdding(false)} />}
    </>
  )
}

function ServerCard({ org, server, canManage }: { org: string; server: Server; canManage: boolean }) {
  const [check, { isLoading: checking }] = useCheckServerMutation()
  const [update] = useUpdateServerMutation()
  const [remove] = useDeleteServerMutation()
  const dialogs = useDialogs()
  const last = server.lastCheck as Check | null | undefined

  const runCheck = async () => {
    const r = await check({ org, server: server.id })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    const c = r.data.lastCheck as Check | null
    toast(c?.ok ? `${server.name} is ready for deploys` : `${server.name}: ${c?.error ?? 'the check failed'}`, c?.ok ? 'ok' : 'err')
  }
  const del = async () => {
    if (!(await dialogs.confirm({ title: `Remove ${server.name}?`, body: 'Tessery forgets the server and its key. Nothing on the server itself is changed.', ok: 'Remove', danger: true }))) return
    const r = await remove({ org, server: server.id })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const edit = async () => {
    const v = await dialogs.prompt({ title: `Edit ${server.name}`, fields: [{ name: 'name', label: 'Name', value: server.name }, { name: 'address', label: 'Address', value: server.address }], ok: 'Save' })
    if (!v) return
    const r = await update({ org, server: server.id, name: v.name.trim(), address: v.address.trim() })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const newKey = async () => {
    if (!(await dialogs.confirm({ title: 'Generate a new key?', body: 'Deploys to this server fail until you add the new public key to it.', ok: 'Generate' }))) return
    const r = await update({ org, server: server.id, newKey: true })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const forget = async () => {
    const r = await update({ org, server: server.id, forgetHostKey: true })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else toast('Host key forgotten. The next check pins the new one.', 'ok')
  }

  return (
    <Card title={server.name} actions={
      <div style={{ display: 'flex', gap: 4 }}>
        {canManage && <Button size="sm" icon={<RefreshCw />} disabled={checking} onClick={runCheck}>{checking ? 'Checking…' : 'Check'}</Button>}
        {canManage && <Button size="sm" variant="ghost" onClick={edit}>Edit</Button>}
        {canManage && <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Remove ${server.name}`} onClick={del} />}
      </div>
    }>
      <div className={s.serverRow}>
        <ServerIcon size={14} />
        <span className={mono}>{server.address}</span>
        {!last ? <Badge>not checked</Badge> : last.ok ? <Badge tone="ok">ready</Badge> : <Badge tone="err">unreachable</Badge>}
        {server.checkedAt && <span className={muted}>checked {timeAgo(new Date(server.checkedAt).getTime())}</span>}
      </div>
      {last?.ok && (
        <div className={s.serverFacts}>
          <span>Docker {last.docker}</span><span>{last.os}</span><span>{last.arch}</span><span>{last.cpus} CPU</span>
          <span>{gb(last.memoryBytes)} memory</span><span>{gb(last.diskFreeBytes)} free of {gb(last.diskTotalBytes)}</span>
          {server.hostKeyPinned && <span>host key pinned</span>}
        </div>
      )}
      {last && !last.ok && <div className={s.serverError}>{last.error}</div>}
      {server.publicKey && <PublicKey server={server} />}
      <div className={muted}>
        {server.usedBy.length ? <>Used by {server.usedBy.map((u) => `${u.project} / ${u.env}`).join(', ')}</> : 'No environment deploys here yet.'}
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button size="xs" variant="ghost" icon={<KeyRound />} onClick={newKey}>New key</Button>
          {server.hostKeyPinned && <Button size="xs" variant="ghost" onClick={forget}>Forget host key</Button>}
        </div>
      )}
    </Card>
  )
}

function PublicKey({ server }: { server: Server }) {
  const user = server.address.replace(/^ssh:\/\//, '').split('@')[0]
  const command = `mkdir -p ~/.ssh && echo '${server.publicKey}' >> ~/.ssh/authorized_keys`
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast('Copied', 'ok'))
  return (
    <div className={s.publicKey}>
      <div>On the server, as <b>{user}</b>, add Tessery's key. The user also needs to run Docker (<span className={mono}>sudo usermod -aG docker {user}</span>).</div>
      <div className={s.keyLine}>
        <code className={mono}>{command}</code>
        <Button size="xs" variant="ghost" icon={<Copy />} aria-label="Copy the command" onClick={() => copy(command)} />
      </div>
    </div>
  )
}

function AddServerDialog({ org, onClose }: { org: string; onClose: () => void }) {
  const [create, { isLoading }] = useCreateServerMutation()
  const [check] = useCheckServerMutation()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [mode, setMode] = useState<'generate' | 'paste'>('generate')
  const [key, setKey] = useState('')

  const save = async () => {
    const r = await create({ org, name: name.trim(), address: address.trim(), privateKey: mode === 'paste' ? key : undefined })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    toast(mode === 'generate' ? `${r.data.name} added. Add its public key on the server, then press Check.` : `${r.data.name} added. Checking the connection…`, 'ok')
    onClose()
    if (mode === 'paste') check({ org, server: r.data.id })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a server" width={520}
      description="Any Linux machine with Docker and SSH works, like a small VPS. Tessery connects as the user in the address."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || !address.trim() || (mode === 'paste' && !key.trim()) || isLoading} onClick={save}>Add server</Button></>}>
      <Field label="Name"><Input value={name} onChange={setName} placeholder="hetzner-1" autoFocus /></Field>
      <Field label="Address" hint="ssh://user@host, with :port when SSH is not on 22"><Input mono value={address} onChange={setAddress} placeholder="ssh://deploy@203.0.113.7" /></Field>
      <Field label="SSH key">
        <Segmented<'generate' | 'paste'> value={mode} onChange={setMode} options={[{ value: 'generate', label: 'Generate one' }, { value: 'paste', label: 'Paste mine' }]} />
      </Field>
      {mode === 'paste'
        ? <Field label="Private key" hint="Unencrypted OpenSSH key. It is stored encrypted and never shown again."><Textarea mono rows={8} value={key} onChange={setKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></Field>
        : <div className={muted}>Tessery creates an ed25519 key pair and shows the public key to add on the server.</div>}
    </Dialog>
  )
}
