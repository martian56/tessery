import { baseApi, CSRF_HEADER } from '../base'
import type { components } from '../schema'
import { API_URL } from '@/config/env'

export type Asset = components['schemas']['AssetDto']

export const assetsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    assets: b.query<Asset[], string>({ query: (pid) => `/projects/${pid}/assets`, providesTags: ['Assets'] }),
    deleteAsset: b.mutation<void, { pid: string; id: string }>({ query: ({ pid, id }) => ({ url: `/projects/${pid}/assets/${id}`, method: 'DELETE' }), invalidatesTags: ['Assets'] }),
  }),
})

export const { useAssetsQuery, useDeleteAssetMutation } = assetsApi

/** Uploads a file as the raw request body; the server detects its type from the content. */
export async function uploadAsset(pid: string, file: File): Promise<Asset> {
  const r = await fetch(`${API_URL}/projects/${pid}/assets/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { [CSRF_HEADER]: '1', 'content-type': 'application/octet-stream' },
    body: file,
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.message ?? `Upload failed with ${r.status}`)
  return body as Asset
}
