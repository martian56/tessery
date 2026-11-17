import { useEffect, useRef, useState } from 'react'
import { Check, Clock3, LayoutGrid, List, LoaderCircle, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { useCreateProjectMutation, useDeleteProjectMutation, useListProjectsQuery } from '@/api/endpoints/projects'
import { useListTeamsQuery } from '@/api/endpoints/orgs'
import { errorMessage, type ProjectSummary } from '@/api/types'
import { Button, Dialog, DropdownMenu, Empty, Field, Input, Select, Skeleton, SkeletonText, Tooltip, toast, useDialogs } from '@/ui'
import { PROVIDERS, PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { TEMPLATES } from '@tessery/core/templates'
import { blankTemplate } from '@tessery/core/templates/blank'
import { useCurrentOrg } from '@/app/currentOrg'
import { usePermissions } from '@/app/usePermissions'
import { navigate } from '@/app/router'
import { AppShell } from '@/features/chrome/AppShell'
import { timeAgo } from '@/lib/format'
import { envName } from '@/lib/envColor'
import { Mosaic } from './Mosaic'
import { Pipeline } from './Pipeline'
import { activity, headline, releaseWords, stages, type Latest } from './status'
import s from './ProjectHome.module.css'

type View = 'grid' | 'list'
const VIEW_KEY = 'tessery.projects.view'
const readView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' } }
const ago = (iso: string) => timeAgo(new Date(iso).getTime())
const open = (p: ProjectSummary, release?: Latest) => navigate(`/projects/${p.id}${release ? `?release=${release.id}` : ''}`)

export function ProjectHome() {
  const { org, isLoading: orgLoading } = useCurrentOrg()
  const perms = usePermissions({ org: org?.id })
  const { data: projects, isLoading, error, refetch } = useListProjectsQuery(org?.id ?? '', { skip: !org, pollingInterval: 15000, skipPollingIfUnfocused: true })
  const { data: teams } = useListTeamsQuery(org?.id ?? '', { skip: !org || !perms.can('team:read') })
  const [create, { isLoading: creating }] = useCreateProjectMutation()
  const [remove] = useDeleteProjectMutation()
  const dialogs = useDialogs()
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>(readView)
  const [choosing, setChoosing] = useState(false)
  const [tpl, setTpl] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const [provider, setProvider] = useState('aws')
  const [region, setRegion] = useState(PROVIDER_BY_ID.aws.regions[0].id)
  const search = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (e.key !== '/' || (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]'))) return
      e.preventDefault()
      search.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage may be blocked */ } }
  const pick = (id: string) => { setChoosing(false); setTpl(id); setName(id === 'blank' ? 'my-system' : ''); setTeamId('') }
  const start = async () => {
    if (!tpl || !org) return
    const t = TEMPLATES.find((x) => x.id === tpl)!
    const doc = t.id === 'blank' ? blankTemplate(name.trim() || 'untitled', provider, region) : t.build()
    if (name.trim()) doc.name = name.trim()
    const r = await create({ org: org.id, doc, teamId: teamId || null })
    if ('data' in r && r.data) { setTpl(null); navigate(`/projects/${r.data.id}`) } else toast(errorMessage(r.error, 'Could not create the project'), 'err')
  }
  const del = async (p: ProjectSummary) => {
    if (!(await dialogs.confirm({ title: `Delete ${p.name}?`, body: 'This removes the design and its version history.', ok: 'Delete', danger: true }))) return
    const r = await remove(p.id)
    toast('error' in r ? errorMessage(r.error) : `Deleted ${p.name}`, 'error' in r ? 'err' : 'ok')
  }

  const all = projects ?? []
  const list = all.filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase()))
  const canCreate = perms.can('project:create') || (teams?.length ?? 0) > 0
  const loading = !org ? orgLoading : isLoading
  const team = (p: ProjectSummary) => teams?.find((t) => t.id === p.teamId)?.name
  const menu = (p: ProjectSummary) => (
    <DropdownMenu align="end" trigger={<Button variant="ghost" size="xs" icon={<MoreHorizontal />} aria-label={`Actions for ${p.name}`} />} items={[
      { label: 'Open', onSelect: () => open(p) },
      { kind: 'separator' },
      { label: 'Delete…', icon: <Trash2 />, danger: true, onSelect: () => del(p) },
    ]} />
  )

  if (!org && !orgLoading) {
    return <AppShell><Empty title="You are not in any organization yet">Ask an administrator to add you, or create one from the organization menu in the sidebar.</Empty></AppShell>
  }

  return (
    <AppShell busy={loading}>
      <header className={s.bar}>
        <h1 className={s.title}>Projects{projects && <span className={s.count}>{all.length}</span>}</h1>
        <div className={s.tools}>
          <div className={s.search} ref={search}>
            <Input icon={<Search />} placeholder="Search projects" value={q} onChange={setQ} aria-label="Search projects" />
            {!q && <kbd className={s.kbd} aria-hidden="true">/</kbd>}
          </div>
          <div className={s.views} role="group" aria-label="View">
            <Tooltip content="Grid"><button className={clsx(s.viewBtn, view === 'grid' && s.viewOn)} aria-pressed={view === 'grid'} aria-label="Grid" onClick={() => pickView('grid')}><LayoutGrid /></button></Tooltip>
            <Tooltip content="List"><button className={clsx(s.viewBtn, view === 'list' && s.viewOn)} aria-pressed={view === 'list'} aria-label="List" onClick={() => pickView('list')}><List /></button></Tooltip>
          </div>
          {canCreate && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setChoosing(true)}>New project</Button>}
        </div>
      </header>

      <div className={s.body}>
        <div className={s.main}>
          {loading ? (
            view === 'grid'
              ? <div className={s.grid}>{[0, 1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
              : <div className={s.rows}>{[0, 1, 2, 3].map((i) => <div key={i} className={s.row}><SkeletonText lines={2} /><Skeleton w={60} h={10} /><Skeleton w={70} h={10} /></div>)}</div>
          ) : error ? (
            <Empty title="Projects could not be loaded" action={<Button onClick={() => refetch()}>Try again</Button>}>{errorMessage(error)}</Empty>
          ) : all.length === 0 ? (
            <section className={s.first}>
              <h2 className={s.firstTitle}>Design your first system</h2>
              <p>Draw the services, databases and pages; Tessery generates the code and takes it from development to production. Pick a starting point.</p>
              {canCreate && <Templates pick={pick} wide />}
            </section>
          ) : list.length === 0 ? (
            <Empty title={`No project matches "${q}"`} action={<Button onClick={() => setQ('')}>Clear the search</Button>} />
          ) : view === 'grid' ? (
            <div className={s.grid}>
              {list.map((p) => {
                const st = stages(p)
                const h = headline(st)
                return (
                  <article key={p.id} className={s.card}>
                    <button className={s.cardLink} onClick={() => open(p)} aria-label={`Open ${p.name}`} />
                    <Mosaic techIds={p.techIds} />
                    <div className={s.cardBody}>
                      <div className={s.cardHead}>
                        <h3 className={s.name}>{p.name}</h3>
                        <span className={s.menu}>{menu(p)}</span>
                      </div>
                      <p className={s.desc}>{p.description || 'No description'}</p>
                    </div>
                    <footer className={s.cardFoot}>
                      <Pipeline stages={st} />
                      <span className={s.headline} data-tone={h.tone}>{h.text}</span>
                      <span className={s.when}>{ago(p.updatedAt)}</span>
                    </footer>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className={s.rows} role="list">
              {list.map((p) => {
                const st = stages(p)
                const h = headline(st)
                return (
                  <div key={p.id} className={s.row} role="listitem">
                    <button className={s.cardLink} onClick={() => open(p)} aria-label={`Open ${p.name}`} />
                    <div className={s.rowMain}><b>{p.name}</b><span>{p.description || 'No description'}</span></div>
                    <div className={s.rowPipe}><Pipeline stages={st} /><span className={s.headline} data-tone={h.tone}>{h.text}</span></div>
                    <span className={s.rowMeta}>{p.nodes} {p.nodes === 1 ? 'node' : 'nodes'}</span>
                    <span className={s.rowMeta}>{team(p) ?? ''}</span>
                    <span className={s.rowMeta}>{ago(p.updatedAt)}</span>
                    <span className={s.menu}>{menu(p)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {canCreate && all.length > 0 && (
            <section className={s.start} aria-labelledby="start-new">
              <h2 id="start-new" className={s.h2}>Start from a template</h2>
              <Templates pick={pick} />
            </section>
          )}
        </div>

        <Activity projects={projects} loading={loading} />
      </div>

      <Dialog open={choosing} onOpenChange={setChoosing} title="New project" description="Start from a template or a blank canvas. You can change everything afterwards." width={640}>
        <Templates pick={pick} wide />
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
    </AppShell>
  )
}

function CardSkeleton() {
  return (
    <div className={s.card} aria-hidden="true">
      <div className={s.preview}><div className={s.chips}>{[0, 1, 2].map((i) => <Skeleton key={i} w={38} h={38} r={8} />)}</div></div>
      <div className={s.cardBody}><Skeleton h={14} w="45%" /><SkeletonText lines={1} /></div>
      <div className={s.cardFoot}><Skeleton h={9} w={52} r={4} /><Skeleton h={10} w="40%" /></div>
    </div>
  )
}

function Templates({ pick, wide }: { pick: (id: string) => void; wide?: boolean }) {
  return (
    <div className={clsx(s.templates, wide && s.templatesWide)}>
      {TEMPLATES.map((t) => (
        <button key={t.id} className={s.tpl} onClick={() => pick(t.id)}>
          <b>{t.id === 'blank' ? 'Blank canvas' : t.name}</b>
          <span>{t.description}</span>
        </button>
      ))}
    </div>
  )
}

const ICON = { pending: Clock3, failed: X, released: Check, queued: LoaderCircle, deploying: LoaderCircle } as Record<string, typeof Check>

/** Releases across the organization: anything waiting for approval first, then the newest. */
function Activity({ projects, loading }: { projects?: ProjectSummary[]; loading: boolean }) {
  const items = activity(projects ?? []).slice(0, 12)
  const waiting = items.filter((x) => x.release.status === 'pending')
  const rest = items.filter((x) => x.release.status !== 'pending')
  const entry = ({ project, release }: (typeof items)[number]) => {
    const Icon = ICON[release.status] ?? Clock3
    return (
      <li key={release.id}>
        <button className={s.event} data-status={release.status} onClick={() => open(project, release)}>
          <Icon className={s.eventIcon} aria-hidden="true" />
          <span className={s.eventText}>
            <b>{project.name}<span className={s.arrow}> to </span>{envName(release.env)}</b>
            <span>Checkpoint {release.checkpoint}, {releaseWords(release)}</span>
            {release.status === 'failed' && release.error && <span className={s.eventError}>{release.error}</span>}
          </span>
          <time className={s.eventWhen} dateTime={release.at}>{ago(release.at)}</time>
        </button>
      </li>
    )
  }
  return (
    <aside className={s.rail} aria-label="Activity" aria-busy={loading || undefined}>
      {loading ? (
        <>
          <Skeleton h={12} w={110} />
          {[0, 1, 2, 3].map((i) => <div key={i} className={s.eventSkeleton}><Skeleton w={16} h={16} r={8} /><SkeletonText lines={2} size={11} gap={6} /></div>)}
        </>
      ) : (
        <>
          {waiting.length > 0 && <section><h2 className={s.railTitle}>Waiting for you</h2><ul className={s.events}>{waiting.map(entry)}</ul></section>}
          <section>
            <h2 className={s.railTitle}>Recent releases</h2>
            {rest.length > 0 ? <ul className={s.events}>{rest.map(entry)}</ul> : <p className={s.railEmpty}>Releases from every project show up here. Open a project and choose Deploy to make the first one.</p>}
          </section>
        </>
      )}
    </aside>
  )
}
