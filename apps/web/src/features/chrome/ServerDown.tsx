import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Database, Globe, Monitor, Server } from 'lucide-react'
import { API_URL } from '@/config/env'
import { Button } from '@/ui'
import { TesseryMark } from '@/ui/TesseryMark'
import auth from '@/features/auth/Auth.module.css'
import s from './ServerDown.module.css'

/** Seconds to wait before each automatic retry; the last one repeats. */
const BACKOFF = [3, 5, 10, 20, 30]

const PARTS: Record<string, string> = { database: 'Postgres', redis: 'Redis', queue: 'RabbitMQ', engine: 'the code generation engine' }

type Failure = { kind: 'network' } | { kind: 'gateway' } | { kind: 'checking'; status: number } | { kind: 'server'; status: number; down: string[] }

function describe(error: unknown): Failure {
  const status = (error as { status?: number | string })?.status
  if (typeof status !== 'number') return { kind: 'network' }
  if (status === 502 || status === 504) return { kind: 'gateway' }
  return { kind: 'checking', status }
}

/** Which of Tessery's own services the server says are down, or null when the server itself doesn't answer, which a
 * proxy in front of it may report as a plain 500. */
async function downParts(): Promise<string[] | null> {
  try {
    const r = await fetch(`${API_URL}/health`, { cache: 'no-store' })
    const h = (await r.json()) as Record<string, unknown>
    if (typeof h.database !== 'boolean') return null
    return Object.keys(PARTS).filter((k) => h[k] === false).map((k) => PARTS[k])
  } catch {
    return null
  }
}

type State = 'ok' | 'down' | 'unknown'

/** The path a request takes, coloured by what this page could find out, so the break shows where it is. */
function Path({ failure, host }: { failure: Failure; host: string }) {
  const proxy: State = failure.kind === 'network' ? 'unknown' : 'ok'
  const server: State = failure.kind === 'network' || failure.kind === 'checking' ? 'unknown' : failure.kind === 'gateway' ? 'down' : failure.down.length ? 'ok' : 'down'
  const parts = Object.values(PARTS).map((name) => ({
    name: name === 'the code generation engine' ? 'Engine' : name,
    state: (failure.kind === 'server' ? (failure.down.includes(name) ? 'down' : 'ok') : 'unknown') as State,
  }))
  const link = (a: State, b: State): State => (a === 'down' || b === 'down' ? 'down' : a === 'ok' && b === 'ok' ? 'ok' : 'unknown')
  const hops: { icon: ReactNode; label: string; detail: string; state: State }[] = [
    { icon: <Monitor />, label: 'This browser', detail: 'online', state: 'ok' },
    { icon: <Globe />, label: host, detail: proxy === 'ok' ? 'answers' : 'no answer', state: proxy },
    { icon: <Server />, label: 'Tessery server', detail: server === 'ok' ? 'running' : failure.kind === 'server' ? `error ${failure.status}` : server === 'down' ? 'not answering' : failure.kind === 'checking' ? 'checking…' : 'unknown', state: server },
  ]
  return (
    <figure className={s.path} aria-label="Where the connection stops">
      <ol className={s.hops}>
        {hops.map((h, i) => (
          <li key={h.label} className={s.hopWrap}>
            {i > 0 && <span className={s.link} data-state={link(hops[i - 1].state, h.state)} aria-hidden />}
            <div className={s.hop} data-state={h.state}>
              <span className={s.hopIcon}>{h.icon}</span>
              <span className={s.hopLabel} title={h.label}>{h.label}</span>
              <span className={s.hopDetail}>{h.detail}</span>
            </div>
          </li>
        ))}
      </ol>
      <div className={s.parts} data-state={failure.kind === 'server' ? 'ok' : 'unknown'}>
        {parts.map((p) => (
          <span key={p.name} className={s.part} data-state={p.state}><Database aria-hidden />{p.name}</span>
        ))}
      </div>
    </figure>
  )
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Shown in place of the app when the Tessery server doesn't answer. It keeps trying on its own and lets the app carry
 * on as soon as the server is back. */
export function ServerDown({ error, retry }: { error: unknown; retry: () => Promise<unknown> }) {
  const [failure, setFailure] = useState<Failure>(() => describe(error))
  const [attempt, setAttempt] = useState(0)
  const [wait, setWait] = useState(BACKOFF[0])
  const [checking, setChecking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const f = describe(error)
    setFailure(f)
    if (f.kind !== 'checking') return
    let live = true
    downParts().then((down) => { if (live) setFailure(down ? { kind: 'server', status: f.status, down } : { kind: 'gateway' }) })
    return () => { live = false }
  }, [error])

  const check = useCallback(async () => {
    clearTimeout(timer.current)
    setChecking(true)
    await retry()
    setChecking(false)
    setAttempt((a) => a + 1)
  }, [retry])

  // Count down to the next automatic try; a successful one replaces this screen with the app.
  useEffect(() => {
    if (checking) return
    let left = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]
    setWait(left)
    const tick = () => {
      left -= 1
      if (left <= 0) return void check()
      setWait(left)
      timer.current = setTimeout(tick, 1000)
    }
    timer.current = setTimeout(tick, 1000)
    return () => clearTimeout(timer.current)
  }, [attempt, checking, check])

  const host = window.location.host
  const title = failure.kind !== 'server' ? "Tessery isn't answering"
    : failure.down.length ? `${failure.down[0] === 'Postgres' ? 'The database' : 'Part of Tessery'} isn't answering`
    : 'Tessery ran into a problem'
  const body = failure.kind === 'network'
    ? <>Your browser couldn't connect to <b>{host}</b>. If your internet connection works, the Tessery server is restarting, perhaps after an update, or it has stopped.</>
    : failure.kind === 'gateway'
      ? <>The address <b>{host}</b> answers, but the Tessery server behind it doesn't. It's most likely restarting, perhaps after an update, or it has stopped.</>
      : failure.kind === 'checking'
        ? <>The Tessery server answered with an error ({failure.status}). Checking which part of it is down…</>
        : failure.down.length
        ? <>The Tessery server is running, but it can't reach {list(failure.down)}, so it can't open your workspace yet.</>
        : <>The Tessery server answered with an error ({failure.status}) before it could open your workspace.</>

  return (
    <div className={auth.page}>
      <main className={`${auth.card} ${s.card}`} aria-labelledby="server-down-title">
        <div className={auth.brand}><TesseryMark size={22} />Tessery</div>
        <div className={s.head}>
          <h1 id="server-down-title" className={auth.title}>{title}</h1>
          <p className={s.body}>{body}</p>
        </div>
        <Path failure={failure} host={host} />
        <div className={s.retry} role="status" aria-live="polite">
          <span className={s.dot} data-checking={checking || undefined} aria-hidden />
          <span className={s.when}>{checking ? 'Checking…' : `Trying again in ${wait} s`}</span>
          <Button size="sm" disabled={checking} onClick={check}>Try now</Button>
        </div>
        <p className={s.note}>Nothing you were working on is lost. Saved changes are on the server, and this page carries on by itself once it answers.</p>
        <details className={s.admin}>
          <summary>If you run this installation</summary>
          <p>On the server, in the folder with Tessery's <code>compose.yml</code> (usually <code>/opt/tessery</code>):</p>
          <pre><code>{'docker compose ps\ndocker compose logs --tail 50 server'}</code></pre>
          <p>Right after an update, <code>docker logs tessery-updater</code> shows how it went.</p>
        </details>
      </main>
    </div>
  )
}
