import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useMeQuery } from '@/api/endpoints/identity'
import { useAddMemberMutation, useListMembersQuery, useListRolesQuery, useRemoveMemberMutation } from '@/api/endpoints/orgs'
import { errorMessage } from '@/api/types'
import { Badge, Button, Dialog, Field, Input, Select, toast, useDialogs } from '@/ui'
import { PageTitle, Table, muted } from '@/features/chrome/PageLayout'
import { timeAgo } from '@/lib/format'
import type { Perms } from './OrgSettings'

export function MembersSection({ org, perms }: { org: string; perms: Perms }) {
  const { data: me } = useMeQuery()
  const { data: members } = useListMembersQuery(org)
  const { data: roles } = useListRolesQuery(org, { skip: !perms.can('role:read') })
  const [remove] = useRemoveMemberMutation()
  const dialogs = useDialogs()
  const [open, setOpen] = useState(false)
  const roleName = (key: string) => roles?.find((r) => r.key === key)?.name ?? key

  const kick = async (userId: string, name: string) => {
    const self = userId === me?.id
    if (!(await dialogs.confirm({ title: self ? 'Leave this organization?' : `Remove ${name}?`, body: 'Their organization, team and project grants are removed as well.', ok: self ? 'Leave' : 'Remove', danger: true }))) return
    const r = await remove({ org, user: userId })
    toast('error' in r ? errorMessage(r.error) : `${name} removed`, 'error' in r ? 'err' : 'ok')
  }

  return (
    <>
      <PageTitle title="Members" description="People who belong to this organization. Roles shown here are granted at organization scope; finer grants live under Access."
        actions={perms.can('member:invite') && <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>Add member</Button>} />
      <Table head={['Name', 'Email', 'Organization roles', 'Joined', '']}>
        {(members ?? []).map((m) => (
          <tr key={m.userId}>
            <td>
              {m.name}{' '}
              {m.userId === me?.id && <Badge>you</Badge>}{' '}
              {m.instanceAdmin && <Badge tone="accent">instance admin</Badge>}{' '}
              {m.disabled && <Badge tone="err">disabled</Badge>}
            </td>
            <td className={muted}>{m.email}</td>
            <td>{m.orgRoles.length ? m.orgRoles.map((k) => <span key={k} style={{ marginRight: 4 }}><Badge tone="info">{roleName(k)}</Badge></span>) : <span className={muted}>none</span>}</td>
            <td className={muted}>{timeAgo(new Date(m.joinedAt).getTime())}</td>
            <td style={{ textAlign: 'right' }}>
              {(perms.can('member:remove') || m.userId === me?.id) && <Button variant="ghost" size="xs" icon={<Trash2 />} aria-label={`Remove ${m.name}`} onClick={() => kick(m.userId, m.name)} />}
            </td>
          </tr>
        ))}
      </Table>
      <AddMemberDialog org={org} open={open} onClose={() => setOpen(false)} roles={(roles ?? []).map((r) => ({ value: r.key, label: r.name, hint: r.builtin ? 'built-in' : 'custom' }))} />
    </>
  )
}

function AddMemberDialog({ org, open, onClose, roles }: { org: string; open: boolean; onClose: () => void; roles: { value: string; label: string; hint: string }[] }) {
  const [add, { isLoading }] = useAddMemberMutation()
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer' })
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const submit = async () => {
    const r = await add({ org, email: form.email.trim(), name: form.name.trim() || undefined, password: form.password || undefined, role: form.role })
    if ('error' in r) { toast(errorMessage(r.error), 'err'); return }
    toast(`${r.data.name} added`, 'ok')
    setForm({ email: '', name: '', password: '', role: 'viewer' })
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add member" description="Add an existing account by email, or create a new account with an initial password."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading || !form.email.trim()} onClick={submit}>{isLoading ? 'Adding…' : 'Add member'}</Button></>}>
      <Field label="Email" wide><Input size="md" type="email" autoFocus value={form.email} onChange={set('email')} /></Field>
      <Field label="Name" wide hint="Only needed for a new account."><Input size="md" value={form.name} onChange={set('name')} /></Field>
      <Field label="Initial password" wide hint="Only needed for a new account. At least 10 characters."><Input size="md" type="password" value={form.password} onChange={set('password')} /></Field>
      {roles.length > 0 && <Field label="Organization role" wide><Select value={form.role} onChange={set('role')} options={roles} /></Field>}
    </Dialog>
  )
}
