import { useEffect, useState } from 'react'
import { ChevronRight, GitCommitHorizontal, Plus } from 'lucide-react'
import { useCheckpointDiffQuery, useCheckpointsQuery, useLazyCheckpointDocQuery, usePipelineQuery } from '@/api/endpoints/delivery'
import { useLazyProjectVersionQuery, useProjectVersionsQuery } from '@/api/endpoints/projects'
import { errorMessage, type Checkpoint } from '@/api/types'
import type { ProjectDoc } from '@tessery/core/domain/types'
import { bus } from '@/lib/bus'
import { timeAgo } from '@/lib/format'
import { useAppDispatch, useAppSelector } from '@/store'
import { projectActions } from '@/store/projectSlice'
import { Badge, Button, Dialog, Empty, Field, Input, TabStrip, Textarea, toast, useDialogs } from '@/ui'
import { useCreateCheckpoint } from './useCheckpoint'
import s from './Delivery.module.css'

const ago = (iso: string) => timeAgo(new Date(iso).getTime())
type Tab = 'checkpoints' | 'autosaves'

export function HistoryDialogs() {
  const [history, setHistory] = useState<Tab | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => bus.on('open-history', (tab) => setHistory((tab as Tab | undefined) ?? 'checkpoints')), [])
  useEffect(() => bus.on('new-checkpoint', () => setCreating(true)), [])
  return (
    <>
      {history && <HistoryDialog tab={history} onTab={setHistory} onClose={() => setHistory(null)} onCreate={() => setCreating(true)} />}
      {creating && <NewCheckpointDialog onClose={() => setCreating(false)} />}
    </>
  )
}

function NewCheckpointDialog({ onClose }: { onClose: () => void }) {
  const [create, { isLoading }] = useCreateCheckpoint()
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const submit = async () => {
    if (!name.trim()) return
    if (await create(name.trim(), message.trim())) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New checkpoint" description="Saves the design, generates all code and commits both to the project's git repository. Checkpoints are what you release to environments."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={<GitCommitHorizontal />} disabled={!name.trim() || isLoading} onClick={submit}>{isLoading ? 'Committing…' : 'Create checkpoint'}</Button></>}>
      <Field label="Name" wide><Input size="md" autoFocus value={name} placeholder="Add billing service" onChange={setName} onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
      <Field label="Description" wide hint="Becomes the body of the commit message."><Textarea value={message} onChange={setMessage} rows={4} /></Field>
    </Dialog>
  )
}

function HistoryDialog({ tab, onTab, onClose, onCreate }: { tab: Tab; onTab: (t: Tab) => void; onClose: () => void; onCreate: () => void }) {
  const readOnly = useAppSelector((st) => st.project.readOnly)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="History" width={640}
      footer={<>{!readOnly && <Button icon={<Plus />} onClick={onCreate}>New checkpoint</Button>}<Button onClick={onClose}>Close</Button></>}>
      <TabStrip value={tab} onChange={onTab} tabs={[{ value: 'checkpoints', label: 'Checkpoints' }, { value: 'autosaves', label: 'Autosaves' }]} />
      {tab === 'checkpoints' ? <CheckpointList onClose={onClose} /> : <AutosaveList onClose={onClose} />}
    </Dialog>
  )
}

function useRestore(onClose: () => void) {
  const dispatch = useAppDispatch()
  const dialogs = useDialogs()
  return async (label: string, load: () => Promise<ProjectDoc | null>) => {
    if (!(await dialogs.confirm({ title: `Restore ${label}?`, body: 'The design is replaced with that version and saved as a new version. Undo in the editor brings back what you had.', ok: 'Restore' }))) return
    const doc = await load()
    if (!doc) return
    dispatch(projectActions.replaced(structuredClone(doc)))
    toast(`Restored ${label}`, 'ok')
    onClose()
  }
}

function CheckpointList({ onClose }: { onClose: () => void }) {
  const pid = useAppSelector((st) => st.project.doc!.id)
  const readOnly = useAppSelector((st) => st.project.readOnly)
  const { data, isLoading, error } = useCheckpointsQuery(pid)
  const { data: pipeline } = usePipelineQuery(pid)
  const [fetchDoc] = useLazyCheckpointDocQuery()
  const [open, setOpen] = useState<string | null>(null)
  const restore = useRestore(onClose)

  if (isLoading) return <p className={s.muted}>Loading…</p>
  if (error) return <p>{errorMessage(error)}</p>
  if (!data?.length) return <Empty title="No checkpoints yet">Create one to commit the design and generated code to git.</Empty>
  const runningIn = (c: Checkpoint) => (pipeline?.stages ?? []).filter((st) => st.head?.id === c.id)

  return (
    <div className={s.list}>
      {data.map((c) => (
        <div key={c.id}>
          <div className={s.row}>
            <Button size="xs" variant="ghost" icon={<ChevronRight style={{ transform: open === c.id ? 'rotate(90deg)' : undefined }} />} aria-label="Show changes" onClick={() => setOpen(open === c.id ? null : c.id)} />
            <span className={s.seq}>#{c.seq}</span>
            <div className={s.rowMain}>
              <b>{c.name}</b>
              <span className={s.meta}>{c.author ?? 'unknown'} · {ago(c.createdAt)} · {c.files} files · {c.commit.slice(0, 8)} · design v{c.version}</span>
              {c.message && <span className={s.meta}>{c.message}</span>}
            </div>
            <div className={s.envChips}>{runningIn(c).map((st) => <Badge key={st.key} tone="ok">{st.name}</Badge>)}</div>
            {!readOnly && <Button size="xs" onClick={() => restore(`checkpoint ${c.seq}`, async () => {
              const r = await fetchDoc({ pid, id: c.id })
              if (!r.data) { toast(errorMessage(r.error), 'err'); return null }
              return r.data.doc
            })}>Restore</Button>}
          </div>
          {open === c.id && <DiffView pid={pid} id={c.id} />}
        </div>
      ))}
    </div>
  )
}

function DiffView({ pid, id }: { pid: string; id: string }) {
  const { data, isLoading } = useCheckpointDiffQuery({ pid, id })
  if (isLoading || !data) return <div className={s.row}><span className={s.meta}>Loading changes…</span></div>
  return (
    <div className={s.row} style={{ display: 'block' }}>
      <div className={s.meta}>{data.files.length} file{data.files.length === 1 ? '' : 's'} changed {data.baseSeq ? `since checkpoint ${data.baseSeq}` : 'in the first checkpoint'}</div>
      <div className={s.files}>
        {data.files.map((f) => (
          <div key={f.path} className={s.fileRow}>
            <span>{f.path}</span>
            {f.added === null || f.added === undefined ? <span className={s.meta}>binary</span> : <><span className={s.plus}>+{f.added}</span><span className={s.minus}>-{f.removed}</span></>}
          </div>
        ))}
      </div>
    </div>
  )
}

function AutosaveList({ onClose }: { onClose: () => void }) {
  const id = useAppSelector((st) => st.project.doc!.id)
  const current = useAppSelector((st) => st.project.version)
  const readOnly = useAppSelector((st) => st.project.readOnly)
  const { data, isLoading, error } = useProjectVersionsQuery(id, { refetchOnMountOrArgChange: true })
  const [fetchVersion, { isFetching }] = useLazyProjectVersionQuery()
  const restore = useRestore(onClose)

  if (isLoading) return <p className={s.muted}>Loading…</p>
  if (error) return <p>{errorMessage(error)}</p>
  return (
    <div className={s.list}>
      {(data ?? []).map((v) => (
        <div key={v.version} className={s.row}>
          <span className={s.seq} style={{ color: 'var(--acc)' }}>v{v.version}</span>
          <div className={s.rowMain}>
            <b>{v.message || 'Saved'}</b>
            <span className={s.meta}>{v.author ?? 'unknown'} · {ago(v.createdAt)}</span>
          </div>
          {v.version === current ? <Badge tone="ok">current</Badge>
            : !readOnly && <Button size="xs" disabled={isFetching} onClick={() => restore(`version ${v.version}`, async () => {
              const r = await fetchVersion({ id, version: v.version })
              if (!r.data) { toast(errorMessage(r.error), 'err'); return null }
              return r.data.doc
            })}>Restore</Button>}
        </div>
      ))}
    </div>
  )
}
