import type { DeployTarget } from '@tessery/core/domain/types'
import { useListServersQuery } from '@/api/endpoints/servers'
import { usePermissions } from '@/app/usePermissions'
import { useAppSelector } from '@/store'

export function useDockerHostLabel() {
  const org = useAppSelector((st) => st.project.orgId) ?? undefined
  const perms = usePermissions({ org })
  const { data: servers } = useListServersQuery(org ?? '', { skip: !org || !perms.can('server:read') })
  return (t: DeployTarget | undefined): string => {
    if (t?.kind !== 'docker') return ''
    const server = t.server && servers?.find((sv) => sv.id === t.server)
    if (server) return server.name
    return t.host ? t.host.replace(/^\w+:\/\//, '') : 'this server'
  }
}
