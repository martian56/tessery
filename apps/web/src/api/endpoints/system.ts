import { baseApi } from '../base'
import type { components } from '../schema'

export type VersionInfo = components['schemas']['VersionInfo']

/** How often the running and latest versions are checked. */
export const VERSION_POLL_MS = 5 * 60_000

export const systemApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    systemVersion: b.query<VersionInfo, void>({ query: () => '/system/version' }),
    startUpdate: b.mutation<void, { version: string }>({ query: (body) => ({ url: '/system/update', method: 'POST', body }) }),
  }),
})

export const { useSystemVersionQuery, useStartUpdateMutation } = systemApi
