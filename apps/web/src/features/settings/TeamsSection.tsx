import { useState } from 'react'
import { ArrowLeft, Pencil, Plus, Trash2, UserMinus } from 'lucide-react'
import {
  useAddTeamMemberMutation, useCreateTeamMutation, useDeleteTeamMutation, useGetTeamQuery, useListMembersQuery,
  useListTeamsQuery, useRemoveTeamMemberMutation, useUpdateTeamMutation,
} from '@/api/endpoints/orgs'
import { errorMessage } from '@/api/types'
import { Button, Select, toast, useDialogs } from '@/ui'
import { Card, PageTitle, Table, mono, muted } from '@/features/chrome/PageLayout'
import { timeAgo } from '@/lib/format'
import type { Perms } from './OrgSettings'

export function TeamsSection({ org, perms }: { org: string; perms: Perms }) {
  const { data: teams } = useListTeamsQuery(org)
  const [create] = useCreateTeamMutation()
  const dialogs = useDialogs()
  const [open, setOpen] = useState<string | null>(null)

  if (open) return <TeamDetailView org={org} team={open} perms={perms} onBack={() => setOpen(null)} />

  const newTeam = async () => {
    const v = await dialogs.prompt({ title: 'New team', fields: [{ name: 'name', label: 'Name', placeholder: 'Platform' }, { name: 'description', label: 'Description' }], ok: 'Create team' })
    if (!v?.name.trim()) return
    const r = await create({ org, name: v.name.trim(), description: v.description.trim() })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { toast(`Team ${r.data.name} created`, 'ok'); setOpen(r.data.id) }
  }

  return (
    <>
      <PageTitle title="Teams" description="Teams group people and own projects. Access granted at team scope applies to every project the team owns."
        actions={perms.can('team:manage') && <Button variant="primary" icon={<Plus />} onClick={newTeam}>New team</Button>} />
      <Table head={['Team', 'Slug', 'Members', 'Created']} empty="No teams yet">
        {(teams ?? []).map((t) => (
          <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(t.id)}>
            <td><b>{t.name}</b>{t.description && <div className={muted}>{t.description}</div>}</td>
            <td className={mono}>{t.slug}</td>
            <td>{t.memberCount}</td>
            <td className={muted}>{timeAgo(new Date(t.createdAt).getTime())}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}

function TeamDetailView({ org, team, perms, onBack }: { org: string; team: string; perms: Perms; onBack: () => void }) {
  const { data } = useGetTeamQuery({ org, team })
  const { data: members } = useListMembersQuery(org, { skip: !perms.can('member:read') })
  const [update] = useUpdateTeamMutation()
  const [remove] = useDeleteTeamMutation()
  const [addMember] = useAddTeamMemberMutation()
  const [removeMember] = useRemoveTeamMemberMutation()
  const dialogs = useDialogs()
  const [pick, setPick] = useState('')
  const canManage = perms.can('team:manage')
  if (!data) return null

  const candidates = (members ?? []).filter((m) => !data.members.some((x) => x.userId === m.userId))
  const edit = async () => {
    const v = await dialogs.prompt({ title: 'Edit team', fields: [{ name: 'name', label: 'Name', value: data.name }, { name: 'slug', label: 'Slug', value: data.slug }, { name: 'description', label: 'Description', value: data.description }], ok: 'Save' })
    if (!v) return
    const r = await update({ org, team, name: v.name.trim(), slug: v.slug.trim(), description: v.description.trim() })
    toast('error' in r ? errorMessage(r.error) : 'Team updated', 'error' in r ? 'err' : 'ok')
  }
  const del = async () => {
    if (!(await dialogs.confirm({ title: `Delete ${data.name}?`, body: 'Projects owned by the team become organization-wide. Grants given to the team are removed.', ok: 'Delete team', danger: true }))) return
    const r = await remove({ org, team })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { toast('Team deleted', 'ok'); onBack() }
  }
  const add = async () => {
    if (!pick) return
    const r = await addMember({ org, team, userId: pick })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else setPick('')
  }

  return (
    <>
      <div><Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack}>All teams</Button></div>
      <PageTitle title={data.name} description={data.description || undefined}
        actions={canManage && <><Button icon={<Pencil />} onClick={edit}>Edit</Button><Button variant="danger" icon={<Trash2 />} onClick={del}>Delete</Button></>} />
      {canManage && (
        <Card title="Add a member">
          {candidates.length === 0 ? <p className={muted}>Every organization member is already in this team.</p> : (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><Select value={pick || undefined} placeholder="Choose a member" onChange={setPick} options={candidates.map((m) => ({ value: m.userId, label: m.name, hint: m.email }))} /></div>
              <Button variant="primary" disabled={!pick} onClick={add}>Add</Button>
            </div>
          )}
        </Card>
      )}
      <Table head={['Name', 'Email', 'Added', '']} empty="This team has no members">
        {data.members.map((m) => (
          <tr key={m.userId}>
            <td>{m.name}</td>
            <td className={muted}>{m.email}</td>
            <td className={muted}>{timeAgo(new Date(m.addedAt).getTime())}</td>
            <td style={{ textAlign: 'right' }}>
              {canManage && <Button variant="ghost" size="xs" icon={<UserMinus />} aria-label={`Remove ${m.name}`} onClick={async () => {
                const r = await removeMember({ org, team, user: m.userId })
                if ('error' in r) toast(errorMessage(r.error), 'err')
              }} />}
            </td>
          </tr>
        ))}
      </Table>
    </>
  )
}
