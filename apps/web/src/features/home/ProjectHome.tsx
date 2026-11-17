import { useState } from 'react'
import { AlertTriangle, Clock3, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { useCreateProjectMutation, useDeleteProjectMutation, useListProjectsQuery } from '@/api/endpoints/projects'
import { useListTeamsQuery } from '@/api/endpoints/orgs'
import { errorMessage, type ProjectSummary } from '@/api/types'
import { Button, Dialog, DropdownMenu, Empty, Field, Input, Select, toast, useDialogs } from '@/ui'
import { PROVIDERS, PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { TEMPLATES } from '@tessery/core/templates'
import { blankTemplate } from '@tessery/core/templates/blank'
import { useCurrentOrg } from '@/app/currentOrg'
import { usePermissions } from '@/app/usePermissions'
import { navigate } from '@/app/router'
import { AppHeader } from '@/features/chrome/AppHeader'
import { timeAgo } from '@/lib/format'
import { envColor, envName, envRank } from '@/lib/envColor'
import { Mosaic } from './Mosaic'
import s from './ProjectHome.module.css'

type Latest = ProjectSummary['latest'][number]
const IN_FLIGHT = ['queued', 'deploying']

/** One pill per environment: what runs there, or what its newest release is doing when that is not live yet. */
function envStates(p: ProjectSummary) {
  const keys = [...new Set([...p.running.map((r) => r.env), ...p.latest.map((l) => l.env)])].sort((a, b) => envRank(a) - envRank(b) || a.localeCompare(b))
  return keys.map((env) => {
    const running = p.running.find((r) => r.env === env)
    const latest = p.latest.find((l) => l.env === env)
    const state = latest?.status === 'pending' ? 'waiting' : latest?.status === 'failed' ? 'failed' : latest && IN_FLIGHT.includes(latest.status) ? 'deploying' : running ? 'live' : 'stopped'
    return { env, running, latest, state }
  })
}

/** Releases across the organization that someone should look at: waiting for approval, or failed. */
function attention(projects: ProjectSummary[]) {
  return projects.flatMap((p) => p.latest
    .filter((l) => l.status === 'pending' || l.status === 'failed')
    .map((l) => ({ project: p, release: l })))
    .sort((a, b) => b.release.at.localeCompare(a.release.at))
}

const describe = (l: Latest) => l.status === 'pending'
  ? `Checkpoint ${l.checkpoint} is waiting for approval to go to ${envName(l.env)}`
  : `Release of checkpoint ${l.checkpoint} to ${envName(l.env)} failed${l.error ? `: ${l.error}` : ''}`

export function ProjectHome() {
  const { org, isLoading: orgLoading } = useCurrentOrg()
  const perms = usePermissions({ org: org?.id })
  const { data: projects, isLoading, error } = useListProjectsQuery(org?.id ?? '', { skip: !org })
  const { data: teams } = useListTeamsQuery(org?.id ?? '', { skip: !org || !perms.can('team:read') })
  const [create, { isLoading: creating }] = useCreateProjectMutation()
  const [remove] = useDeleteProjectMutation()
  const dialogs = useDialogs()
  const [q, setQ] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [tpl, setTpl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const [provider, setProvider] = useState('aws')
  const [region, setRegion] = useState(PROVIDER_BY_ID.aws.regions[0].id)

  const pick = (id: string) => { setChoosing(false); setTpl(id); setName(id === 'blank' ? 'my-system' : ''); setTeamId('') }
  const start = async () => {
    if (!tpl || !org) return
    const t = TEMPLATES.find((x) => x.id === tpl)!
    const doc = t.id === 'blank' ? blankTemplate(name.trim() || 'untitled', provider, region) : t.build()
    if (name.trim()) doc.name = name.trim()
    const r = await create({ org: org.id, doc, teamId: teamId || null })
    if ('data' in r && r.data) { setTpl(null); navigate(`/projects/${r.data.id}`) } else toast(errorMessage(r.error, 'Could not create the project'), 'err')
  }
  const all = projects ?? []
  const list = all.filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
  const canCreate = perms.can('project:create') || (teams?.length ?? 0) > 0
  const needs = attention(all)
  const live = all.filter((p) => p.running.length > 0).length

  const del = async (p: ProjectSummary) => {
    if (!(await dialogs.confirm({ title: `Delete ${p.name}?`, body: 'This removes the design and its version history.', ok: 'Delete', danger: true }))) return
    const r = await remove(p.id)
    toast('error' in r ? errorMessage(r.error) : `Deleted ${p.name}`, 'error' in r ? 'err' : 'ok')
  }

  return (
    <div className={s.shell}>
      <AppHeader />
      <div className={s.page}>
        {!org && !orgLoading ? <Empty title="You are not in any organization yet">Ask an administrator to add you, or create one from the organization menu.</Empty> : (
          <main className={s.main}>
            <header className={s.head}>
              <div>
                <h1 className={s.title}>Projects</h1>
                {org && projects && <p className={s.sub}>{all.length === 1 ? '1 project' : `${all.length} projects`} in {org.name}{live > 0 && `, ${live} running`}</p>}
              </div>
              <div className={s.headActions}>
                {all.length > 3 && <div className={s.filter}><Input icon={<Search />} placeholder="Filter projects" value={q} onChange={setQ} aria-label="Filter projects" /></div>}
                {canCreate && <Button variant="primary" size="md" icon={<Plus />} onClick={() => setChoosing(true)}>New project</Button>}
              </div>
            </header>

            {needs.length > 0 && (
              <section className={s.attention} aria-labelledby="needs-attention">
                <h2 id="needs-attention" className={s.h2}>Needs attention</h2>
                <ul>
                  {needs.map(({ project, release }) => (
                    <li key={`${project.id}:${release.env}`} className={s.alert} data-kind={release.status}>
                      {release.status === 'pending' ? <Clock3 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                      <div className={s.alertText}>
                        <b>{project.name}</b>
                        <span>{describe(release)}</span>
                      </div>
                      <span className={s.alertWhen}>{timeAgo(new Date(release.at).getTime())}</span>
                      <Button size="sm" onClick={() => navigate(`/projects/${project.id}?release=${release.id}`)}>{release.status === 'pending' ? 'Review' : 'See the log'}</Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {isLoading ? <div className={s.grid}>{[0, 1, 2].map((i) => <div key={i} className={s.skeleton} />)}</div>
              : error ? <Empty title="Projects could not be loaded">{errorMessage(error)}</Empty>
              : all.length === 0 ? (
                <div className={s.firstRun}>
                  <h2 className={s.firstTitle}>Design your first system</h2>
                  <p>Draw the services, databases and pages, and Tessery generates the code and deploys it from development to production. Start from a template or a blank canvas.</p>
                </div>
              ) : list.length === 0 ? <Empty title={`No project matches "${q}"`}>Clear the filter to see every project.</Empty> : (
                <div className={s.grid}>
                  {list.map((p) => (
                    <article key={p.id} className={s.card}>
                      <button className={s.cardLink} onClick={() => navigate(`/projects/${p.id}`)} aria-label={`Open ${p.name}`} />
                      <Mosaic techIds={p.techIds} />
                      <div className={s.cardBody}>
                        <div className={s.cardHead}>
                          <h3 className={s.cardTitle}>{p.name}</h3>
                          <span className={s.cardMenu}>
                            <DropdownMenu align="end" trigger={<Button variant="ghost" size="xs" icon={<MoreHorizontal />} aria-label={`Actions for ${p.name}`} />} items={[
                              { label: 'Open', onSelect: () => navigate(`/projects/${p.id}`) },
                              { kind: 'separator' },
                              { label: 'Delete…', icon: <Trash2 />, danger: true, onSelect: () => del(p) },
                            ]} />
                          </span>
                        </div>
                        {p.description && <p className={s.cardDesc}>{p.description}</p>}
                        <div className={s.envs}>
                          {envStates(p).map((e) => (
                            <span key={e.env} className={s.env} data-state={e.state} style={{ '--env': envColor(e.env) } as React.CSSProperties}
                              title={e.state === 'failed' ? describe(e.latest!) : e.state === 'waiting' ? describe(e.latest!) : undefined}>
                              <i aria-hidden="true" />
                              {envName(e.env)}
                              <em>{e.state === 'live' ? `#${e.running!.checkpoint}` : e.state === 'stopped' ? 'stopped' : e.state}</em>
                            </span>
                          ))}
                          {p.running.length === 0 && p.latest.length === 0 && <span className={s.notDeployed}>Not deployed yet</span>}
                        </div>
                        <p className={s.cardMeta}>
                          <span>Edited {timeAgo(new Date(p.updatedAt).getTime())}</span>
                          {teams?.find((t) => t.id === p.teamId) && <span>{teams.find((t) => t.id === p.teamId)!.name}</span>}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}

            {canCreate && (
              <section aria-labelledby="start-new">
                <h2 id="start-new" className={s.h2}>Start something new</h2>
                <div className={s.templates}>
                  {TEMPLATES.map((t) => (
                    <button key={t.id} className={s.tpl} onClick={() => pick(t.id)}>
                      <b>{t.id === 'blank' ? 'Blank canvas' : t.name}</b>
                      <span>{t.description}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </main>
        )}
      </div>

      <Dialog open={choosing} onOpenChange={setChoosing} title="New project" description="Start from a template or a blank canvas. You can change everything afterwards." width={620}>
        <div className={s.chooser}>
          {TEMPLATES.map((t) => (
            <button key={t.id} className={s.tpl} onClick={() => pick(t.id)}>
              <b>{t.id === 'blank' ? 'Blank canvas' : t.name}</b>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
      </Dialog>

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
