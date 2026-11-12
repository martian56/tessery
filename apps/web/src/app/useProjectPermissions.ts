import { useAppSelector } from '@/store'
import { usePermissions } from './usePermissions'

export function useProjectPermissions() {
  const org = useAppSelector((s) => s.project.orgId) ?? undefined
  const project = useAppSelector((s) => s.project.doc?.id)
  const env = useAppSelector((s) => s.ui.envId) || undefined
  return usePermissions({ org, project, env })
}
