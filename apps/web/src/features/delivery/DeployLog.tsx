import { useEffect, useRef, useState } from 'react'
import { CircleCheck, CircleX, ExternalLink, LoaderCircle } from 'lucide-react'
import clsx from 'clsx'
import { useLazyReleaseLogQuery } from '@/api/endpoints/delivery'
import { baseApi } from '@/api/base'
import type { Endpoint, Release } from '@/api/types'
import { useAppDispatch } from '@/store'
import { Badge, Dialog } from '@/ui'
import s from './Delivery.module.css'

interface Line { seq: number; line: string }

const live = (r?: Release) => r?.status === 'queued' || r?.status === 'deploying'

function duration(r: Release): string {
  if (!r.startedAt) return ''
  const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - new Date(r.startedAt).getTime()) / 1000))
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export function DeployLog({ release, onClose }: { release: Release; onClose: () => void }) {
  const dispatch = useAppDispatch()
  const [fetchLog] = useLazyReleaseLogQuery()
  const [lines, setLines] = useState<Line[]>([])
  const [current, setCurrent] = useState<Release>(release)
  const after = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const r = await fetchLog({ id: release.id, after: after.current })
      if (stop) return
      if (r.data) {
        const fresh = r.data.lines
        if (fresh.length) {
          after.current = fresh[fresh.length - 1].seq
          setLines((prev) => [...prev, ...fresh.map((l) => ({ seq: l.seq, line: l.line }))].slice(-5000))
        }
        const wasLive = live(current)
        setCurrent(r.data.release)
        if (wasLive && !live(r.data.release)) dispatch(baseApi.util.invalidateTags(['Pipeline', 'Releases']))
        if (live(r.data.release) || fresh.length === 2000) timer = setTimeout(tick, 1000)
      } else timer = setTimeout(tick, 3000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release.id])

  useEffect(() => {
    const el = box.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])

  const endpoints = (current.endpoints ?? []) as unknown as Endpoint[]
  const icon = live(current) ? <LoaderCircle size={14} className={s.spin} /> : current.status === 'released' ? <CircleCheck size={14} color="var(--ok)" /> : <CircleX size={14} color="var(--err)" />

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} width={860}
      title={<span className={s.logTitle}>{icon} Checkpoint {current.checkpointSeq} to {current.env}</span>}
      description={`${current.checkpointName} · ${current.commit.slice(0, 8)}${current.startedAt ? ` · ${duration(current)}` : ''}`}>
      <div className={s.logMeta}>
        <Badge tone={current.status === 'released' ? 'ok' : current.status === 'failed' ? 'err' : 'info'}>{current.status}</Badge>
        {endpoints.map((e) => <a key={e.url} className={s.endpoint} href={e.url} target="_blank" rel="noreferrer">{e.name} <ExternalLink size={11} /></a>)}
      </div>
      {current.error && <div className={s.logError}>{current.error}</div>}
      <div ref={box} className={s.log} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {!lines.length && <div className={s.muted}>{current.status === 'queued' ? 'Waiting for the runner…' : 'No output yet.'}</div>}
        {lines.map((l) => {
          if (l.line.startsWith('::step::')) return <div key={l.seq} className={s.logStep}>{l.line.slice(8)}</div>
          if (l.line.startsWith('::error::')) return <div key={l.seq} className={clsx(s.logLine, s.logErr)}>{l.line.slice(9)}</div>
          return <div key={l.seq} className={s.logLine}>{l.line}</div>
        })}
      </div>
    </Dialog>
  )
}
