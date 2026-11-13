import { useState } from 'react'
import { usePasswordTokenQuery, useResetPasswordMutation } from '@/api/endpoints/email'
import { errorMessage } from '@/api/types'
import { Button, Field, Input } from '@/ui'
import { AuthLayout, FormError } from './AuthLayout'
import s from './Auth.module.css'

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const { data: info, error: invalid, isLoading } = usePasswordTokenQuery(token, { skip: !token })
  const [reset, { isLoading: saving, error }] = useResetPasswordMutation()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [done, setDone] = useState(false)
  const toSignIn = () => { window.location.href = '/' }

  if (!token || invalid) {
    return (
      <AuthLayout title="This link does not work">
        <div className={s.form}>
          <p className={s.hint}>It was already used or has expired. Ask for a new one from the sign-in page.</p>
          <Button variant="primary" size="md" onClick={toSignIn}>Go to sign in</Button>
        </div>
      </AuthLayout>
    )
  }
  if (done) {
    return (
      <AuthLayout title="Password saved">
        <div className={s.form}>
          <p className={s.hint}>Sign in with your new password. Other sessions of this account were signed out.</p>
          <Button variant="primary" size="md" onClick={toSignIn}>Sign in</Button>
        </div>
      </AuthLayout>
    )
  }
  const mismatch = again.length > 0 && again !== password
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = await reset({ token, password })
    if (!('error' in r)) setDone(true)
  }
  return (
    <AuthLayout title={info?.purpose === 'invite' ? 'Welcome to Tessery' : 'Choose a new password'}>
      <form className={s.form} onSubmit={submit}>
        <p className={s.hint}>{isLoading ? 'Checking the link…' : `For ${info?.email}. Use at least 10 characters.`}</p>
        <Field label="New password" wide><Input size="md" type="password" autoFocus value={password} onChange={setPassword} /></Field>
        <Field label="Repeat it" wide><Input size="md" type="password" value={again} onChange={setAgain} /></Field>
        <FormError message={mismatch ? 'The passwords are different' : error ? errorMessage(error) : null} />
        <Button variant="primary" size="md" type="submit" disabled={saving || password.length < 10 || mismatch || !again}>{saving ? 'Saving…' : 'Save password'}</Button>
      </form>
    </AuthLayout>
  )
}
