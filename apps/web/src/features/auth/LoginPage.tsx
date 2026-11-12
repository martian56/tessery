import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useLoginMutation, useSsoInfoQuery } from '@/api/endpoints/identity'
import { errorMessage } from '@/api/types'
import { API_URL } from '@/config/env'
import { Button, Field, Input } from '@/ui'
import { AuthLayout, FormError } from './AuthLayout'
import s from './Auth.module.css'

export function LoginPage() {
  const [login, { isLoading, error }] = useLoginMutation()
  const { data: sso } = useSsoInfoQuery()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const ssoError = new URLSearchParams(window.location.search).get('sso_error')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    login({ email, password })
  }
  return (
    <AuthLayout title="Sign in">
      <form className={s.form} onSubmit={submit}>
        {sso?.enabled && (
          <>
            <Button size="md" icon={<KeyRound />} onClick={() => { window.location.href = `${API_URL}/auth/sso/start` }}>Sign in with {sso.name}</Button>
            <p className={s.hint}>or with an Tessery password</p>
          </>
        )}
        <Field label="Email" wide><Input size="md" type="email" autoFocus={!sso?.enabled} value={email} onChange={setEmail} /></Field>
        <Field label="Password" wide><Input size="md" type="password" value={password} onChange={setPassword} /></Field>
        <FormError message={error ? errorMessage(error) : ssoError} />
        <Button variant="primary" size="md" type="submit" disabled={isLoading || !email || !password}>{isLoading ? 'Signing in…' : 'Sign in'}</Button>
        <p className={s.hint}>Accounts are created by an organization admin{sso?.enabled ? ', or on your first single sign-on' : ''}. Ask yours to add you.</p>
      </form>
    </AuthLayout>
  )
}
