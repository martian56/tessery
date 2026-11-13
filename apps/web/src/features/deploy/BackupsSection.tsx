import { DatabaseBackup, RotateCcw } from 'lucide-react'
import { BACKUP_TECHS, type BackupPolicy, type Environment, type ProjectDoc } from '@tessery/core/domain/types'
import { useBackupNowMutation, useBackupsQuery, useRestoreBackupMutation } from '@/api/endpoints/backups'
import { useListIntegrationsQuery } from '@/api/endpoints/integrations'
import { errorMessage } from '@/api/types'
import { usePermissions } from '@/app/usePermissions'
import { useAppSelector, useEdit } from '@/store'
import { Badge, Button, Field, NumberInput, Section, Select, toast, useDialogs } from '@/ui'
import { timeAgo } from '@/lib/format'
import s from './Deploy.module.css'

const size = (b: number) => (b > 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const TONE: Record<string, 'ok' | 'warn' | 'err' | 'info' | 'neutral'> = { done: 'ok', restored: 'ok', failed: 'err', running: 'info', queued: 'info', restoring: 'warn' }

export function BackupsSection({ doc, env }: { doc: ProjectDoc; env: Environment }) {
  const edit = useEdit()
  const dialogs = useDialogs()
  const org = useAppSelector((st) => st.project.orgId) ?? undefined
  const perms = usePermissions({ org, project: doc.id, env: env.id })
  const { data: integrations } = useListIntegrationsQuery(org ?? '', { skip: !org || !perms.can('integration:read') })
  const stores = doc.nodes.filter((n) => BACKUP_TECHS.includes(n.techId))
  const policy = env.backups
  const busyPoll = (list?: { status: string }[]) => list?.some((b) => ['queued', 'running', 'restoring'].includes(b.status))
  const { data: backups } = useBackupsQuery({ pid: doc.id, env: env.id }, { skip: env.target?.kind !== 'docker', pollingInterval: 10_000 })
  const [backupNow, { isLoading: starting }] = useBackupNowMutation()
  const [restore] = useRestoreBackupMutation()
  if (env.target?.kind !== 'docker' || !stores.length) return null

  const accounts = (integrations ?? []).filter((i) => i.provider === 'cloudflare')
  const set = (patch: Partial<BackupPolicy> | null) => edit('updateEnv', { envId: env.id, patch: { backups: patch === null ? undefined : { every: 'daily', keep: 7, integration: '', ...policy, ...patch } } })
  const run = async () => {
    const r = await backupNow({ pid: doc.id, env: env.id })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    toast(`Backing up ${r.data.map((b) => b.node).join(', ')}`, 'ok')
  }
  const doRestore = async (id: string, node: string, when: string) => {
    const v = await dialogs.prompt({
      title: `Restore ${node} in ${env.name}?`,
      body: `Its current data is replaced with the backup from ${when}. Anything written since then is lost.`,
      fields: [{ name: 'confirm', label: `Type ${env.id} to confirm`, placeholder: env.id }],
      ok: 'Restore',
    })
    if (!v) return
    const r = await restore({ id, confirm: v.confirm.trim() })
    if ('error' in r) toast(errorMessage(r.error), 'err')
    else toast(`Restoring ${node}`, 'ok')
  }

  return (
    <Section title={<>Backups{policy?.integration ? <Badge tone="ok">{policy.every}</Badge> : <Badge tone="warn">off</Badge>}</>}>
      <Field label="Store in" hint={accounts.length ? 'Cloudflare R2, through a connected Cloudflare account with R2 keys' : 'Connect Cloudflare with R2 keys under Organization, Integrations'}>
        <Select value={policy?.integration || '__off'} onChange={(v) => set(v === '__off' ? null : { integration: v })} aria-label="Store backups in"
          options={[{ value: '__off', label: 'No backups' }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} (R2)` }))]} />
      </Field>
      {policy?.integration && (
        <>
          <Field label="Every"><Select value={policy.every} onChange={(v) => set({ every: v })} aria-label="Backup frequency"
            options={[{ value: 'hourly', label: 'Hour' }, { value: 'daily', label: 'Day' }, { value: 'weekly', label: 'Week' }]} /></Field>
          <Field label="Keep" hint="Backups kept per database; older ones are deleted"><NumberInput value={policy.keep} min={1} max={365} onCommit={(v) => set({ keep: v })} /></Field>
          {perms.can('deployment:run') && <div><Button size="sm" icon={<DatabaseBackup />} disabled={starting} onClick={run}>Back up now</Button></div>}
        </>
      )}
      <div className={s.secretList}>
        {(backups ?? []).slice(0, 12).map((b) => (
          <div key={b.id} className={s.secretRow}>
            <DatabaseBackup size={12} />
            <div className={s.secretMain}>
              <span className={s.mono}>{b.node} · {timeAgo(new Date(b.createdAt).getTime())}</span>
              <span className={s.hint}>{b.error || (b.sizeBytes ? `${size(b.sizeBytes)} · ${b.kind}` : b.kind)}</span>
            </div>
            <Badge tone={TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
            {perms.can('data:write') && (b.status === 'done' || b.status === 'restored') && (
              <Button size="xs" variant="ghost" icon={<RotateCcw />} onClick={() => doRestore(b.id, b.node, new Date(b.createdAt).toLocaleString())}>Restore</Button>
            )}
          </div>
        ))}
        {policy?.integration && !backups?.length && <span className={s.hint}>No backups yet. The first one runs within a minute of the next check, or press Back up now.</span>}
        {busyPoll(backups) && <span className={s.hint}>Working…</span>}
      </div>
    </Section>
  )
}
