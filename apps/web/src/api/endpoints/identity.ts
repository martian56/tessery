import { baseApi } from '../base'
import type { InstanceSettings, MyPermissions, Org, OrgListItem, User } from '../types'

export const identityApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    setupStatus: b.query<{ required: boolean }, void>({ query: () => '/setup', providesTags: ['Setup'] }),
    setup: b.mutation<{ user: User; orgId: string }, { email: string; name: string; password: string; orgName: string }>({
      query: (body) => ({ url: '/setup', method: 'POST', body }),
      invalidatesTags: ['Setup', 'Me', 'Orgs'],
    }),
    me: b.query<User, void>({ query: () => '/auth/me', providesTags: ['Me'] }),
    login: b.mutation<User, { email: string; password: string }>({ query: (body) => ({ url: '/auth/login', method: 'POST', body }), invalidatesTags: ['Me', 'Orgs'] }),
    logout: b.mutation<void, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
    updateMe: b.mutation<User, { name: string }>({ query: (body) => ({ url: '/auth/me', method: 'PATCH', body }), invalidatesTags: ['Me'] }),
    ssoInfo: b.query<{ enabled: boolean; name?: string | null }, void>({ query: () => '/auth/sso' }),
    changePassword: b.mutation<void, { currentPassword: string; newPassword: string }>({ query: (body) => ({ url: '/auth/password', method: 'POST', body }) }),
    myPermissions: b.query<MyPermissions, { org: string; team?: string; project?: string; env?: string }>({
      query: (params) => ({ url: '/me/permissions', params }),
      providesTags: ['Permissions'],
    }),

    listOrgs: b.query<OrgListItem[], void>({ query: () => '/orgs', providesTags: ['Orgs'] }),

    adminUsers: b.query<User[], void>({ query: () => '/admin/users', providesTags: ['AdminUsers'] }),
    adminUpdateUser: b.mutation<User, { id: string; instanceAdmin?: boolean; disabled?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/admin/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['AdminUsers', 'Members'],
    }),
    adminOrgs: b.query<Org[], void>({ query: () => '/admin/orgs', providesTags: ['Orgs'] }),
    adminSettings: b.query<InstanceSettings, void>({ query: () => '/admin/settings', providesTags: ['AdminSettings'] }),
    putAdminSettings: b.mutation<InstanceSettings, InstanceSettings>({ query: (body) => ({ url: '/admin/settings', method: 'PUT', body }), invalidatesTags: ['AdminSettings'] }),
  }),
})

export const {
  useSetupStatusQuery, useSetupMutation, useMeQuery, useLoginMutation, useLogoutMutation, useUpdateMeMutation, useChangePasswordMutation, useSsoInfoQuery,
  useMyPermissionsQuery, useListOrgsQuery, useAdminUsersQuery, useAdminUpdateUserMutation, useAdminOrgsQuery, useAdminSettingsQuery, usePutAdminSettingsMutation,
} = identityApi
