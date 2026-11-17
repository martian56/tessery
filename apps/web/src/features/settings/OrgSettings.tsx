import { useCurrentOrg } from '@/app/currentOrg'
import { usePermissions } from '@/app/usePermissions'
import { Empty } from '@/ui'
import { PageLayout, PageSkeleton } from '@/features/chrome/PageLayout'
import { ORG_SECTIONS as SECTIONS } from '@/features/chrome/nav'
import { GeneralSection } from './GeneralSection'
import { MembersSection } from './MembersSection'
import { TeamsSection } from './TeamsSection'
import { RolesSection } from './RolesSection'
import { AccessSection } from './AccessSection'
import { AuditSection } from './AuditSection'
import { ServersSection } from './ServersSection'
import { IntegrationsSection } from './IntegrationsSection'

export function OrgSettings({ section }: { section: string }) {
  const { org, isLoading } = useCurrentOrg()
  const perms = usePermissions({ org: org?.id })
  const nav = SECTIONS.filter((x) => perms.can(x.perm))
  const active = nav.some((n) => n.id === section) ? section : 'general'

  let body
  if (!org) body = isLoading ? <PageSkeleton /> : <Empty title="No organization selected" />
  else if (perms.isLoading) body = <PageSkeleton />
  else if (!nav.some((n) => n.id === active)) body = <Empty title="You cannot view this organization's settings" />
  else if (active === 'members') body = <MembersSection org={org.id} perms={perms} />
  else if (active === 'teams') body = <TeamsSection org={org.id} perms={perms} />
  else if (active === 'integrations') body = <IntegrationsSection org={org.id} perms={perms} />
  else if (active === 'servers') body = <ServersSection org={org.id} perms={perms} />
  else if (active === 'roles') body = <RolesSection org={org.id} perms={perms} />
  else if (active === 'access') body = <AccessSection org={org.id} perms={perms} />
  else if (active === 'audit') body = <AuditSection org={org.id} />
  else body = <GeneralSection org={org.id} perms={perms} />

  return <PageLayout title={org?.name ?? 'Organization'} nav={nav} active={active} base="/settings">{body}</PageLayout>
}

export type Perms = ReturnType<typeof usePermissions>
