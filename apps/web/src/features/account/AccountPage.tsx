import { useEffect, useState } from 'react'
import { KeyRound, User } from 'lucide-react'
import { useChangePasswordMutation, useMeQuery, useUpdateMeMutation } from '@/api/endpoints/identity'
import { errorMessage } from '@/api/types'
import { Button, Field, Input, toast } from '@/ui'
import { Card, PageLayout, PageTitle, muted } from '@/features/chrome/PageLayout'
import { TokensCard } from './TokensCard'

export function AccountPage() {
  const { data: me } = useMeQuery()
  const [updateMe, { isLoading: saving }] = useUpdateMeMutation()
  const [changePassword, { isLoading: changing }] = useChangePasswordMutation()
  const [name, setName] = useState('')
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  useEffect(() => { if (me) setName(me.name) }, [me])

  const saveName = async () => {
    const r = await updateMe({ name: name.trim() })
    toast('error' in r ? errorMessage(r.error) : 'Profile saved', 'error' in r ? 'err' : 'ok')
  }
  const savePassword = async () => {
    if (pw.next !== pw.confirm) { toast('The new passwords do not match', 'err'); return }
    const r = await changePassword({ currentPassword: pw.current, newPassword: pw.next })
    if ('error' in r) { toast(errorMessage(r.error), 'err'); return }
    setPw({ current: '', next: '', confirm: '' })
    toast('Password changed. Other sessions were signed out.', 'ok')
  }

  return (
    <PageLayout title="Account" nav={[{ id: 'profile', label: 'Profile', icon: <User /> }]} active="profile" base="/account">
      <PageTitle title="Your account" description={me ? <>Signed in as <b>{me.email}</b>{me.instanceAdmin ? ', instance administrator' : ''}.</> : undefined} />
      <Card title="Profile">
        <Field label="Name" wide><Input size="md" value={name} onChange={setName} /></Field>
        <div><Button variant="primary" disabled={saving || !name.trim() || name === me?.name} onClick={saveName}>Save</Button></div>
      </Card>
      <Card title="Password">
        <p className={muted}><KeyRound size={11} /> Changing your password signs out every other session.</p>
        <Field label="Current password" wide><Input size="md" type="password" value={pw.current} onChange={(v) => setPw((p) => ({ ...p, current: v }))} /></Field>
        <Field label="New password" wide hint="At least 10 characters."><Input size="md" type="password" value={pw.next} onChange={(v) => setPw((p) => ({ ...p, next: v }))} /></Field>
        <Field label="Repeat new password" wide><Input size="md" type="password" value={pw.confirm} onChange={(v) => setPw((p) => ({ ...p, confirm: v }))} /></Field>
        <div><Button variant="primary" disabled={changing || !pw.current || !pw.next} onClick={savePassword}>Change password</Button></div>
      </Card>
      <TokensCard />
    </PageLayout>
  )
}
