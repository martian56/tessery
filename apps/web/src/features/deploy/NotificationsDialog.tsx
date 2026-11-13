import { useState } from 'react'
import { Bell, Send, Trash2 } from 'lucide-react'
import type { ProjectDoc } from '@tessery/core/domain/types'
import { useAddChannelMutation, useChannelsQuery, useDeleteChannelMutation, useNotificationEventsQuery, useTestChannelMutation, useUpdateChannelMutation, type Channel } from '@/api/endpoints/notifications'
import { errorMessage } from '@/api/types'
import { usePermissions } from '@/app/usePermissions'
import { useAppSelector } from '@/store'
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, Switch, toast, useDialogs } from '@/ui'
import { timeAgo } from '@/lib/format'
import s from './Deploy.module.css'

const KINDS = [
  { value: 'slack', label: 'Slack', placeholder: 'https://hooks.slack.com/services/…', hint: 'An incoming webhook URL from your Slack app.' },
  { value: 'discord', label: 'Discord', placeholder: 'https://discord.com/api/webhooks/…', hint: 'Channel settings, Integrations, Webhooks, Copy URL.' },
  { value: 'telegram', label: 'Telegram', placeholder: '123456:ABC-DEF@-1001234567890', hint: 'Your bot token from BotFather, then @, then the chat id.' },
  { value: 'email', label: 'Email', placeholder: 'ops@example.com, lead@example.com', hint: 'Sent through the instance email settings.' },
  { value: 'webhook', label: 'Webhook', placeholder: 'https://example.com/tessery', hint: 'Receives a JSON POST with event, project, env, title, detail and link.' },
]
const DEFAULT_EVENTS = ['release.failed', 'approval.requested', 'backup.failed']

export function NotificationsDialog({ doc, open, onClose }: { doc: ProjectDoc; open: boolean; onClose: () => void }) {
  const org = useAppSelector((st) => st.project.orgId) ?? undefined
  const perms = usePermissions({ org, project: doc.id })
  const canEdit = perms.can('project:edit')
  const { data: events } = useNotificationEventsQuery(undefined, { skip: !open })
  const { data: channels } = useChannelsQuery(doc.id, { skip: !open })
  const [adding, setAdding] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} width={560} title="Notifications"
      description="Tell people when releases start, go live, fail or wait for approval, and when a backup fails."
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className={s.secretList}>
        {(channels ?? []).map((c) => <ChannelRow key={c.id} pid={doc.id} channel={c} canEdit={canEdit} labels={events ?? []} />)}
        {channels && !channels.length && !adding && <span className={s.hint}>No channels yet.</span>}
      </div>
      {canEdit && (adding
        ? <NewChannel doc={doc} events={events ?? []} onDone={() => setAdding(false)} />
        : <div><Button size="sm" icon={<Bell />} onClick={() => setAdding(true)}>Add channel</Button></div>)}
    </Dialog>
  )
}

function ChannelRow({ pid, channel: c, canEdit, labels }: { pid: string; channel: Channel; canEdit: boolean; labels: { key: string; label: string }[] }) {
  const dialogs = useDialogs()
  const [update] = useUpdateChannelMutation()
  const [remove] = useDeleteChannelMutation()
  const [test, { isLoading: testing }] = useTestChannelMutation()
  const kind = KINDS.find((k) => k.value === c.kind)?.label ?? c.kind
  const sendTest = async () => {
    const r = await test({ pid, id: c.id })
    toast('error' in r ? errorMessage(r.error) : `Test sent to ${c.name}`, 'error' in r ? 'err' : 'ok')
  }
  const del = async () => {
    if (!(await dialogs.confirm({ title: `Remove ${c.name}?`, body: 'It stops getting notifications.', ok: 'Remove', danger: true }))) return
    const r = await remove({ pid, id: c.id })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const toggle = async (enabled: boolean) => {
    const r = await update({ pid, id: c.id, body: { name: c.name, events: c.events, envs: c.envs, enabled } })
    if ('error' in r) toast(errorMessage(r.error), 'err')
  }
  const what = c.events.map((e) => labels.find((l) => l.key === e)?.label ?? e).join(', ')
  return (
    <div className={s.secretRow}>
      <Bell size={12} />
      <div className={s.secretMain}>
        <span className={s.mono}>{c.name} · {kind} · {c.targetHint}</span>
        <span className={s.hint}>{what}{c.envs.length ? ` · only ${c.envs.join(', ')}` : ''}</span>
        {c.lastError ? <span className={s.hint} style={{ color: 'var(--err)' }}>{c.lastError}</span>
          : c.lastSentAt ? <span className={s.hint}>last sent {timeAgo(new Date(c.lastSentAt).getTime())}</span> : null}
      </div>
      {!c.enabled && <Badge tone="warn">paused</Badge>}
      {canEdit && (
        <>
          <Switch checked={c.enabled} onChange={toggle} />
          <Button size="xs" variant="ghost" icon={<Send />} disabled={testing} onClick={sendTest} aria-label={`Send a test to ${c.name}`} />
          <Button size="xs" variant="ghost" icon={<Trash2 />} onClick={del} aria-label={`Remove ${c.name}`} />
        </>
      )}
    </div>
  )
}

function NewChannel({ doc, events, onDone }: { doc: ProjectDoc; events: { key: string; label: string }[]; onDone: () => void }) {
  const [add, { isLoading }] = useAddChannelMutation()
  const [kind, setKind] = useState('slack')
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [picked, setPicked] = useState<string[]>(DEFAULT_EVENTS)
  const [envs, setEnvs] = useState<string[]>([])
  const k = KINDS.find((x) => x.value === kind)!
  const flip = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v))
  const save = async () => {
    const r = await add({ pid: doc.id, body: { name: name.trim() || k.label, kind, target: target.trim(), events: picked, envs } })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    toast(`${r.data.name} added. Send a test to check it.`, 'ok')
    onDone()
  }
  return (
    <div className={s.secretList} style={{ borderTop: '1px solid var(--line-2)', paddingTop: 'var(--sp-4)' }}>
      <Field label="Send to"><Select value={kind} onChange={setKind} aria-label="Channel type" options={KINDS.map(({ value, label }) => ({ value, label }))} /></Field>
      <Field label="Name"><Input value={name} onChange={setName} placeholder={`${k.label} ops`} /></Field>
      <Field label={kind === 'email' ? 'Addresses' : kind === 'telegram' ? 'Bot and chat' : 'Webhook URL'} hint={k.hint}>
        <Input mono value={target} onChange={setTarget} placeholder={k.placeholder} />
      </Field>
      <Field label="When">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.map((e) => <Checkbox key={e.key} checked={picked.includes(e.key)} label={e.label} onChange={(on) => setPicked(flip(picked, e.key, on))} />)}
        </div>
      </Field>
      {doc.environments.length > 1 && (
        <Field label="Environments" hint="None ticked means all of them.">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {doc.environments.map((e) => <Checkbox key={e.id} checked={envs.includes(e.id)} label={e.name} onChange={(on) => setEnvs(flip(envs, e.id, on))} />)}
          </div>
        </Field>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <Button variant="primary" size="sm" disabled={isLoading || !target.trim() || !picked.length} onClick={save}>Add channel</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}
