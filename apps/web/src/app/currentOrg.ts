import { useSyncExternalStore } from 'react'
import { useListOrgsQuery } from '@/api/endpoints/identity'
import type { OrgListItem } from '@/api/types'

const KEY = 'tessery.currentOrg'
const subs = new Set<() => void>()
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }

export function setCurrentOrg(id: string) {
  try { localStorage.setItem(KEY, id) } catch {}
  subs.forEach((f) => f())
}

export function useCurrentOrg(): { org: OrgListItem | undefined; orgs: OrgListItem[]; isLoading: boolean } {
  const stored = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, read)
  const { data, isLoading } = useListOrgsQuery()
  const orgs = data ?? []
  const org = orgs.find((o) => o.id === stored) ?? orgs.find((o) => o.member) ?? orgs[0]
  return { org, orgs, isLoading }
}
