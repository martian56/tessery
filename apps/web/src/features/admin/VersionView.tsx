import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { API_URL } from '@/config/env'
import { CSRF_HEADER } from '@/api/base'
import { useStartUpdateMutation, useSystemVersionQuery, VERSION_POLL_MS } from '@/api/endpoints/system'
import { errorMessage } from '@/api/types'
import { Badge, Button, Dialog } from '@/ui'
import { Card, PageTitle, muted } from '@/features/chrome/PageLayout'
import s from './VersionView.module.css'

export function VersionView() {
  const { data, isFetching, refetch } = useSystemVersionQuery(undefined, { pollingInterval: VERSION_POLL_MS })
  const [updating, setUpdating] = useState(false)
  const latest = data?.latest

  return (
    <>
      <PageTitle title="Version" description="The version this installation runs and the latest Tessery release." />
      <Card title="Tessery" actions={data?.updateAvailable ? <Badge tone="accent">Update available</Badge> : data && latest ? <Badge tone="ok">Up to date</Badge> : null}>
        <dl className={s.facts}>
          <dt>Running</dt>
          <dd className={s.mono}>{data?.current ?? '…'}</dd>
          <dt>Latest release</dt>
          <dd>
            {latest ? (
              <><span className={s.mono}>{latest}</span>{data?.releaseUrl && <a className={s.link} href={data.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>}</>
            ) : data ? <span className={muted}>GitHub can't be reached, or nothing is released yet</span> : '…'}
          </dd>
        </dl>
        {data?.current === 'dev' && <p className={muted}>This is a development build, so it never offers updates.</p>}
        <div className={s.actions}>
          {data?.updateAvailable && latest && <Button variant="primary" onClick={() => setUpdating(true)}>Update to {latest}</Button>}
          <Button variant="ghost" disabled={isFetching} onClick={() => refetch()}>Check now</Button>
        </div>
      </Card>
      {updating && latest && <UpdateDialog target={latest} onClose={() => setUpdating(false)} />}
    </>
  )
}

type Step = 'starting' | 'pulling' | 'reconnecting' | 'done'
const STEPS: { id: Step; label: string }[] = [
  { id: 'starting', label: 'Starting' },
  { id: 'pulling', label: 'Pulling images and restarting' },
  { id: 'reconnecting', label: 'Reconnecting' },
  { id: 'done', label: 'Up to date' },
]
const GIVE_UP_MS = 5 * 60_000
const POLL_MS = 3000

/** Asks the server to update itself, then follows it through the restart until it reports the target version. */
function UpdateDialog({ target, onClose }: { target: string; onClose: () => void }) {
  const [start] = useStartUpdateMutation()
  const [step, setStep] = useState<Step>('starting')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    let stopped = false
    const run = async () => {
      const r = await start({ version: target })
      if ('error' in r) {
        const status = 'status' in r.error ? r.error.status : undefined
        setError(status === 404 ? 'This server can't update itself from the app yet. Pull the new images on the host and restart Tessery.' : errorMessage(r.error))
        return
      }
      setStep('pulling')
      const until = Date.now() + GIVE_UP_MS
      let lost = false
      while (!stopped && Date.now() < until) {
        await new Promise((ok) => setTimeout(ok, POLL_MS))
        try {
          const res = await fetch(`${API_URL}/system/version`, { credentials: 'include', headers: { [CSRF_HEADER]: '1' }, cache: 'no-store' })
          if (!res.ok) throw new Error(String(res.status))
          const v = (await res.json()) as { current: string }
          if (v.current === target) {
            setStep('done')
            setTimeout(() => window.location.reload(), 1200)
            return
          }
          if (lost) setStep('reconnecting')
        } catch {
          // The server is restarting, so failed requests are expected here.
          lost = true
          setStep('reconnecting')
        }
      }
      if (!stopped) setError(`Tessery did not come back on ${target} within ${GIVE_UP_MS / 60_000} minutes. Check the server logs, then reload this page.`)
    }
    run()
    return () => { stopped = true }
  }, [start, target])

  const at = STEPS.findIndex((x) => x.id === step)
  return (
    <Dialog open onOpenChange={(o) => { if (!o && (error || step === 'done')) onClose() }} title={`Updating to ${target}`}
      footer={error ? <Button onClick={onClose}>Close</Button> : undefined}>
      <ol className={s.steps}>
        {STEPS.map((x, i) => (
          <li key={x.id} className={i < at || step === 'done' ? s.past : i === at ? s.now : s.next}>
            <span className={s.mark}>{i < at || step === 'done' ? <Check /> : i === at && !error ? <Loader2 className={s.spin} /> : null}</span>
            {x.label}
          </li>
        ))}
      </ol>
      {error && <p className={s.error} role="alert">{error}</p>}
    </Dialog>
  )
}
