import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { useEmailSettingsQuery, useSaveEmailSettingsMutation, useTestEmailMutation, type SmtpSettings } from '@/api/endpoints/email'
import { useMeQuery } from '@/api/endpoints/identity'
import { errorMessage } from '@/api/types'
import { Badge, Button, Field, Input, NumberInput, Segmented, toast } from '@/ui'
import { Card, PageTitle, muted } from '@/features/chrome/PageLayout'

const EMPTY: SmtpSettings = { host: '', port: 587, username: '', from: '', security: 'starttls' }
const PORTS: Record<string, number> = { starttls: 587, tls: 465, none: 25 }

export function EmailView() {
  const { data } = useEmailSettingsQuery()
  const { data: me } = useMeQuery()
  const [save, { isLoading: saving }] = useSaveEmailSettingsMutation()
  const [test, { isLoading: testing }] = useTestEmailMutation()
  const [form, setForm] = useState<SmtpSettings>(EMPTY)
  const [password, setPassword] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => { if (data?.settings) setForm(data.settings) }, [data])
  useEffect(() => { if (me?.email) setTo((t) => t || me.email) }, [me])
  const set = (p: Partial<SmtpSettings>) => setForm({ ...form, ...p })

  const submit = async () => {
    const r = await save({ settings: form, password: password || undefined })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    setPassword('')
    toast('Email settings saved', 'ok')
  }
  const turnOff = async () => {
    const r = await save({ settings: null })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { setForm(EMPTY); toast('Email turned off', 'ok') }
  }
  const sendTest = async () => {
    const r = await test({ to })
    toast('error' in r ? errorMessage(r.error) : `Test email sent to ${to}`, 'error' in r ? 'err' : 'ok')
  }

  return (
    <>
      <PageTitle title="Email" description="Tessery sends password reset links and invitations through this SMTP server. Without it, admins set passwords for new members." />
      <Card title="SMTP server" actions={data?.configured ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}>
        <Field label="Security">
          <Segmented<string> value={form.security} onChange={(v) => set({ security: v, port: PORTS[v] ?? form.port })}
            options={[{ value: 'starttls', label: 'STARTTLS' }, { value: 'tls', label: 'TLS' }, { value: 'none', label: 'None' }]} />
        </Field>
        <Field label="Host"><Input mono value={form.host} onChange={(v) => set({ host: v })} placeholder="smtp.example.com" /></Field>
        <Field label="Port"><NumberInput value={form.port} min={1} max={65535} onCommit={(v) => set({ port: v })} /></Field>
        <Field label="Username"><Input mono value={form.username} onChange={(v) => set({ username: v })} placeholder="optional" /></Field>
        <Field label="Password" hint={data?.hasPassword ? 'Saved. Leave empty to keep it.' : undefined}><Input mono type="password" value={password} onChange={setPassword} /></Field>
        <Field label="From"><Input value={form.from} onChange={(v) => set({ from: v })} placeholder="Tessery <tessery@example.com>" /></Field>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button variant="primary" disabled={saving || !form.host || !form.from} onClick={submit}>Save</Button>
          {data?.configured && <Button variant="ghost" onClick={turnOff}>Turn off</Button>}
        </div>
        {form.security === 'none' && <p className={muted}>None sends without encryption. Use it only for a relay on the same machine.</p>}
      </Card>
      {data?.configured && (
        <Card title="Send a test email">
          <Field label="To"><Input value={to} onChange={setTo} /></Field>
          <div><Button icon={<Send />} disabled={testing || !to} onClick={sendTest}>{testing ? 'Sending…' : 'Send test email'}</Button></div>
        </Card>
      )}
    </>
  )
}
