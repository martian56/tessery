import { useState } from 'react'
import { Clock, Plus, Trash2 } from 'lucide-react'
import { useCreateBindingMutation, useDeleteBindingMutation, useListBindingsQuery, useListMembersQuery, useListRolesQuery, useListTeamsQuery } from '@/api/endpoints/orgs'
import { useGetProjectQuery, useListProjectsQuery } from '@/api/endpoints/projects'
import type { ProjectDoc } from '@tessery/core/domain/types'
import { errorMessage, type Binding, type ScopeKind, type SubjectKind } from '@/api/types'
import { Badge, Button, Dialog, Field, Input, Segmented, Select, toast, useDialogs } from '@/ui'
import { PageTitle, Table, muted } from '@/features/chrome/PageLayout'
import type { Perms } from './OrgSettings'
import s from './Settings.module.css'

const EXPIRY: { value: string; label: string; ms: number }[] = [
  { value: 'never', label: 'Never', ms: 0 },
  { value: '1h', label: '1 hour', ms: 3600e3 },
  { value: '8h', label: '8 hours', ms: 8 * 3600e3 },
  { value: '1d', label: '1 day', ms: 86400e3 },
  { value: '7d', label: '7 days', ms: 7 * 86400e3 },
  { value: '30d', label: '30 days', ms: 30 * 86400e3 },
]

function expiryLabel(at: string) {
  const ms = new Date(at).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const h = ms / 3600e3
  return h < 1 ? `${Math.ceil(ms / 60e3)}m left` : h < 48 ? `${Math.round(h)}h left` : `${Math.round(h / 24)}d left`
}

export function AccessSection({ org, perms }: { org: string; perms: Perms }) {
  const { data: bindings } = useListBindingsQuery(org)
  const { data: teams } = useListTeamsQuery(org, { skip: !perms.can('team:read') })
  const { data: projects } = useListProjectsQuery(org)
  const [remove] = useDeleteBindingMutation()
  const dialogs = useDialogs()
  const [open, setOpen] = useState(false)
  const canManage = perms.can('role:manage')

  const scopeLabel = (b: Binding) => {
    const { type, id, env } = b.scope
    if (type === 'org') return 'Organization'
    if (type === 'team') return `Team ${teams?.find((t) => t.id === id)?.name ?? ''}`
    const p = projects?.find((x) => x.id === id)?.name ?? 'project'
    return type === 'project' ? `Project ${p}` : `${p} / ${env}`
  }
  const revoke = async (b: Binding) => {
    if (!(await dialogs.confirm({ title: 'Revoke this grant?', body: `${b.subjectName ?? 'The subject'} loses the ${b.roleName} role at ${scopeLabel(b).toLowerCase()} scope.`, ok: 'Revoke', danger: true }))) return
    const r = await remove({ org, binding: b.id })
    toast('error' in r ? errorMessage(r.error) : 'Grant revoked', 'error' in r ? 'err' : 'ok')
  }

  return (
    <>
      <PageTitle title="Access" description="Grants give a person or team a role at a scope. Grants flow downward: organization, then team, then project, then environment. Time-limited grants are removed automatically when they expire."
        actions={canManage && <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>Grant access</Button>} />
      <Table head={['Subject', 'Role', 'Scope', 'Expires', '']} empty="No grants yet">
        {(bindings ?? []).map((b) => (
          <tr key={b.id}>
            <td>{b.subjectName ?? b.subject.id} <Badge>{b.subject.kind}</Badge></td>
            <td><Badge tone="info">{b.roleName}</Badge></td>
            <td><span className={s.scope}><Badge tone="neutral">{b.scope.type}</Badge>{scopeLabel(b)}</span></td>
            <td className={muted}>{b.expiresAt ? <span className={s.scope}><Clock size={11} />{expiryLabel(b.expiresAt)}</span> : 'never'}</td>
            <td style={{ textAlign: 'right' }}>{canManage && <Button variant="ghost" size="xs" icon={<Trash2 />} aria-label="Revoke grant" onClick={() => revoke(b)} />}</td>
          </tr>
        ))}
      </Table>
      {open && <GrantDialog org={org} onClose={() => setOpen(false)} teams={teams ?? []} projects={projects ?? []} />}
    </>
  )
}

function GrantDialog({ org, onClose, teams, projects }: { org: string; onClose: () => void; teams: { id: string; name: string }[]; projects: { id: string; name: string }[] }) {
  const { data: members } = useListMembersQuery(org)
  const { data: roles } = useListRolesQuery(org)
  const [create, { isLoading }] = useCreateBindingMutation()
  const [kind, setKind] = useState<SubjectKind>('user')
  const [subject, setSubject] = useState('')
  const [roleId, setRoleId] = useState('')
  const [scope, setScope] = useState<ScopeKind>('org')
  const [target, setTarget] = useState('')
  const [env, setEnv] = useState('')
  const { data: picked } = useGetProjectQuery(target, { skip: scope !== 'environment' || !target })
  const envs = ((picked?.doc as unknown as ProjectDoc | undefined)?.environments ?? []).map((e) => ({ value: e.id, label: e.name, hint: e.id }))
  const [expiry, setExpiry] = useState('never')

  const subjects = kind === 'user' ? (members ?? []).map((m) => ({ value: m.userId, label: m.name, hint: m.email })) : teams.map((t) => ({ value: t.id, label: t.name }))
  const targets = scope === 'team' ? teams.map((t) => ({ value: t.id, label: t.name })) : projects.map((p) => ({ value: p.id, label: p.name }))
  const ready = subject && roleId && (scope === 'org' || target) && (scope !== 'environment' || env.trim())

  const submit = async () => {
    const ms = EXPIRY.find((e) => e.value === expiry)!.ms
    const r = await create({
      org,
      roleId,
      subject: { kind, id: subject },
      scope: { type: scope, id: scope === 'org' ? null : target, env: scope === 'environment' ? env.trim() : null },
      expiresAt: ms ? new Date(Date.now() + ms).toISOString() : null,
    })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { toast('Access granted', 'ok'); onClose() }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Grant access" width={520}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ready || isLoading} onClick={submit}>Grant</Button></>}>
      <Field label="Grant to" wide>
        <Segmented value={kind} onChange={(v) => { setKind(v); setSubject('') }} options={[{ value: 'user', label: 'Person' }, { value: 'team', label: 'Team' }]} />
      </Field>
      <Field label={kind === 'user' ? 'Person' : 'Team'} wide><Select value={subject || undefined} placeholder="Choose…" onChange={setSubject} options={subjects} /></Field>
      <Field label="Role" wide><Select value={roleId || undefined} placeholder="Choose a role" onChange={setRoleId} options={(roles ?? []).map((r) => ({ value: r.id, label: r.name, hint: `${r.permissions.length} permissions` }))} /></Field>
      <Field label="Scope" wide>
        <Segmented value={scope} onChange={(v) => { setScope(v); setTarget(''); setEnv('') }} options={[{ value: 'org', label: 'Organization' }, { value: 'team', label: 'Team' }, { value: 'project', label: 'Project' }, { value: 'environment', label: 'Environment' }]} />
      </Field>
      {scope !== 'org' && <Field label={scope === 'team' ? 'Team' : 'Project'} wide><Select value={target || undefined} placeholder="Choose…" onChange={setTarget} options={targets} /></Field>}
      {scope === 'environment' && target && (envs.length
        ? <Field label="Environment" wide><Select value={env || undefined} placeholder="Choose an environment" onChange={setEnv} options={envs} /></Field>
        : <Field label="Environment key" wide><Input size="md" mono value={env} onChange={setEnv} /></Field>)}
      <Field label="Expires" wide hint="The role binding is deleted once it expires."><Select value={expiry} onChange={setExpiry} options={EXPIRY.map((e) => ({ value: e.value, label: e.label }))} /></Field>
    </Dialog>
  )
}
