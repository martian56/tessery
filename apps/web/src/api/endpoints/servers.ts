import { baseApi } from '../base'
import type { Server } from '../types'

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
    deleteServer: b.mutation<void, { org: string; server: string }>({
      query: ({ org, server }) => ({ url: `/orgs/${org}/servers/${server}`, method: 'DELETE' }),
      invalidatesTags: ['Servers'],
    }),
    checkServer: b.mutation<Server, { org: string; server: string }>({
      query: ({ org, server }) => ({ url: `/orgs/${org}/servers/${server}/check`, method: 'POST' }),
      invalidatesTags: ['Servers'],
    }),
  }),
})

export const { useListServersQuery, useCreateServerMutation, useUpdateServerMutation, useDeleteServerMutation, useCheckServerMutation } = serversApi
