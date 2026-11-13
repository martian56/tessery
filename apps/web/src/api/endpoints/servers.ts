import { baseApi } from '../base'
import type { CloudCatalog, Server } from '../types'

export const serversApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    listServers: b.query<Server[], string>({ query: (org) => `/orgs/${org}/servers`, providesTags: ['Servers'] }),
    createServer: b.mutation<Server, { org: string; name: string; address: string; privateKey?: string }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/servers`, method: 'POST', body }),
      invalidatesTags: ['Servers'],
    }),
    updateServer: b.mutation<Server, { org: string; server: string; name?: string; address?: string; privateKey?: string; newKey?: boolean; forgetHostKey?: boolean }>({
      query: ({ org, server, ...body }) => ({ url: `/orgs/${org}/servers/${server}`, method: 'PATCH', body }),
      invalidatesTags: ['Servers'],
    }),
    deleteServer: b.mutation<void, { org: string; server: string; deleteMachine?: boolean }>({
      query: ({ org, server, deleteMachine }) => ({ url: `/orgs/${org}/servers/${server}`, method: 'DELETE', params: deleteMachine ? { deleteMachine: true } : {} }),
      invalidatesTags: ['Servers'],
    }),
    checkServer: b.mutation<Server, { org: string; server: string }>({
      query: ({ org, server }) => ({ url: `/orgs/${org}/servers/${server}/check`, method: 'POST' }),
      invalidatesTags: ['Servers'],
    }),
    provisionServer: b.mutation<Server, { org: string; integrationId: string; name: string; region: string; size: string }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/servers/provision`, method: 'POST', body }),
      invalidatesTags: ['Servers'],
    }),
    cloudCatalog: b.query<CloudCatalog, { org: string; integration: string }>({ query: ({ org, integration }) => `/orgs/${org}/integrations/${integration}/catalog` }),
  }),
})

export const { useListServersQuery, useCreateServerMutation, useUpdateServerMutation, useDeleteServerMutation, useCheckServerMutation, useProvisionServerMutation, useCloudCatalogQuery } = serversApi
