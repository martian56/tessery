import { useState } from 'react'
import { ArrowRight, Check, ChevronDown, CircleX, Clock, ExternalLink, GitCommitHorizontal, LoaderCircle, Plus, RotateCw, ScrollText, Square, X } from 'lucide-react'
import clsx from 'clsx'
import { useCheckpointsQuery, useCreateReleaseMutation, useDecideReleaseMutation, usePipelineQuery, useReleasesQuery, useStopEnvMutation } from '@/api/endpoints/delivery'
import { useMeQuery } from '@/api/endpoints/identity'
import { errorMessage, type Checkpoint, type Endpoint, type Release, type Stage } from '@/api/types'
import { usePermissions } from '@/app/usePermissions'
import { useAppDispatch, useAppSelector, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { Badge, Button, DropdownMenu, Empty, Tooltip, toast, useDialogs } from '@/ui'
import { bus } from '@/lib/bus'
import { timeAgo } from '@/lib/format'
import { DeployLog } from './DeployLog'
import s from './Delivery.module.css'

const ago = (iso: string) => timeAgo(new Date(iso).getTime())
const TARGET: Record<string, string> = { docker: 'Docker', kubernetes: 'Kubernetes', git: 'git only' }

export function PipelineBoard() {
  const pid = useAppSelector((st) => st.project.doc!.id)
  const [fast, setFast] = useState(false)
  const { data, isLoading, error } = usePipelineQuery(pid, { pollingInterval: fast ? 2000 : 10_000 })
  const { data: checkpoints } = useCheckpointsQuery(pid)
  const { data: releases } = useReleasesQuery(pid, { pollingInterval: fast ? 2000 : 10_000 })
  const [log, setLog] = useState<Release | null>(null)
  const busy = !!data?.stages.some((st) => st.active)
  if (busy !== fast) setFast(busy)

  if (isLoading) return <div className={s.muted}>Loading pipeline…</div>
  if (error) return <div className={s.muted}>{errorMessage(error)}</div>
  if (!data?.stages.length) return <Empty title="No environments">Add an environment to start releasing.</Empty>
  if (!checkpoints?.length) {
    return (
      <Empty title="No checkpoints yet" action={<Button variant="primary" icon={<GitCommitHorizontal />} onClick={() => bus.emit('new-checkpoint')}>Create checkpoint</Button>}>
        A checkpoint commits the saved design and all generated code to the project's git repository. Checkpoints are what you release.
      </Empty>
    )
  }
  return (
    <div className={s.board}>
      {data.stages.map((st, i) => (
        <div key={st.key} className={s.column}>
          {i > 0 && <ArrowRight className={s.arrow} size={14} />}
          <StageCard pid={pid} stage={st} first={i === 0} previous={data.stages[i - 1]} checkpoints={checkpoints} latest={releases?.find((r) => r.env === st.key)} onLog={setLog} />
        </div>
      ))}
      {log && <DeployLog release={log} onClose={() => setLog(null)} />}
    </div>
  )
}

function StageCard({ pid, stage, first, previous, checkpoints, latest, onLog }: { pid: string; stage: Stage; first: boolean; previous?: Stage; checkpoints: Checkpoint[]; latest?: Release; onLog: (r: Release) => void }) {
  const dispatch = useAppDispatch()
  const dialogs = useDialogs()
  const org = useAppSelector((st) => st.project.orgId) ?? undefined
  const selected = useUi((u) => u.envId) === stage.key
  const perms = usePermissions({ org, project: pid, env: stage.key })
  const { data: me } = useMeQuery()
  const [release, { isLoading: releasing }] = useCreateReleaseMutation()
  const [decide, { isLoading: deciding }] = useDecideReleaseMutation()
  const [stopEnv, { isLoading: stopping }] = useStopEnvMutation()
  const canRun = perms.can('deployment:run')
  const canApprove = perms.can('deployment:approve')

  const send = async (cp: Checkpoint) => {
    let note = ''
    if (stage.requiresApproval) {
      const v = await dialogs.prompt({ title: `Request release of checkpoint ${cp.seq} to ${stage.name}`, body: `${stage.name} requires approval from someone else with deployment:approve.`, fields: [{ name: 'note', label: 'Note for the approver', placeholder: 'What changed and why it is safe' }], ok: 'Request approval' })
      if (!v) return
      note = v.note
    }
    const r = await release({ pid, env: stage.key, checkpointId: cp.id, note })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else if (r.data.status === 'queued') onLog(r.data)
    else toast(r.data.status === 'pending' ? `Waiting for approval to release to ${stage.name}` : `${stage.name} now runs checkpoint ${cp.seq}`, 'ok')
  }
  const verdict = async (v: 'approve' | 'reject' | 'cancel') => {
    const p = stage.pending!
    let note = ''
    if (v !== 'cancel') {
      const r = await dialogs.prompt({ title: `${v === 'approve' ? 'Approve' : 'Reject'} release to ${stage.name}`, body: `Checkpoint ${p.checkpointSeq} "${p.checkpointName}", requested by ${p.requester ?? 'unknown'}.${p.note ? ` Note: ${p.note}` : ''}`, fields: [{ name: 'note', label: 'Comment', placeholder: 'Optional' }], ok: v === 'approve' ? 'Approve and release' : 'Reject' })
      if (!r) return
      note = r.note
    }
    const r = await decide({ id: p.id, verdict: v, note })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else if (r.data.status === 'queued') onLog(r.data)
    else toast(v === 'approve' ? `${stage.name} now runs checkpoint ${p.checkpointSeq}` : v === 'reject' ? 'Release rejected' : 'Request cancelled', 'ok')
  }

  const stop = async () => {
    const ok = await dialogs.confirm({ title: `Stop ${stage.name}?`, body: `Every container ${stage.name} runs is stopped, so it uses no resources. Databases keep their data, and releasing a checkpoint starts it again.`, ok: 'Stop', danger: true })
    if (!ok) return
    const r = await stopEnv({ pid, env: stage.key })
    toast('error' in r ? errorMessage(r.error) : `${stage.name} is stopping`, 'error' in r ? 'err' : 'ok')
  }
  const redeploy = async () => {
    if (!stage.head) return
    const r = await release({ pid, env: stage.key, checkpointId: stage.head.id, note: 'redeploy', redeploy: true })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else if (r.data.status === 'queued') onLog(r.data)
    else toast(r.data.status === 'pending' ? `Redeploy of ${stage.name} is waiting for approval` : `${stage.name} redeployed`, 'ok')
  }
  const head = stage.head
  const pending = stage.pending
  const active = stage.active
  const endpoints = (stage.endpoints ?? []) as unknown as Endpoint[]
  const failed = latest?.status === 'failed' ? latest : undefined
  const mine = pending?.requestedBy === me?.id
  const others = first ? checkpoints.filter((c) => c.id !== head?.id && c.id !== stage.candidate?.id) : []

  return (
    <div className={clsx(s.card, selected && s.selected)} onClick={() => dispatch(ui.setEnv(stage.key))}>
      <div className={s.cardHead}>
        <button className={s.cardTitle} aria-pressed={selected} onClick={(e) => { e.stopPropagation(); dispatch(ui.setEnv(stage.key)) }}>{stage.name}</button>
        <Badge mono>{TARGET[stage.target] ?? stage.target}</Badge>
        {stage.requiresApproval && <Badge tone="warn">approval</Badge>}
      </div>
      {head ? (
        <div className={s.running}>
          <span className={s.seq}>#{head.seq}</span>
          <div><div className={s.cpName}>{head.name}</div><div className={s.meta}>{head.commit.slice(0, 8)} · {stage.releasedAt ? ago(stage.releasedAt) : ''}</div></div>
        </div>
      ) : <div className={s.meta}>Nothing released yet</div>}
      {(endpoints.length > 0 || (head && stage.target !== 'git')) && (
        <div className={s.links} onClick={(e) => e.stopPropagation()}>
          {endpoints.map((e) => <a key={e.url} className={s.endpoint} href={e.url} target="_blank" rel="noreferrer">{e.name} <ExternalLink size={11} /></a>)}
          {head && stage.target !== 'git' && !active && !pending && canRun && <Tooltip content="Deploy the same checkpoint again, for example after changing a secret"><span><Button size="xs" variant="ghost" icon={<RotateCw />} disabled={releasing} onClick={redeploy}>Redeploy</Button></span></Tooltip>}
          {head && stage.target !== 'git' && !active && canRun && <Button size="xs" variant="ghost" icon={<Square />} disabled={stopping} onClick={stop}>Stop</Button>}
        </div>
      )}

      {active && (
        <div className={s.deploying} onClick={(e) => e.stopPropagation()}>
          <div className={s.deployingHead}><LoaderCircle size={12} className={s.spin} /> {active.status === 'queued' ? 'Waiting for the runner' : 'Deploying'} checkpoint {active.checkpointSeq}</div>
          <div className={s.actions}><Button size="xs" icon={<ScrollText />} onClick={() => onLog(active)}>View log</Button></div>
        </div>
      )}
      {!active && failed && (
        <div className={s.failed} onClick={(e) => e.stopPropagation()}>
          <CircleX size={12} /> Deploy of #{failed.checkpointSeq} failed
          <Button size="xs" variant="ghost" icon={<ScrollText />} onClick={() => onLog(failed)}>Log</Button>
        </div>
      )}

      {pending && (
        <div className={s.pending} onClick={(e) => e.stopPropagation()}>
          <div className={s.pendingHead}><Clock size={12} /> Checkpoint {pending.checkpointSeq} waiting for approval</div>
          <div className={s.meta}>requested by {pending.requester ?? 'unknown'} · {ago(pending.requestedAt)}</div>
          {pending.note && <div className={s.note}>{pending.note}</div>}
          <div className={s.actions}>
            {canApprove && (!mine || perms.bypass) && <Button size="xs" variant="primary" icon={<Check />} disabled={deciding} onClick={() => verdict('approve')}>Approve</Button>}
            {canApprove && !mine && <Button size="xs" icon={<X />} disabled={deciding} onClick={() => verdict('reject')}>Reject</Button>}
            {mine && <Button size="xs" variant="ghost" disabled={deciding} onClick={() => verdict('cancel')}>Cancel request</Button>}
            {!canApprove && !mine && <span className={s.meta}>Needs someone with deployment:approve</span>}
          </div>
        </div>
      )}

      {!pending && !active && (stage.candidate || others.length > 0) && (
        <div className={s.actions} onClick={(e) => e.stopPropagation()}>
          {stage.candidate && (
            <Tooltip content={canRun ? (first ? 'Release the latest checkpoint' : `Promote what ${previous?.name} runs`) : 'You are not allowed to release to this environment'}>
              <span>
                <Button size="xs" variant="primary" disabled={!canRun || releasing} onClick={() => send(stage.candidate!)}>
                  {first ? 'Release' : 'Promote'} #{stage.candidate.seq}{stage.requiresApproval ? ' for approval' : ''}
                </Button>
              </span>
            </Tooltip>
          )}
          {others.length > 0 && canRun && (
            <DropdownMenu align="start" trigger={<Button size="xs" variant="ghost" icon={<ChevronDown />}>Other checkpoint</Button>}
              items={others.slice(0, 20).map((c) => ({ label: `#${c.seq} ${c.name}`, onSelect: () => send(c) }))} />
          )}
        </div>
      )}
      {!head && !stage.candidate && !pending && !active && !first && <div className={s.meta}>Waiting for {previous?.name}</div>}
    </div>
  )
}

export function NewCheckpointButton() {
  return <Button size="sm" icon={<Plus />} onClick={() => bus.emit('new-checkpoint')}>New checkpoint</Button>
}
