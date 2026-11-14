import { useState } from 'react'
import { Plus, ShieldOff, Trash2 } from 'lucide-react'
import { useMeQuery } from '@/api/endpoints/identity'
import { useAddMemberMutation, useListMembersQuery, useListRolesQuery, useRemoveMemberMutation } from '@/api/endpoints/orgs'
import { errorMessage } from '@/api/types'
import { useOrgSecurityQuery, usePutOrgSecurityMutation, useResetMemberTwoFactorMutation } from '@/api/endpoints/twoFactor'
import { Badge, Button, Dialog, Field, Input, Select, Switch, toast, useDialogs } from '@/ui'
import { Card, PageTitle, Table, muted } from '@/features/chrome/PageLayout'
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
  const { data: security } = useOrgSecurityQuery(org)
  const [putSecurity] = usePutOrgSecurityMutation()
  const [resetFactor] = useResetMemberTwoFactorMutation()
  const canManage = perms.can('org:manage')
  const hasFactor = (email: string) => !!security && !(security.membersWithout ?? []).includes(email)
  const require = async (on: boolean) => {
    const r = await putSecurity({ org, requireTwoFactor: on })
    toast('error' in r ? errorMessage(r.error) : on ? 'Members now need two-factor sign-in' : 'Two-factor is optional again', 'error' in r ? 'err' : 'ok')
  }
  const reset = async (userId: string, name: string) => {
    if (!(await dialogs.confirm({ title: `Reset two-factor for ${name}?`, body: 'Their authenticator app and recovery codes stop working and they are signed out. They sign in with their password and set it up again.', ok: 'Reset', danger: true }))) return
    const r = await resetFactor({ org, user: userId })
    toast('error' in r ? errorMessage(r.error) : `Two-factor reset for ${name}`, 'error' in r ? 'err' : 'ok')
  }

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
      {security && (
        <Card title="Two-factor sign-in">
          <Switch checked={security.requireTwoFactor} disabled={!canManage} onChange={require} label="Require two-factor for every member" />
          <p className={muted}>
            {security.requireTwoFactor ? 'Members without it can sign in but cannot open anything in this organization until they turn it on under Account.' : 'Members choose for themselves under Account.'}
            {security.membersWithout?.length ? ` Not set up yet: ${security.membersWithout.join(', ')}.` : ' Every member has it on.'}
          </p>
        </Card>
      )}
      <Table head={['Name', 'Email', 'Organization roles', 'Joined', '']}>
        {(members ?? []).map((m) => (
          <tr key={m.userId}>
            <td>
              {m.name}{' '}
              {m.userId === me?.id && <Badge>you</Badge>}{' '}
              {m.instanceAdmin && <Badge tone="accent">instance admin</Badge>}{' '}
              {m.disabled && <Badge tone="err">disabled</Badge>}{' '}
              {security && (hasFactor(m.email) ? <Badge tone="ok">2FA</Badge> : <Badge tone={security.requireTwoFactor ? 'warn' : 'neutral'}>no 2FA</Badge>)}
            </td>
            <td className={muted}>{m.email}</td>
            <td>{m.orgRoles.length ? m.orgRoles.map((k) => <span key={k} style={{ marginRight: 4 }}><Badge tone="info">{roleName(k)}</Badge></span>) : <span className={muted}>none</span>}</td>
            <td className={muted}>{timeAgo(new Date(m.joinedAt).getTime())}</td>
            <td style={{ textAlign: 'right' }}>
              {canManage && hasFactor(m.email) && m.userId !== me?.id && <Button variant="ghost" size="xs" icon={<ShieldOff />} aria-label={`Reset two-factor for ${m.name}`} onClick={() => reset(m.userId, m.name)} />}
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add member" description="Add an existing account by email, or create a new one. New people get an email to choose their password when email is set up; otherwise give them an initial password."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={isLoading || !form.email.trim()} onClick={submit}>{isLoading ? 'Adding…' : 'Add member'}</Button></>}>
      <Field label="Email" wide><Input size="md" type="email" autoFocus value={form.email} onChange={set('email')} /></Field>
      <Field label="Name" wide hint="Only needed for a new account."><Input size="md" value={form.name} onChange={set('name')} /></Field>
      <Field label="Initial password" wide hint="Only for a new account, and only when this instance cannot send email. At least 10 characters."><Input size="md" type="password" value={form.password} onChange={set('password')} /></Field>
      {roles.length > 0 && <Field label="Organization role" wide><Select value={form.role} onChange={set('role')} options={roles} /></Field>}
    </Dialog>
  )
}
