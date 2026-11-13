import { baseApi } from '../base'
import type { components } from '../schema'

type S = components['schemas']
export type Channel = S['ChannelDto']
export type NotificationEvent = S['EventDto']

export const notificationsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    notificationEvents: b.query<NotificationEvent[], void>({ query: () => '/notifications/events' }),
    channels: b.query<Channel[], string>({ query: (pid) => `/projects/${pid}/notifications`, providesTags: ['Notifications'] }),
    addChannel: b.mutation<Channel, { pid: string; body: S['NewChannelInput'] }>({
      query: ({ pid, body }) => ({ url: `/projects/${pid}/notifications`, method: 'POST', body }),
      invalidatesTags: ['Notifications'],
    }),
    updateChannel: b.mutation<Channel, { pid: string; id: string; body: S['UpdateChannelInput'] }>({
      query: ({ pid, id, body }) => ({ url: `/projects/${pid}/notifications/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Notifications'],
    }),
    deleteChannel: b.mutation<void, { pid: string; id: string }>({
      query: ({ pid, id }) => ({ url: `/projects/${pid}/notifications/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Notifications'],
    }),
    testChannel: b.mutation<void, { pid: string; id: string }>({
      query: ({ pid, id }) => ({ url: `/projects/${pid}/notifications/${id}/test`, method: 'POST' }),
      invalidatesTags: ['Notifications'],
    }),
  }),
})

export const { useNotificationEventsQuery, useChannelsQuery, useAddChannelMutation, useUpdateChannelMutation, useDeleteChannelMutation, useTestChannelMutation } = notificationsApi
