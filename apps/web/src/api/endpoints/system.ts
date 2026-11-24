import { baseApi } from '../base'
import type { components } from '../schema'

type S = components['schemas']
export type VersionInfo = S['VersionInfo']
export type UpdatesInfo = S['UpdatesInfo']
export type SystemRelease = S['SystemRelease']

/** How often the running and latest versions are checked. */
export const VERSION_POLL_MS = 5 * 60_000

export const systemApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    systemVersion: b.query<VersionInfo, void>({ query: () => '/system/version' }),
    systemUpdates: b.query<UpdatesInfo, void>({ query: () => '/system/updates' }),
    systemReleases: b.query<S['SystemReleaseList'], void>({ query: () => '/system/releases' }),
    startUpdate: b.mutation<void, { version: string }>({ query: (body) => ({ url: '/system/update', method: 'POST', body }) }),
  }),
})

export const { useSystemVersionQuery, useSystemUpdatesQuery, useSystemReleasesQuery, useStartUpdateMutation } = systemApi
