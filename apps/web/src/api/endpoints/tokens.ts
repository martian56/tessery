import { baseApi } from '../base'
import type { components } from '../schema'

export type ApiToken = components['schemas']['TokenDto']
export type CreatedToken = components['schemas']['CreatedToken']

export const tokensApi = baseApi.enhanceEndpoints({ addTagTypes: ['Tokens'] }).injectEndpoints({
  endpoints: (b) => ({
    tokens: b.query<ApiToken[], void>({ query: () => '/auth/tokens', providesTags: ['Tokens'] }),
    createToken: b.mutation<CreatedToken, { name: string; permissions?: string[]; projectId?: string; expiresInDays?: number }>({
      query: (body) => ({ url: '/auth/tokens', method: 'POST', body }),
      invalidatesTags: ['Tokens'],
    }),
    revokeToken: b.mutation<void, string>({ query: (id) => ({ url: `/auth/tokens/${id}`, method: 'DELETE' }), invalidatesTags: ['Tokens'] }),
  }),
})

export const { useTokensQuery, useCreateTokenMutation, useRevokeTokenMutation } = tokensApi
