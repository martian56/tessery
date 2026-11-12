import { useMyPermissionsQuery } from '@/api/endpoints/identity'

export function usePermissions(scope: { org?: string; team?: string; project?: string; env?: string }) {
  const { data, isLoading } = useMyPermissionsQuery({ org: scope.org ?? '', team: scope.team, project: scope.project, env: scope.env }, { skip: !scope.org })
  const set = new Set(data?.permissions ?? [])
  return {
    isLoading,
    bypass: !!data?.bypass,
    has: (p: string) => set.has(p),
    can: (p: string) => set.has(p) || !!data?.bypass,
  }
}
