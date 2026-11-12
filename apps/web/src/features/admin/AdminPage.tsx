import { Building2, SlidersHorizontal, Users } from 'lucide-react'
import { useAdminOrgsQuery, useAdminSettingsQuery, useAdminUpdateUserMutation, useAdminUsersQuery, useMeQuery, usePutAdminSettingsMutation } from '@/api/endpoints/identity'
import { errorMessage } from '@/api/types'
import { setCurrentOrg } from '@/app/currentOrg'
import { navigate } from '@/app/router'
import { Badge, Button, Empty, Switch, toast, useDialogs } from '@/ui'
import { Card, PageLayout, PageTitle, Table, mono, muted } from '@/features/chrome/PageLayout'
import { timeAgo } from '@/lib/format'

const NAV = [
  { id: 'users', label: 'Users', icon: <Users /> },
  { id: 'orgs', label: 'Organizations', icon: <Building2 /> },
  { id: 'settings', label: 'Instance settings', icon: <SlidersHorizontal /> },
]

export function AdminPage({ section }: { section: string }) {
  const { data: me } = useMeQuery()
  const active = NAV.some((n) => n.id === section) ? section : 'users'
  return (
    <PageLayout title="Instance admin" nav={NAV} active={active} base="/admin">
      {!me?.instanceAdmin ? <Empty title="Only instance administrators can open this page" />
        : active === 'orgs' ? <OrgsView /> : active === 'settings' ? <SettingsView /> : <UsersView meId={me.id} />}
    </PageLayout>
  )
}

function UsersView({ meId }: { meId: string }) {
  const { data: users } = useAdminUsersQuery()
  const [update] = useAdminUpdateUserMutation()
  const dialogs = useDialogs()

  const change = async (id: string, name: string, patch: { instanceAdmin?: boolean; disabled?: boolean }) => {
    const what = patch.disabled === true ? `Disable ${name}? They are signed out everywhere and cannot sign in.`
      : patch.instanceAdmin === true ? `Make ${name} an instance administrator? They can see and change everything on this installation.`
      : null
    if (what && !(await dialogs.confirm({ title: 'Confirm', body: what, ok: 'Continue', danger: true }))) return
    const r = await update({ id, ...patch })
    toast('error' in r ? errorMessage(r.error) : 'User updated', 'error' in r ? 'err' : 'ok')
  }

  return (
    <>
      <PageTitle title="Users" description="Every account on this installation. Accounts are created when an organization adds a member with a new email." />
      <Table head={['Name', 'Email', 'Last sign-in', 'Instance admin', 'Active']}>
        {(users ?? []).map((u) => (
          <tr key={u.id}>
            <td>{u.name} {u.id === meId && <Badge>you</Badge>}</td>
            <td className={muted}>{u.email}</td>
            <td className={muted}>{u.lastLoginAt ? timeAgo(new Date(u.lastLoginAt).getTime()) : 'never'}</td>
            <td><Switch checked={u.instanceAdmin} onChange={(v) => change(u.id, u.name, { instanceAdmin: v })} /></td>
            <td><Switch checked={!u.disabled} disabled={u.id === meId} onChange={(v) => change(u.id, u.name, { disabled: !v })} /></td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function OrgsView() {
  const { data: orgs } = useAdminOrgsQuery()
  return (
    <>
      <PageTitle title="Organizations" description="All organizations on this installation. As an instance administrator you can open any of them, even without being a member." />
      <Table head={['Name', 'Slug', 'Created', '']}>
        {(orgs ?? []).map((o) => (
          <tr key={o.id}>
            <td>{o.name}</td>
            <td className={mono}>{o.slug}</td>
            <td className={muted}>{timeAgo(new Date(o.createdAt).getTime())}</td>
            <td style={{ textAlign: 'right' }}><Button size="xs" onClick={() => { setCurrentOrg(o.id); navigate('/') }}>Open</Button></td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function SettingsView() {
  const { data } = useAdminSettingsQuery()
  const [put] = usePutAdminSettingsMutation()
  if (!data) return null
  return (
    <>
      <PageTitle title="Instance settings" />
      <Card>
        <Switch checked={data.allowOrgCreation} label="Let any signed-in user create organizations" onChange={async (v) => {
          const r = await put({ ...data, allowOrgCreation: v })
          toast('error' in r ? errorMessage(r.error) : 'Settings saved', 'error' in r ? 'err' : 'ok')
        }} />
        <p className={muted}>When this is off, only instance administrators can create organizations.</p>
      </Card>
    </>
  )
}
