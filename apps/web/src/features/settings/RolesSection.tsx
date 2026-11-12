import { useMemo, useState } from 'react'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCreateRoleMutation, useDeleteRoleMutation, useListRolesQuery, usePermissionCatalogQuery, useUpdateRoleMutation } from '@/api/endpoints/orgs'
import { errorMessage, type PermissionInfo, type Role } from '@/api/types'
import { Badge, Button, Checkbox, Dialog, Field, Input, toast, useDialogs } from '@/ui'
import { PageTitle, Table, mono, muted } from '@/features/chrome/PageLayout'
import type { Perms } from './OrgSettings'
import s from './Settings.module.css'

export function RolesSection({ org, perms }: { org: string; perms: Perms }) {
  const { data: roles } = useListRolesQuery(org)
  const { data: catalog } = usePermissionCatalogQuery()
  const [remove] = useDeleteRoleMutation()
  const dialogs = useDialogs()
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const canManage = perms.can('role:manage')

  const del = async (r: Role) => {
    if (!(await dialogs.confirm({ title: `Delete role ${r.name}?`, body: 'Every grant that uses this role is removed.', ok: 'Delete role', danger: true }))) return
    const res = await remove({ org, role: r.id })
    toast('error' in res ? errorMessage(res.error) : 'Role deleted', 'error' in res ? 'err' : 'ok')
  }

  return (
    <>
      <PageTitle title="Roles" description="A role is a named set of permissions. Built-in roles cannot be changed; create custom roles for anything in between."
        actions={canManage && <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>New role</Button>} />
      <Table head={['Role', 'Key', 'Permissions', '']}>
        {(roles ?? []).map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b> {r.builtin && <Badge><Lock size={9} /> built-in</Badge>}{r.description && <div className={muted}>{r.description}</div>}</td>
            <td className={mono}>{r.key}</td>
            <td className={muted}>{catalog && r.permissions.length === catalog.length ? 'all' : `${r.permissions.length} of ${catalog?.length ?? '?'}`}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <Button variant="ghost" size="xs" icon={<Pencil />} aria-label={r.builtin || !canManage ? `View ${r.name}` : `Edit ${r.name}`} onClick={() => setEditing(r)} />
              {canManage && !r.builtin && <Button variant="ghost" size="xs" icon={<Trash2 />} aria-label={`Delete ${r.name}`} onClick={() => del(r)} />}
            </td>
          </tr>
        ))}
      </Table>
      {editing && catalog && <RoleDialog org={org} role={editing === 'new' ? null : editing} catalog={catalog} readOnly={!canManage || (editing !== 'new' && editing.builtin)} onClose={() => setEditing(null)} />}
    </>
  )
}

function RoleDialog({ org, role, catalog, readOnly, onClose }: { org: string; role: Role | null; catalog: PermissionInfo[]; readOnly: boolean; onClose: () => void }) {
  const [create, { isLoading: creating }] = useCreateRoleMutation()
  const [update, { isLoading: updating }] = useUpdateRoleMutation()
  const [name, setName] = useState(role?.name ?? '')
  const [description, setDescription] = useState(role?.description ?? '')
  const [picked, setPicked] = useState(() => new Set(role?.permissions ?? ['org:read', 'project:read']))
  const groups = useMemo(() => {
    const m = new Map<string, PermissionInfo[]>()
    for (const p of catalog) m.set(p.group, [...(m.get(p.group) ?? []), p])
    return [...m]
  }, [catalog])
  const toggle = (k: string, on: boolean) => setPicked((s0) => { const n = new Set(s0); if (on) n.add(k); else n.delete(k); return n })

  const save = async () => {
    const body = { org, name: name.trim(), description: description.trim(), permissions: [...picked] }
    const r = role ? await update({ ...body, role: role.id }) : await create(body)
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { toast(role ? 'Role updated' : 'Role created', 'ok'); onClose() }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} width={620} title={role ? (readOnly ? role.name : `Edit ${role.name}`) : 'New role'}
      footer={readOnly ? <Button onClick={onClose}>Close</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || picked.size === 0 || creating || updating} onClick={save}>{role ? 'Save role' : 'Create role'}</Button></>}>
      {!readOnly && <>
        <Field label="Name" wide><Input size="md" autoFocus value={name} onChange={setName} placeholder="Release manager" /></Field>
        <Field label="Description" wide><Input size="md" value={description} onChange={setDescription} /></Field>
      </>}
      <div className={s.permGroups}>
        {groups.map(([group, items]) => (
          <div key={group} className={s.permGroup}>
            <div className={s.permGroupTitle}>{group}</div>
            {items.map((p) => (
              <div key={p.key} className={s.permRow}>
                <Checkbox checked={picked.has(p.key)} disabled={readOnly} onChange={(v) => toggle(p.key, v)} label={<span><span className={mono}>{p.key}</span> <span className={muted}>{p.description}</span></span>} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  )
}
