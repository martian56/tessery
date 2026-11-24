import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { API_URL } from '@/config/env'
import { CSRF_HEADER } from '@/api/base'
import { useAdminSettingsQuery, usePutAdminSettingsMutation } from '@/api/endpoints/identity'
import { useStartUpdateMutation, useSystemReleasesQuery, useSystemUpdatesQuery, useSystemVersionQuery, VERSION_POLL_MS } from '@/api/endpoints/system'
import { errorMessage } from '@/api/types'
import { Badge, Button, Dialog, Field, Select, Switch, toast, useDialogs } from '@/ui'
import { Card, PageTitle, Table, muted } from '@/features/chrome/PageLayout'
import { ReleaseNotes } from './ReleaseNotes'
import s from './UpdatesView.module.css'

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))

/** The UTC hour as a time in the viewer's own zone, so admins can pick a window without converting by hand. */
function localTime(utcHour: number): string {
  const d = new Date()
  d.setUTCHours(utcHour, 0, 0, 0)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function date(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

type Move = { target: string; kind: 'update' | 'rollback' }

export function UpdatesView() {
  const { data: version, isFetching, refetch } = useSystemVersionQuery(undefined, { pollingInterval: VERSION_POLL_MS })
  const { data: info, refetch: refetchInfo } = useSystemUpdatesQuery()
  const { data: changelog, refetch: refetchReleases } = useSystemReleasesQuery()
  const { data: settings } = useAdminSettingsQuery()
  const [put, { isLoading: saving }] = usePutAdminSettingsMutation()
  const dialogs = useDialogs()
  const [move, setMove] = useState<Move | null>(null)

  const current = version?.current ?? info?.current
  const latest = version?.latest
  const enabled = info?.enabled ?? false
  const saveAuto = async (patch: { autoUpdate?: boolean; autoUpdateFrom?: number; autoUpdateTo?: number }) => {
    const r = await put(patch)
    toast('error' in r ? errorMessage(r.error) : 'Automatic updates saved', 'error' in r ? 'err' : 'ok')
  }
  const rollBack = async (target: string) => {
    const ok = await dialogs.confirm({
      title: `Roll back to ${target}?`,
      body: `The server and worker go back to ${target}. Changes ${current} made to the database stay, so take a backup first if this release changed your data.`,
      ok: 'Roll back',
      danger: true,
    })
    if (ok) setMove({ target, kind: 'rollback' })
  }
  const checkNow = () => { refetch(); refetchInfo(); refetchReleases() }

  return (
    <>
      <PageTitle title="Updates" description="Keep this installation on the latest Tessery release, on a schedule or by hand, and go back if a release causes trouble." />

      <Card title="This installation" actions={version?.updateAvailable ? <Badge tone="accent">Update available</Badge> : latest ? <Badge tone="ok">Up to date</Badge> : null}>
        <dl className={s.facts}>
          <dt>Running</dt>
          <dd className={s.mono}>{current ?? '…'}</dd>
          <dt>Latest release</dt>
          <dd>
            {latest ? <><span className={s.mono}>{latest}</span>{version?.releaseUrl && <a className={s.link} href={version.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>}</>
              : version ? <span className={muted}>GitHub can't be reached, or nothing is released yet</span> : '…'}
          </dd>
        </dl>
        {current === 'dev' && <p className={muted}>This is a development build, so it never offers updates.</p>}
        {info && !enabled && (
          <p className={s.callout}>
            Updating from the app is turned off. Set <code>TESSERY_COMPOSE_DIR</code> to the folder with Tessery's <code>compose.yml</code> and <code>.env</code> (the installer uses <code>/opt/tessery</code>), then restart Tessery.
          </p>
        )}
        <div className={s.actions}>
          {version?.updateAvailable && latest && <Button variant="primary" disabled={!enabled} onClick={() => setMove({ target: latest, kind: 'update' })}>Update to {latest}</Button>}
          <Button variant="ghost" disabled={isFetching} onClick={checkNow}>Check now</Button>
        </div>
      </Card>

      <Card title="Automatic updates" actions={settings?.autoUpdate ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}>
        <Switch checked={!!settings?.autoUpdate} disabled={saving || !settings || !enabled} label="Install new releases automatically" onChange={(v) => saveAuto({ autoUpdate: v })} />
        <p className={muted}>Once a day, inside the window below, Tessery installs the latest release if it's newer. Pre-releases are never installed.</p>
        {settings && (
          <Field label="Window (UTC)" hint={`${localTime(settings.autoUpdateFrom)} to ${localTime(settings.autoUpdateTo)} your time. A window that ends before it starts runs past midnight.`}>
            <div className={s.window}>
              <Select aria-label="Window starts" value={String(settings.autoUpdateFrom)} options={HOURS} disabled={saving} onChange={(v) => saveAuto({ autoUpdateFrom: Number(v) })} />
              <span className={muted}>to</span>
              <Select aria-label="Window ends" value={String(settings.autoUpdateTo)} options={HOURS} disabled={saving} onChange={(v) => saveAuto({ autoUpdateTo: Number(v) })} />
            </div>
          </Field>
        )}
      </Card>

      <Card title="Roll back">
        {info?.rollbackTo ? (
          <>
            <p className={s.text}>Go back to <span className={s.mono}>{info.rollbackTo}</span>, the version this installation ran before <span className={s.mono}>{current}</span>.</p>
            <div className={s.actions}><Button variant="danger" disabled={!enabled} onClick={() => rollBack(info.rollbackTo!)}>Roll back to {info.rollbackTo}</Button></div>
          </>
        ) : <p className={muted}>Nothing to roll back to. After an update, the version it came from shows here.</p>}
      </Card>

      <Card title="History">
        <Table head={['When', 'Change', 'Started by']} empty="No updates yet.">
          {(info?.history ?? []).map((u) => (
            <tr key={`${u.startedAt}-${u.toVersion}`}>
              <td>{new Date(u.startedAt).toLocaleString()}</td>
              <td><span className={s.mono}>{u.fromVersion} → {u.toVersion}</span> {u.kind === 'rollback' && <Badge tone="warn">rollback</Badge>}</td>
              <td>{u.automatic ? <span className={muted}>Automatic</span> : u.startedBy ?? <span className={muted}>Removed user</span>}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Changelog">
        {!changelog ? <p className={muted}>Loading releases…</p>
          : !changelog.releases ? <p className={muted}>GitHub can't be reached right now, so the changelog is unavailable.</p>
          : !changelog.releases.length ? <p className={muted}>No releases yet.</p>
          : (
            <ol className={s.releases}>
              {changelog.releases.map((r) => (
                <li key={r.version} className={s.release}>
                  <header className={s.releaseHead}>
                    <a href={r.url} target="_blank" rel="noreferrer" className={s.releaseName}>{r.name}</a>
                    {r.version === current && <Badge tone="ok">Running</Badge>}
                    {r.prerelease && <Badge>Pre-release</Badge>}
                    <span className={s.releaseDate}>{date(r.publishedAt)}</span>
                  </header>
                  <ReleaseNotes text={r.notes} />
                </li>
              ))}
            </ol>
          )}
      </Card>

      {move && <MoveDialog {...move} onClose={() => { setMove(null); refetchInfo() }} />}
    </>
  )
}

type Step = 'starting' | 'pulling' | 'reconnecting' | 'done'
const GIVE_UP_MS = 5 * 60_000
const POLL_MS = 3000

/** Asks the server to move to `target`, then follows it through the restart until it reports that version. */
function MoveDialog({ target, kind, onClose }: Move & { onClose: () => void }) {
  const [start] = useStartUpdateMutation()
  const [step, setStep] = useState<Step>('starting')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const steps: { id: Step; label: string }[] = [
    { id: 'starting', label: 'Starting' },
    { id: 'pulling', label: 'Pulling images and restarting' },
    { id: 'reconnecting', label: 'Reconnecting' },
    { id: 'done', label: kind === 'update' ? 'Up to date' : `Back on ${target}` },
  ]

  useEffect(() => {
    if (started.current) return
    started.current = true
    let stopped = false
    const run = async () => {
      const r = await start({ version: target })
      if ('error' in r) {
        const status = r.error && 'status' in r.error ? r.error.status : undefined
        setError(status === 404 ? "This server can't update itself from the app yet. Pull the new images on the host and restart Tessery." : errorMessage(r.error))
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
      if (!stopped) setError(`Tessery did not come back on ${target} within ${GIVE_UP_MS / 60_000} minutes. Check \`docker logs tessery-updater\` on the host, then reload this page.`)
    }
    run()
    return () => { stopped = true }
  }, [start, target])

  const at = steps.findIndex((x) => x.id === step)
  return (
    <Dialog open onOpenChange={(o) => { if (!o && (error || step === 'done')) onClose() }} title={kind === 'update' ? `Updating to ${target}` : `Rolling back to ${target}`}
      footer={error ? <Button onClick={onClose}>Close</Button> : undefined}>
      <ol className={s.steps}>
        {steps.map((x, i) => (
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
