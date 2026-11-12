import { useState } from 'react'
import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { useCreateProjectMutation, useDeleteProjectMutation, useListProjectsQuery } from '@/api/endpoints/projects'
import { useListTeamsQuery } from '@/api/endpoints/orgs'
import { errorMessage } from '@/api/types'
import { Badge, Button, Dialog, DropdownMenu, Empty, Field, Input, Select, toast, useDialogs } from '@/ui'
import { PROVIDERS, PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { TEMPLATES } from '@tessery/core/templates'
import { blankTemplate } from '@tessery/core/templates/blank'
import { useCurrentOrg } from '@/app/currentOrg'
import { usePermissions } from '@/app/usePermissions'
import { navigate } from '@/app/router'
import { AppHeader } from '@/features/chrome/AppHeader'
import { timeAgo } from '@/lib/format'
import s from './ProjectHome.module.css'

const STAGES = ['dev', 'development', 'test', 'qa', 'staging', 'preview', 'prod', 'production']
const stageRank = (env: string) => { const i = STAGES.indexOf(env.toLowerCase()); return i < 0 ? STAGES.length : i }

export function ProjectHome() {
  const { org, isLoading: orgLoading } = useCurrentOrg()
  const perms = usePermissions({ org: org?.id })
  const { data: projects, isLoading, error } = useListProjectsQuery(org?.id ?? '', { skip: !org })
  const { data: teams } = useListTeamsQuery(org?.id ?? '', { skip: !org || !perms.can('team:read') })
  const [create, { isLoading: creating }] = useCreateProjectMutation()
  const [remove] = useDeleteProjectMutation()
  const dialogs = useDialogs()
  const [q, setQ] = useState('')
  const [tpl, setTpl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const [provider, setProvider] = useState('aws')
  const [region, setRegion] = useState(PROVIDER_BY_ID.aws.regions[0].id)

  const start = async () => {
    if (!tpl || !org) return
    const t = TEMPLATES.find((x) => x.id === tpl)!
    const doc = t.id === 'blank' ? blankTemplate(name.trim() || 'untitled', provider, region) : t.build()
    if (name.trim()) doc.name = name.trim()
    const r = await create({ org: org.id, doc, teamId: teamId || null })
    if ('data' in r && r.data) { setTpl(null); navigate(`/projects/${r.data.id}`) } else toast(errorMessage(r.error, 'Could not create the project'), 'err')
  }
  const list = (projects ?? []).filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
  const canCreate = perms.can('project:create') || (teams?.length ?? 0) > 0

  return (
    <div className={s.shell}>
      <AppHeader />
      <div className={s.page}>
        {!org && !orgLoading ? <Empty title="You are not in any organization yet">Ask an administrator to add you, or create one from the organization menu.</Empty> : (
          <main className={s.main}>
            {canCreate && (
              <section>
                <h2 className={s.h2}>New project</h2>
                <div className={s.templates}>
                  {TEMPLATES.map((t) => (
                    <button key={t.id} className={s.tpl} onClick={() => { setTpl(t.id); setName(t.id === 'blank' ? 'my-system' : ''); setTeamId('') }}>
                      <span className={s.tplIcon}>{t.id === 'blank' ? <Plus /> : t.name[0]}</span>
                      <b>{t.name}</b>
                      <span>{t.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <div className={s.listHead}>
                <h2 className={s.h2}>Projects in {org?.name}</h2>
                <div style={{ width: 240 }}><Input icon={<Search />} placeholder="Filter projects" value={q} onChange={setQ} /></div>
              </div>
              {isLoading ? <Empty title="Loading…" /> : error ? <Empty title="Could not load projects">{errorMessage(error)}</Empty> : list.length === 0 ? <Empty title="No projects">{canCreate ? 'Create one from a template above.' : 'You have not been given access to any project yet.'}</Empty> : (
                <div className={s.list}>
                  {list.map((p) => (
                    <div key={p.id} className={s.row} role="button" tabIndex={0} onClick={() => navigate(`/projects/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${p.id}`)}>
                      <span className={s.rowIcon}>{p.icon || '○'}</span>
                      <div className={s.rowMain}><b>{p.name}</b><span>{p.description}</span></div>
                      <span className={s.running}>{[...p.running].sort((x, y) => stageRank(x.env) - stageRank(y.env) || x.env.localeCompare(y.env)).map((r) => <Badge key={r.env} tone="ok" mono>{r.env} #{r.checkpoint}</Badge>)}</span>
                      <span className={s.rowMeta}>{teams?.find((t) => t.id === p.teamId)?.name ?? ''}</span>
                      <span className={s.rowMeta}>{p.nodes} nodes · v{p.version}</span>
                      <span className={s.rowMeta}>{timeAgo(new Date(p.updatedAt).getTime())}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu align="end" trigger={<Button variant="ghost" size="xs" icon={<MoreHorizontal />} aria-label="Project actions" />} items={[
                          { label: 'Open', onSelect: () => navigate(`/projects/${p.id}`) },
                          { kind: 'separator' },
                          { label: 'Delete…', icon: <Trash2 />, danger: true, onSelect: async () => {
                            if (!(await dialogs.confirm({ title: `Delete ${p.name}?`, body: 'This removes the design and its version history.', ok: 'Delete', danger: true }))) return
                            const r = await remove(p.id)
                            toast('error' in r ? errorMessage(r.error) : `Deleted ${p.name}`, 'error' in r ? 'err' : 'ok')
                          } },
                        ]} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </main>
        )}
      </div>
      <Dialog open={!!tpl} onOpenChange={(o) => !o && setTpl(null)} title={`New project: ${TEMPLATES.find((t) => t.id === tpl)?.name ?? ''}`}
        footer={<><Button onClick={() => setTpl(null)}>Cancel</Button><Button variant="primary" disabled={creating} onClick={start}>{creating ? 'Creating…' : 'Create project'}</Button></>}>
        <Field label="Name" wide><Input size="md" autoFocus value={name} placeholder="keep the template's name" onChange={setName} onKeyDown={(e) => e.key === 'Enter' && start()} /></Field>
        {(teams?.length ?? 0) > 0 && (
          <Field label="Owning team" wide hint="Team-level access grants apply to projects the team owns.">
            <Select value={teamId} onChange={setTeamId} options={[...(perms.can('project:create') ? [{ value: '', label: 'No team (organization-wide)' }] : []), ...(teams ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
          </Field>
        )}
        {tpl === 'blank' && <>
          <Field label="Default provider" wide hint="Used for new nodes and the production environment. Every node can be placed elsewhere later.">
            <Select value={provider} onChange={(v) => { setProvider(v); setRegion(PROVIDER_BY_ID[v].regions[0].id) }} options={PROVIDERS.filter((p) => p.id !== 'saas').map((p) => ({ value: p.id, label: p.name, hint: p.kind }))} />
          </Field>
          <Field label="Region" wide><Select value={region} onChange={setRegion} options={PROVIDER_BY_ID[provider].regions.map((r) => ({ value: r.id, label: r.name, hint: r.id }))} /></Field>
        </>}
      </Dialog>
    </div>
  )
}
