import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Building2, Check, ChevronsUpDown, CornerDownLeft, LogOut, Plus, Settings } from 'lucide-react'
import clsx from 'clsx'
import { useLogoutMutation, useMeQuery } from '@/api/endpoints/identity'
import { useCreateOrgMutation } from '@/api/endpoints/orgs'
import { useListProjectsQuery } from '@/api/endpoints/projects'
import { useSystemVersionQuery, VERSION_POLL_MS } from '@/api/endpoints/system'
import { restartSignedOut } from '@/api/base'
import { errorMessage } from '@/api/types'
import { setCurrentOrg, useCurrentOrg } from '@/app/currentOrg'
import { usePermissions } from '@/app/usePermissions'
import { navigate, useRoute } from '@/app/router'
import { Dialog, DropdownMenu, Skeleton, Tooltip, toast, useDialogs, type MenuEntry } from '@/ui'
import { TesseryMark } from '@/ui/TesseryMark'
import { ADMIN_SECTIONS, ORG_SECTIONS } from './nav'
import s from './AppShell.module.css'
import { NavIcon } from '@/ui/icons/Icon'

const KEY = 'tessery.sidebar'
const readRail = () => {
  try { const v = localStorage.getItem(KEY); if (v) return v === 'rail' } catch { /* storage may be blocked */ }
  return window.innerWidth < 960
}

/** Whether the sidebar is folded into its icon rail. Remembered per browser; `[` toggles it. */
function useRail() {
  const [rail, setRail] = useState(readRail)
  const toggle = useCallback(() => setRail((r) => {
    try { localStorage.setItem(KEY, r ? 'open' : 'rail') } catch { /* storage may be blocked */ }
    return !r
  }), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]'))) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  return [rail, toggle] as const
}

interface Destination { id: string; label: string; icon: ReactNode; path: string; group: string }

/** Every place the sidebar can take you, filtered by what the signed-in person may see. */
function useDestinations(): Destination[] {
  const { data: me } = useMeQuery()
  const { org } = useCurrentOrg()
  const perms = usePermissions({ org: org?.id })
  return useMemo(() => [
    { id: 'home', label: 'Projects', icon: <NavIcon name="projects" />, path: '/', group: '' },
    ...(org ? ORG_SECTIONS.filter((x) => perms.can(x.perm)).map((x) => ({ id: `settings:${x.id}`, label: x.label, icon: x.icon, path: `/settings/${x.id}`, group: 'Organization' })) : []),
    ...(me?.instanceAdmin ? ADMIN_SECTIONS.map((x) => ({ id: `admin:${x.id}`, label: x.label, icon: x.icon, path: `/admin/${x.id}`, group: 'Instance' })) : []),
    { id: 'account', label: 'Account', icon: <NavIcon name="account" />, path: '/account', group: 'You' },
  ], [org, me?.instanceAdmin, perms])
}

function activeId(route: ReturnType<typeof useRoute>): string {
  if (route.name === 'settings') return `settings:${route.section}`
  if (route.name === 'admin') return `admin:${route.section}`
  if (route.name === 'account') return 'account'
  return 'home'
}

/** The frame around every page outside the project editor: a quiet sidebar and the page on a floating panel. */
export function AppShell({ children, busy }: { children: ReactNode; busy?: boolean }) {
  const [rail, toggle] = useRail()
  const [finding, setFinding] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setFinding((f) => !f) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className={s.shell} data-rail={rail || undefined}>
      <Sidebar rail={rail} toggle={toggle} find={() => setFinding(true)} />
      <main className={s.panel} aria-busy={busy || undefined}>{children}</main>
      <QuickSwitcher open={finding} onOpenChange={setFinding} />
    </div>
  )
}

function Sidebar({ rail, toggle, find }: { rail: boolean; toggle: () => void; find: () => void }) {
  const route = useRoute()
  const dialogs = useDialogs()
  const { data: me } = useMeQuery()
  const { org, orgs, isLoading } = useCurrentOrg()
  const [logout] = useLogoutMutation()
  const [createOrg] = useCreateOrgMutation()
  const places = useDestinations()
  const on = activeId(route)

  const newOrg = async () => {
    const v = await dialogs.prompt({ title: 'New organization', fields: [{ name: 'name', label: 'Name', placeholder: 'Acme Inc.' }], ok: 'Create' })
    if (!v?.name.trim()) return
    const r = await createOrg({ name: v.name.trim() })
    if ('data' in r && r.data) { setCurrentOrg(r.data.id); toast(`Created ${r.data.name}`, 'ok') } else toast(errorMessage(r.error), 'err')
  }
  const orgItems: MenuEntry[] = [
    { kind: 'heading', label: 'Organizations' },
    ...orgs.map((o) => ({ label: `${o.name}${o.member ? '' : ' (admin view)'}`, icon: o.id === org?.id ? <Check /> : <Building2 />, onSelect: () => setCurrentOrg(o.id) })),
    { kind: 'separator' as const },
    { label: 'New organization…', icon: <Plus />, onSelect: newOrg },
  ]
  const tip = (label: string, node: ReactNode, shortcut?: string) => rail ? <Tooltip content={label} shortcut={shortcut} side="right">{node}</Tooltip> : node
  const groups = [...new Set(places.filter((p) => p.group && p.group !== 'You').map((p) => p.group))]
  const item = (p: Destination) => (
    <li key={p.id}>
      {tip(p.label, (
        <button className={clsx(s.item, on === p.id && s.on)} aria-current={on === p.id ? 'page' : undefined} onClick={() => navigate(p.path)}>
          {p.icon}<span className={s.label}>{p.label}</span>
        </button>
      ))}
    </li>
  )

  return (
    <nav className={s.side} aria-label="Main">
      <div className={s.top}>
        {isLoading ? <Skeleton h={28} r={6} w={rail ? 28 : '100%'} /> : (
          <DropdownMenu trigger={
            <button className={s.org} aria-label={`Organization: ${org?.name ?? 'none'}`}>
              <span className={s.orgMark}><TesseryMark size={18} /></span>
              <span className={s.label}>{org?.name ?? 'No organization'}</span>
              <ChevronsUpDown className={s.label} />
            </button>
          } items={orgItems} />
        )}
        {me?.instanceAdmin && <UpdatePill rail={rail} />}
        {tip('Search and jump', (
          <button className={s.search} onClick={find}><NavIcon name="search" /><span className={`${s.label} ${s.searchText}`}>Search</span><kbd className={`${s.label} ${s.kbd}`}>Ctrl K</kbd></button>
        ), 'Ctrl K')}
      </div>
      <div className={s.scroll}>
        <ul className={s.list}>{places.filter((p) => !p.group).map(item)}</ul>
        {groups.map((g) => (
          <section key={g} className={s.group} aria-label={g}>
            <h2 className={s.groupTitle}>{g}</h2>
            <ul className={s.list}>{places.filter((p) => p.group === g).map(item)}</ul>
          </section>
        ))}
      </div>
      <div className={s.bottom}>
        <DropdownMenu side="top" items={[
          { kind: 'heading', label: me?.email ?? '' },
          { label: 'Account', icon: <Settings />, onSelect: () => navigate('/account') },
          { kind: 'separator' as const },
          { label: 'Sign out', icon: <LogOut />, onSelect: async () => { await logout(); restartSignedOut() } },
        ]} trigger={
          <button className={clsx(s.me, on === 'account' && s.on)} aria-label={`Account: ${me?.name ?? ''}`}>
            <span className={s.avatar} aria-hidden="true">{(me?.name ?? '?').trim().charAt(0).toUpperCase()}</span>
            <span className={s.label}><b>{me?.name}</b><small>{me?.email}</small></span>
          </button>
        } />
        {tip(rail ? 'Expand the sidebar' : 'Collapse the sidebar', (
          <button className={s.fold} onClick={toggle} aria-label={rail ? 'Expand the sidebar' : 'Collapse the sidebar'}><NavIcon name={rail ? 'expand' : 'collapse'} /></button>
        ), '[')}
      </div>
    </nav>
  )
}

/** Ctrl+K: jump to a project or any page by typing part of its name. */
function QuickSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { org } = useCurrentOrg()
  const { data: projects } = useListProjectsQuery(org?.id ?? '', { skip: !org || !open })
  const places = useDestinations()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { setQ(''); setAt(0) } }, [open])
  const hits = useMemo(() => {
    const all = [
      ...(projects ?? []).map((p) => ({ id: `p:${p.id}`, label: p.name, hint: 'Project', path: `/projects/${p.id}` })),
      ...places.map((p) => ({ id: p.id, label: p.label, hint: p.group || 'Page', path: p.path })),
    ]
    const n = q.trim().toLowerCase()
    return n ? all.filter((x) => x.label.toLowerCase().includes(n)) : all
  }, [projects, places, q])
  const go = (i: number) => { const h = hits[i]; if (!h) return; onOpenChange(false); navigate(h.path) }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Search and jump" width={520}>
      <div className={s.finder}>
        <input ref={input} autoFocus className={s.finderInput} placeholder="Projects, settings, pages…" value={q} aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setAt(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, hits.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter') { e.preventDefault(); go(at) }
          }} />
        <ul className={s.finderList} role="listbox" aria-label="Results">
          {hits.length === 0 && <li className={s.finderEmpty}>Nothing matches "{q}"</li>}
          {hits.slice(0, 40).map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === at}>
              <button className={clsx(s.finderHit, i === at && s.finderOn)} onMouseEnter={() => setAt(i)} onClick={() => go(i)}>
                <span>{h.label}</span><small>{h.hint}</small>{i === at && <CornerDownLeft aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}

/** Tells instance admins a newer release is out, and takes them to the Updates page to install it. */
function UpdatePill({ rail }: { rail: boolean }) {
  const { data } = useSystemVersionQuery(undefined, { pollingInterval: VERSION_POLL_MS })
  if (!data?.updateAvailable || !data.latest) return null
  const pill = (
    <button className={s.update} onClick={() => navigate('/admin/updates')} aria-label={`Update to ${data.latest}`}>
      <span className={s.updateDot} /><span className={s.label}>Update to {data.latest}</span>
    </button>
  )
  return rail ? <Tooltip content={`Update to ${data.latest}`} side="right">{pill}</Tooltip> : pill
}
