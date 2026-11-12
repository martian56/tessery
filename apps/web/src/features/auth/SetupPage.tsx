import { useState } from 'react'
import { useSetupMutation } from '@/api/endpoints/identity'
import { errorMessage } from '@/api/types'
import { setCurrentOrg } from '@/app/currentOrg'
import { Button, Field, Input } from '@/ui'
import { AuthLayout, FormError } from './AuthLayout'
import s from './Auth.module.css'

export function SetupPage() {
  const [setup, { isLoading, error }] = useSetupMutation()
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' })
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await setup(form)
    if ('data' in r && r.data) setCurrentOrg(r.data.orgId)
  }
  return (
    <AuthLayout title="Set up Tessery" subtitle="Create the instance administrator. This account can manage every organization and user on this installation.">
      <form className={s.form} onSubmit={submit}>
        <Field label="Your name" wide><Input size="md" autoFocus value={form.name} onChange={set('name')} /></Field>
        <Field label="Email" wide><Input size="md" type="email" value={form.email} onChange={set('email')} /></Field>
        <Field label="Password" wide hint="At least 10 characters."><Input size="md" type="password" value={form.password} onChange={set('password')} /></Field>
        <Field label="Organization name" wide hint="Your first organization. You can create more later."><Input size="md" value={form.orgName} onChange={set('orgName')} /></Field>
        <FormError message={error ? errorMessage(error) : null} />
        <Button variant="primary" size="md" type="submit" disabled={isLoading || !form.email || !form.password || !form.name || !form.orgName}>{isLoading ? 'Setting up…' : 'Create administrator'}</Button>
      </form>
    </AuthLayout>
  )
}
