import { baseApi } from '../base'
import type { Integration, ProviderSpec } from '../types'

export const integrationsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    providers: b.query<ProviderSpec[], void>({ query: () => '/integrations/providers' }),
    listIntegrations: b.query<Integration[], string>({ query: (org) => `/orgs/${org}/integrations`, providesTags: ['Integrations'] }),
    createIntegration: b.mutation<Integration, { org: string; provider: string; name: string; fields: Record<string, string> }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/integrations`, method: 'POST', body }),
      invalidatesTags: ['Integrations'],
    }),
    updateIntegration: b.mutation<Integration, { org: string; id: string; name?: string; fields?: Record<string, string> }>({
      query: ({ org, id, ...body }) => ({ url: `/orgs/${org}/integrations/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Integrations'],
    }),
    checkIntegration: b.mutation<Integration, { org: string; id: string }>({
      query: ({ org, id }) => ({ url: `/orgs/${org}/integrations/${id}/check`, method: 'POST' }),
      invalidatesTags: ['Integrations'],
    }),
    deleteIntegration: b.mutation<void, { org: string; id: string }>({
      query: ({ org, id }) => ({ url: `/orgs/${org}/integrations/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Integrations'],
    }),
  }),
})

export const { useProvidersQuery, useListIntegrationsQuery, useCreateIntegrationMutation, useUpdateIntegrationMutation, useCheckIntegrationMutation, useDeleteIntegrationMutation } = integrationsApi
