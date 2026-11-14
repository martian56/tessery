import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useLoginMutation, useSsoInfoQuery } from '@/api/endpoints/identity'
import { useForgotPasswordMutation } from '@/api/endpoints/email'
import { useLoginTwoFactorMutation } from '@/api/endpoints/twoFactor'
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
  const [forgot, setForgot] = useState(false)
  const [sendReset, { isLoading: sending, error: forgotError, isSuccess: sent }] = useForgotPasswordMutation()
  const ssoError = new URLSearchParams(window.location.search).get('sso_error')
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [second, { isLoading: checking, error: codeError }] = useLoginTwoFactorMutation()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await login({ email, password })
    if ('data' in r && r.data && 'twoFactorTicket' in r.data) setTicket(r.data.twoFactorTicket)
  }
  if (ticket) {
    return (
      <AuthLayout title="Two-factor sign-in">
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); second({ ticket, code }) }}>
          <p className={s.hint}>Enter the six digit code from your authenticator app, or one of your recovery codes.</p>
          <Field label="Code" wide><Input size="md" mono autoFocus value={code} onChange={setCode} placeholder="123456" /></Field>
          <FormError message={codeError ? errorMessage(codeError) : null} />
          <Button variant="primary" size="md" type="submit" disabled={checking || code.trim().length < 6}>{checking ? 'Checking…' : 'Sign in'}</Button>
          <Button size="md" variant="ghost" onClick={() => { setTicket(null); setCode(''); setPassword('') }}>Start over</Button>
        </form>
      </AuthLayout>
    )
  }
  if (forgot) {
    return (
      <AuthLayout title="Reset your password">
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); sendReset({ email }) }}>
          {sent
            ? <p className={s.hint}>If {email} has an account, a link to choose a new password is on its way. It works for an hour.</p>
            : <Field label="Email" wide><Input size="md" type="email" autoFocus value={email} onChange={setEmail} /></Field>}
          <FormError message={forgotError ? errorMessage(forgotError) : null} />
          {!sent && <Button variant="primary" size="md" type="submit" disabled={sending || !email}>{sending ? 'Sending…' : 'Email me a link'}</Button>}
          <Button size="md" variant="ghost" onClick={() => setForgot(false)}>Back to sign in</Button>
        </form>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="Sign in">
      <form className={s.form} onSubmit={submit}>
        {sso?.enabled && (
          <>
            <Button size="md" icon={<KeyRound />} onClick={() => { window.location.href = `${API_URL}/auth/sso/start` }}>Sign in with {sso.name}</Button>
            <p className={s.hint}>or with a Tessery password</p>
          </>
        )}
        <Field label="Email" wide><Input size="md" type="email" autoFocus={!sso?.enabled} value={email} onChange={setEmail} /></Field>
        <Field label="Password" wide><Input size="md" type="password" value={password} onChange={setPassword} /></Field>
        <FormError message={error ? errorMessage(error) : ssoError} />
        <Button variant="primary" size="md" type="submit" disabled={isLoading || !email || !password}>{isLoading ? 'Signing in…' : 'Sign in'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setForgot(true)}>Forgot your password?</Button>
        <p className={s.hint}>Accounts are created by an organization admin{sso?.enabled ? ', or on your first single sign-on' : ''}. Ask yours to add you.</p>
      </form>
    </AuthLayout>
  )
}
