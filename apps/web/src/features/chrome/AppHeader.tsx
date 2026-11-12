import { Building2, Check, ChevronDown, LogOut, Plus, Settings, Shield, User } from 'lucide-react'
import clsx from 'clsx'
import { useLogoutMutation, useMeQuery } from '@/api/endpoints/identity'
import { useCreateOrgMutation } from '@/api/endpoints/orgs'
import { restartSignedOut } from '@/api/base'
import { errorMessage } from '@/api/types'
import { setCurrentOrg, useCurrentOrg } from '@/app/currentOrg'
import { navigate, useRoute } from '@/app/router'
import { Button, DropdownMenu, toast, useDialogs, type MenuEntry } from '@/ui'
import s from './AppHeader.module.css'

export function AppHeader() {
  const route = useRoute()
  const dialogs = useDialogs()
  const { data: me } = useMeQuery()
  const { org, orgs } = useCurrentOrg()
  const [logout] = useLogoutMutation()
  const [createOrg] = useCreateOrgMutation()

  const newOrg = async () => {
    const v = await dialogs.prompt({ title: 'New organization', fields: [{ name: 'name', label: 'Name', placeholder: 'Acme Inc.' }], ok: 'Create' })
    if (!v?.name.trim()) return
    const r = await createOrg({ name: v.name.trim() })
    if ('data' in r && r.data) { setCurrentOrg(r.data.id); toast(`Created ${r.data.name}`, 'ok') } else toast(errorMessage(r.error), 'err')
  }
  const signOut = async () => {
    await logout()
    restartSignedOut()
  }
  const orgItems: MenuEntry[] = [
    { kind: 'heading', label: 'Organizations' },
    ...orgs.map((o) => ({ label: `${o.name}${o.member ? '' : ' (admin view)'}`, icon: o.id === org?.id ? <Check /> : <Building2 />, onSelect: () => setCurrentOrg(o.id) })),
    { kind: 'separator' as const },
    { label: 'New organization…', icon: <Plus />, onSelect: newOrg },
  ]
  const tab = (name: string, path: string, active: boolean) => <button className={clsx(s.tab, active && s.on)} onClick={() => navigate(path)}>{name}</button>

  return (
    <header className={s.bar}>
      <button className={s.logo} onClick={() => navigate('/')} aria-label="Projects">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 14 L8 2 L14 14" fill="none" stroke="var(--acc)" strokeWidth="2" /><path d="M5 10 H11" stroke="var(--tx-1)" strokeWidth="1.6" /></svg>
        Tessery
      </button>
      <DropdownMenu trigger={<button className={s.org}><Building2 size={13} /><span>{org?.name ?? 'No organization'}</span><ChevronDown size={12} /></button>} items={orgItems} />
      <nav className={s.tabs}>
        {tab('Projects', '/', route.name === 'home')}
        {org && tab('Organization', '/settings', route.name === 'settings')}
        {me?.instanceAdmin && tab('Instance admin', '/admin', route.name === 'admin')}
      </nav>
      <div className={s.right}>
        <DropdownMenu align="end" trigger={<Button variant="ghost" size="sm" icon={<User />}>{me?.name}</Button>} items={[
          { kind: 'heading', label: me?.email ?? '' },
          { label: 'Account', icon: <Settings />, onSelect: () => navigate('/account') },
          ...(me?.instanceAdmin ? [{ label: 'Instance admin', icon: <Shield />, onSelect: () => navigate('/admin') }] : []),
          { kind: 'separator' as const },
          { label: 'Sign out', icon: <LogOut />, onSelect: signOut },
        ]} />
      </div>
    </header>
  )
}
