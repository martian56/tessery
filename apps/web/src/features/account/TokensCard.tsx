import { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useCreateTokenMutation, useRevokeTokenMutation, useTokensQuery } from '@/api/endpoints/tokens'
import { errorMessage } from '@/api/types'
import { Badge, Button, Dialog, Field, Input, Select, toast, useDialogs } from '@/ui'
import { Card, Table, muted, mono } from '@/features/chrome/PageLayout'
import { timeAgo } from '@/lib/format'

const SCOPES: Record<string, { label: string; permissions?: string[] }> = {
  all: { label: 'Everything you can do' },
  read: { label: 'Read only', permissions: ['project:read', 'deployment:read'] },
  code: { label: 'Clone and push code', permissions: ['project:read', 'project:edit'] },
  deploy: { label: 'Design, checkpoint and deploy', permissions: ['project:read', 'project:edit', 'deployment:read', 'deployment:run'] },
}

export function TokensCard() {
  const dialogs = useDialogs()
  const { data: tokens } = useTokensQuery()
  const [create, { isLoading: creating }] = useCreateTokenMutation()
  const [revoke] = useRevokeTokenMutation()
  const [form, setForm] = useState<{ name: string; scope: string; days: string } | null>(null)
  const [secret, setSecret] = useState<string | null>(null)

  const submit = async () => {
    if (!form) return
    const r = await create({ name: form.name.trim(), permissions: SCOPES[form.scope].permissions, expiresInDays: form.days === 'never' ? undefined : Number(form.days) })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    setForm(null)
    setSecret(r.data.secret)
  }
  const remove = async (id: string, name: string) => {
    if (!(await dialogs.confirm({ title: `Revoke ${name}?`, body: 'Anything using this token stops working immediately.', ok: 'Revoke', danger: true }))) return
    const r = await revoke(id)
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }

  return (
    <Card title="API tokens" actions={<Button size="sm" icon={<Plus />} onClick={() => setForm({ name: '', scope: 'code', days: '90' })}>New token</Button>}>
      <p className={muted}>Use a token as the password for git over HTTPS, as a bearer token for the API, or to connect an AI agent over MCP. A token can never do more than you can.</p>
      {tokens?.length ? (
        <Table head={['Name', 'Token', 'Can', 'Last used', 'Expires', '']}>
          {tokens.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td className={mono}>{t.prefix}...</td>
              <td>{t.permissions ? t.permissions.map((p) => <Badge key={p} mono>{p}</Badge>) : <Badge>everything</Badge>}</td>
              <td>{t.lastUsedAt ? timeAgo(new Date(t.lastUsedAt).getTime()) : 'never'}</td>
              <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : 'never'}</td>
              <td style={{ textAlign: 'right' }}><Button size="xs" variant="ghost" icon={<Trash2 />} aria-label={`Revoke ${t.name}`} onClick={() => remove(t.id, t.name)} /></td>
            </tr>
          ))}
        </Table>
      ) : <p className={muted}>No tokens yet.</p>}

      {form && (
        <Dialog open onOpenChange={(o) => !o && setForm(null)} title="New API token"
          footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" disabled={!form.name.trim() || creating} onClick={submit}>Create token</Button></>}>
          <Field label="Name" wide><Input size="md" autoFocus value={form.name} placeholder="laptop git, CI, Claude Code" onChange={(v) => setForm({ ...form, name: v })} /></Field>
          <Field label="Allows" wide><Select value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} options={Object.entries(SCOPES).map(([value, s]) => ({ value, label: s.label }))} /></Field>
          <Field label="Expires" wide><Select value={form.days} onChange={(v) => setForm({ ...form, days: v })} options={[{ value: '30', label: 'In 30 days' }, { value: '90', label: 'In 90 days' }, { value: '365', label: 'In a year' }, { value: 'never', label: 'Never' }]} /></Field>
        </Dialog>
      )}
      {secret && (
        <Dialog open onOpenChange={(o) => !o && setSecret(null)} title="Copy your token now" description="It is not shown again. Store it like a password."
          footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <code className={mono} style={{ flex: 1, userSelect: 'all', wordBreak: 'break-all' }}>{secret}</code>
            <Button size="sm" icon={<Copy />} onClick={() => { navigator.clipboard.writeText(secret); toast('Copied', 'ok') }}>Copy</Button>
          </div>
        </Dialog>
      )}
    </Card>
  )
}
