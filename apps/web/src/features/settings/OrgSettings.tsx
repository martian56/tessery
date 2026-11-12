import { Building2, KeyRound, ScrollText, ShieldCheck, Users, UsersRound } from 'lucide-react'
import { useCurrentOrg } from '@/app/currentOrg'
import { usePermissions } from '@/app/usePermissions'
import { Empty } from '@/ui'
import { PageLayout, type NavItem } from '@/features/chrome/PageLayout'
import { GeneralSection } from './GeneralSection'
import { MembersSection } from './MembersSection'
import { TeamsSection } from './TeamsSection'
import { RolesSection } from './RolesSection'
import { AccessSection } from './AccessSection'
import { AuditSection } from './AuditSection'

const SECTIONS: (NavItem & { perm: string })[] = [
  { id: 'general', label: 'General', icon: <Building2 />, perm: 'org:read' },
  { id: 'members', label: 'Members', icon: <Users />, perm: 'member:read' },
  { id: 'teams', label: 'Teams', icon: <UsersRound />, perm: 'team:read' },
  { id: 'roles', label: 'Roles', icon: <KeyRound />, perm: 'role:read' },
  { id: 'access', label: 'Access', icon: <ShieldCheck />, perm: 'role:read' },
  { id: 'audit', label: 'Audit log', icon: <ScrollText />, perm: 'audit:read' },
]

export function OrgSettings({ section }: { section: string }) {
  const { org, isLoading } = useCurrentOrg()
  const perms = usePermissions({ org: org?.id })
  const nav = SECTIONS.filter((x) => perms.can(x.perm))
  const active = nav.some((n) => n.id === section) ? section : 'general'

  let body
  if (!org) body = <Empty title={isLoading ? 'Loading…' : 'No organization selected'} />
  else if (perms.isLoading) body = <Empty title="Loading…" />
  else if (!nav.some((n) => n.id === active)) body = <Empty title="You cannot view this organization's settings" />
  else if (active === 'members') body = <MembersSection org={org.id} perms={perms} />
  else if (active === 'teams') body = <TeamsSection org={org.id} perms={perms} />
  else if (active === 'roles') body = <RolesSection org={org.id} perms={perms} />
  else if (active === 'access') body = <AccessSection org={org.id} perms={perms} />
  else if (active === 'audit') body = <AuditSection org={org.id} />
  else body = <GeneralSection org={org.id} perms={perms} />

  return <PageLayout title={org?.name ?? 'Organization'} nav={nav} active={active} base="/settings">{body}</PageLayout>
}

export type Perms = ReturnType<typeof usePermissions>
