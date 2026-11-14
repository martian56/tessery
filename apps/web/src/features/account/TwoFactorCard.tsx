import { useState } from 'react'
import { Copy, ShieldCheck } from 'lucide-react'
import { useTwoFactorDisableMutation, useTwoFactorEnableMutation, useTwoFactorNewCodesMutation, useTwoFactorSetupMutation, useTwoFactorStatusQuery } from '@/api/endpoints/twoFactor'
import { errorMessage } from '@/api/types'
import { Badge, Button, Field, Input, toast } from '@/ui'
import { Card, muted } from '@/features/chrome/PageLayout'

export function TwoFactorCard() {
  const { data: status } = useTwoFactorStatusQuery()
  const [setup, { data: pending, isLoading: starting, reset: clearSetup }] = useTwoFactorSetupMutation()
  const [enable, { isLoading: enabling }] = useTwoFactorEnableMutation()
  const [disable, { isLoading: disabling }] = useTwoFactorDisableMutation()
  const [newCodes] = useTwoFactorNewCodesMutation()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)

  const start = async () => {
    const r = await setup()
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const confirm = async () => {
    const r = await enable({ code })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    setCodes(r.data.recoveryCodes)
    setCode('')
    clearSetup()
  }
  const turnOff = async () => {
    const r = await disable({ password })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    setPassword('')
    setCodes(null)
    toast('Two-factor sign-in is off', 'ok')
  }
  const regenerate = async () => {
    const r = await newCodes({ code })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    setCodes(r.data.recoveryCodes)
    setCode('')
  }
  const copy = () => {
    if (!codes) return
    navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Recovery codes copied', 'ok'), () => toast('Copy failed; select the codes instead', 'err'))
  }

  return (
    <Card title="Two-factor sign-in" actions={status?.enabled ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}>
      {codes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className={muted}>Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone. They are not shown again.</p>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 13, columns: 2, margin: 0 }} aria-label="Recovery codes">{codes.join('\n')}</pre>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button size="sm" icon={<Copy />} onClick={copy}>Copy</Button>
            <Button size="sm" variant="primary" onClick={() => setCodes(null)}>I saved them</Button>
          </div>
        </div>
      )}
      {!codes && !status?.enabled && !pending && (
        <>
          <p className={muted}><ShieldCheck size={11} /> After your password, sign-in also asks for a six digit code from an authenticator app such as 1Password, Google Authenticator or Aegis.</p>
          <div><Button variant="primary" disabled={starting} onClick={start}>Set up</Button></div>
        </>
      )}
      {!codes && pending && (
        <>
          <p className={muted}>Scan this with your authenticator app, then enter the code it shows.</p>
          <div style={{ width: 200, height: 200, background: '#fff', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }} role="img" aria-label="QR code for your authenticator app"
            dangerouslySetInnerHTML={{ __html: pending.qrSvg.replace(/<svg([^>]*?)\swidth="\d+"\s+height="\d+"/, '<svg$1 width="100%" height="100%"') }} />
          <Field label="Or enter this key" wide><Input mono readOnly value={pending.secret.match(/.{1,4}/g)?.join(' ') ?? pending.secret} /></Field>
          <Field label="Code from the app" wide><Input size="md" mono autoFocus value={code} onChange={setCode} placeholder="123456" /></Field>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button variant="primary" disabled={enabling || code.replace(/\s/g, '').length !== 6} onClick={confirm}>Turn on</Button>
            <Button variant="ghost" onClick={() => { clearSetup(); setCode('') }}>Cancel</Button>
          </div>
        </>
      )}
      {!codes && status?.enabled && (
        <>
          <p className={muted}>{status.recoveryCodesLeft} of 10 recovery codes left. Making new ones replaces all the old ones.</p>
          <Field label="Code from the app" wide><Input size="md" mono value={code} onChange={setCode} placeholder="123456" /></Field>
          <div><Button disabled={code.replace(/\s/g, '').length !== 6} onClick={regenerate}>New recovery codes</Button></div>
          <Field label="Password" wide hint="Needed to turn two-factor off."><Input size="md" type="password" value={password} onChange={setPassword} /></Field>
          <div><Button variant="ghost" disabled={disabling || !password} onClick={turnOff}>Turn off</Button></div>
        </>
      )}
    </Card>
  )
}
