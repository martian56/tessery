import { useEffect, useState } from 'react'
import { useDeleteOrgMutation, useGetOrgQuery, useUpdateOrgMutation } from '@/api/endpoints/orgs'
import { errorMessage } from '@/api/types'
import { navigate } from '@/app/router'
import { Button, Field, Input, toast, useDialogs } from '@/ui'
import { Card, PageTitle } from '@/features/chrome/PageLayout'
import type { Perms } from './OrgSettings'

export function GeneralSection({ org, perms }: { org: string; perms: Perms }) {
  const { data } = useGetOrgQuery(org)
  const [update, { isLoading: saving }] = useUpdateOrgMutation()
  const [remove] = useDeleteOrgMutation()
  const dialogs = useDialogs()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  useEffect(() => { if (data) { setName(data.name); setSlug(data.slug) } }, [data])
  const canEdit = perms.can('org:manage')
  const dirty = !!data && (name !== data.name || slug !== data.slug)

  const save = async () => {
    const r = await update({ org, name: name.trim(), slug: slug.trim() })
    toast('error' in r ? errorMessage(r.error) : 'Organization updated', 'error' in r ? 'err' : 'ok')
  }
  const del = async () => {
    const v = await dialogs.prompt({ title: `Delete ${data?.name}?`, body: 'Every project, team, role and audit record in this organization is removed permanently. Type the organization slug to confirm.', fields: [{ name: 'slug', label: 'Slug', placeholder: data?.slug }], ok: 'Delete organization' })
    if (!v) return
    if (v.slug !== data?.slug) { toast('The slug did not match', 'err'); return }
    const r = await remove(org)
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { toast('Organization deleted', 'ok'); navigate('/') }
  }

  return (
    <>
      <PageTitle title="General" description="Basic details of this organization." />
      <Card title="Details">
        <Field label="Name" wide><Input size="md" value={name} onChange={setName} disabled={!canEdit} /></Field>
        <Field label="Slug" wide hint="Lowercase letters, digits and dashes. Used in URLs and generated resource names."><Input size="md" mono value={slug} onChange={setSlug} disabled={!canEdit} /></Field>
        {canEdit && <div><Button variant="primary" disabled={!dirty || saving || !name.trim()} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button></div>}
      </Card>
      {perms.can('org:delete') && (
        <Card title="Danger zone">
          <p>Deleting the organization cannot be undone.</p>
          <div><Button variant="danger" onClick={del}>Delete organization…</Button></div>
        </Card>
      )}
    </>
  )
}
