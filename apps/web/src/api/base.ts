import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { API_URL } from '@/config/env'

export const CSRF_HEADER = 'x-tessery-csrf'

const raw = fetchBaseQuery({
  baseUrl: API_URL,
  credentials: 'include',
  prepareHeaders: (h) => {
    h.set(CSRF_HEADER, '1')
    return h
  },
})

export function restartSignedOut() {
  window.location.assign('/')
}

const PUBLIC = new Set(['/auth/me', '/auth/login', '/setup'])

const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await raw(args, api, extra)
  const url = typeof args === 'string' ? args : args.url
  if (result.error?.status === 401 && !PUBLIC.has(url)) restartSignedOut()
  return result
}

export const baseApi = createApi({
  reducerPath: 'tesseryApi',
  baseQuery,
  tagTypes: ['Me', 'Setup', 'Orgs', 'Members', 'Teams', 'Team', 'Roles', 'Bindings', 'Permissions', 'Projects', 'Project', 'Versions', 'Audit', 'AdminUsers', 'AdminSettings', 'Checkpoints', 'Pipeline', 'Releases', 'Remote', 'Secrets', 'Servers', 'Integrations', 'Backups', 'Notifications', 'Alerts'],
  endpoints: () => ({}),
})
