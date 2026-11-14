import { useEffect, useState } from 'react'
import { Download, Github, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useCheckpointsQuery, useDeleteRemoteMutation, usePushRemoteMutation, usePutRemoteMutation, useRemoteQuery } from '@/api/endpoints/delivery'
import { errorMessage } from '@/api/types'
import { useGithubReposQuery, useLinkGithubMutation } from '@/api/endpoints/github'
import { useProjectPermissions } from '@/app/useProjectPermissions'
import { API_URL } from '@/config/env'
import { bus } from '@/lib/bus'
import { timeAgo } from '@/lib/format'
import { useAppSelector } from '@/store'
import { useMeQuery } from '@/api/endpoints/identity'
import { Button, Dialog, Dot, Field, Input, Select, Switch, toast, useDialogs } from '@/ui'
import s from './Delivery.module.css'

export function RepositoryDialog() {
  const [open, setOpen] = useState(false)
  useEffect(() => bus.on('open-repository', () => setOpen(true)), [])
  return open ? <Repository onClose={() => setOpen(false)} /> : null
}

function Repository({ onClose }: { onClose: () => void }) {
  const doc = useAppSelector((st) => st.project.doc!)
  const perms = useProjectPermissions()
  const dialogs = useDialogs()
  const { data: remote, isLoading } = useRemoteQuery(doc.id, { pollingInterval: 4000 })
  const { data: checkpoints } = useCheckpointsQuery(doc.id)
  const [put, { isLoading: saving }] = usePutRemoteMutation()
  const [del] = useDeleteRemoteMutation()
  const [push, { isLoading: pushing }] = usePushRemoteMutation()
  const [form, setForm] = useState({ url: '', username: '', token: '', autoPush: true })
  useEffect(() => { if (remote) setForm({ url: remote.url, username: remote.username, token: '', autoPush: remote.autoPush }) }, [remote])
  const canConfigure = perms.can('secret:write')
  const empty = !checkpoints?.length

  const save = async () => {
    const r = await put({ pid: doc.id, url: form.url.trim(), username: form.username.trim(), token: form.token ? form.token : undefined, autoPush: form.autoPush })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else { setForm((f) => ({ ...f, token: '' })); toast('Remote saved', 'ok') }
  }
  const pushNow = async () => {
    const r = await push(doc.id)
    toast('error' in r ? errorMessage(r.error) : 'Push queued', 'error' in r ? 'err' : 'ok')
  }
  const disconnect = async () => {
    if (!(await dialogs.confirm({ title: 'Disconnect the remote?', body: 'Tessery stops pushing to it and forgets the token. Nothing is deleted on the remote.', ok: 'Disconnect', danger: true }))) return
    const r = await del(doc.id)
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else setForm({ url: '', username: '', token: '', autoPush: true })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Git repository" width={560} footer={<Button onClick={onClose}>Close</Button>}>
      <p className={s.muted}>
        Developers work on <b>main</b>. Each checkpoint merges what Tessery generated (kept on <b>tessery/generated</b>) into main and is tagged <b>checkpoint/N</b>. Each environment has a branch <b>env/&lt;id&gt;</b> pointing at the checkpoint it runs.
      </p>
      <div className={s.clone}>git clone {window.location.origin}/git/{doc.id}.git {doc.name}</div>
      <p className={s.muted}>Sign in with any username and an API token from your account page as the password. Run it locally with <b>docker compose up --build</b>, push your changes to main, then create a checkpoint here.</p>
      <div className={s.actions}>
        <Button icon={<Download />} disabled={empty} onClick={() => { window.location.href = `${API_URL}/projects/${doc.id}/repository.bundle` }}>Download repository</Button>
        {empty && <span className={s.meta}>Create a checkpoint first.</span>}
      </div>

      <h3 style={{ fontSize: 'var(--fs-13)', marginTop: 8 }}>Remote</h3>
      {remote?.githubRepo ? <GithubLinked repo={remote.githubRepo} remote={remote} canConfigure={canConfigure} onSync={pushNow} syncing={pushing} onUnlink={disconnect} />
        : canConfigure && <GithubLink pid={doc.id} />}
      {!remote?.githubRepo && (isLoading ? <p className={s.muted}>Loading…</p> : <>
        <p className={s.muted}>Or push to any git host with a URL and token:</p>
        {remote && (
          <div className={s.status}>
            <Dot color={remote.lastPushOk === false ? 'var(--err)' : remote.lastPushOk ? 'var(--ok)' : 'var(--tx-3)'} />
            {remote.lastPushAt ? (remote.lastPushOk ? `Pushed ${timeAgo(new Date(remote.lastPushAt).getTime())}` : `Push failed ${timeAgo(new Date(remote.lastPushAt).getTime())}: ${remote.lastPushError}`) : 'Not pushed yet'}
          </div>
        )}
        <Field label="URL" wide hint="HTTPS clone URL of an empty repository, for example on GitHub, GitLab or Gitea."><Input size="md" mono value={form.url} placeholder="https://github.com/acme/shop.git" disabled={!canConfigure} onChange={(v) => setForm((f) => ({ ...f, url: v }))} /></Field>
        <Field label="Username" wide hint="GitHub accepts any name with a token. GitLab expects oauth2 or your username."><Input size="md" value={form.username} placeholder="x-access-token" disabled={!canConfigure} onChange={(v) => setForm((f) => ({ ...f, username: v }))} /></Field>
        <Field label="Access token" wide hint={remote?.hasToken ? 'A token is stored, encrypted. Leave empty to keep it.' : 'Needs permission to push. Stored encrypted.'}><Input size="md" type="password" value={form.token} disabled={!canConfigure} onChange={(v) => setForm((f) => ({ ...f, token: v }))} /></Field>
        <Switch checked={form.autoPush} disabled={!canConfigure} label="Push after every checkpoint and release" onChange={(v) => setForm((f) => ({ ...f, autoPush: v }))} />
        <div className={s.actions}>
          {canConfigure && <Button variant="primary" disabled={!form.url.trim() || saving} onClick={save}>{remote ? 'Save remote' : 'Connect remote'}</Button>}
          {remote && <Button icon={<Upload />} disabled={pushing || empty} onClick={pushNow}>Push now</Button>}
          {remote && canConfigure && <Button variant="ghost" icon={<Trash2 />} onClick={disconnect}>Disconnect</Button>}
          {!canConfigure && <span className={s.meta}>Changing the remote needs secret:write.</span>}
        </div>
      </>)}
    </Dialog>
  )
}

type RemoteView = { lastPushAt?: string | null; lastPushOk?: boolean | null; lastPushError?: string | null; lastImportAt?: string | null; lastImportError?: string | null }

function GithubLinked({ repo, remote, canConfigure, onSync, syncing, onUnlink }: { repo: string; remote: RemoteView; canConfigure: boolean; onSync: () => void; syncing: boolean; onUnlink: () => void }) {
  const when = (iso?: string | null) => (iso ? timeAgo(new Date(iso).getTime()) : null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className={s.status}><Github size={14} /> Linked to <a href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer"><b>{repo}</b></a></div>
      <p className={s.muted}>Pushes to main on GitHub become checkpoints. Checkpoints made here are pushed back, and releases show as commit statuses. History on either side is never overwritten.</p>
      <div className={s.status}>
        <Dot color={remote.lastImportError ? 'var(--err)' : remote.lastImportAt ? 'var(--ok)' : 'var(--tx-3)'} />
        {remote.lastImportError ? `Import failed ${when(remote.lastImportAt)}: ${remote.lastImportError}` : remote.lastImportAt ? `Checked GitHub ${when(remote.lastImportAt)}` : 'Not synced yet'}
      </div>
      <div className={s.status}>
        <Dot color={remote.lastPushOk === false ? 'var(--err)' : remote.lastPushOk ? 'var(--ok)' : 'var(--tx-3)'} />
        {remote.lastPushAt ? (remote.lastPushOk ? `Pushed ${when(remote.lastPushAt)}` : `Push failed ${when(remote.lastPushAt)}: ${remote.lastPushError}`) : 'Not pushed yet'}
      </div>
      <div className={s.actions}>
        <Button icon={<RefreshCw />} disabled={syncing} onClick={onSync}>Sync now</Button>
        {canConfigure && <Button variant="ghost" icon={<Trash2 />} onClick={onUnlink}>Unlink</Button>}
      </div>
    </div>
  )
}

function GithubLink({ pid }: { pid: string }) {
  const { data: me } = useMeQuery()
  const [show, setShow] = useState(false)
  const { data: repos, error, isFetching } = useGithubReposQuery(pid, { skip: !show })
  const [link, { isLoading }] = useLinkGithubMutation()
  const [repo, setRepo] = useState('')
  if (!me?.instanceAdmin) return <p className={s.muted}>An instance administrator can link this project to a GitHub repository through the instance's GitHub App.</p>
  if (!show) return <div className={s.actions}><Button icon={<Github />} onClick={() => setShow(true)}>Link a GitHub repository</Button></div>
  const save = async () => {
    const r = await link({ pid, repo })
    toast('error' in r ? errorMessage(r.error) : `Linked to ${repo}. The first sync is running.`, 'error' in r ? 'err' : 'ok')
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {isFetching && <p className={s.muted}>Asking GitHub which repositories the app can reach…</p>}
      {error && <p className={s.muted} style={{ color: 'var(--err)' }}>{errorMessage(error)}</p>}
      {repos && !repos.length && <p className={s.muted}>The GitHub App is not installed on any repository yet. An instance admin can install it from Instance admin, GitHub.</p>}
      {repos && repos.length > 0 && (
        <>
          <Field label="Repository" wide hint="Use an empty repository, or one whose main already contains this project's history.">
            <Select value={repo} onChange={setRepo} aria-label="GitHub repository" placeholder="Choose a repository" options={repos.map((r) => ({ value: r.fullName, label: `${r.fullName}${r.private ? ' (private)' : ''}` }))} />
          </Field>
          <div className={s.actions}><Button variant="primary" icon={<Github />} disabled={!repo || isLoading} onClick={save}>Link</Button></div>
        </>
      )}
    </div>
  )
}
