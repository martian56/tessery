import { baseApi } from '../base'
import type { components } from '../schema'

type S = components['schemas']
export type OrgSecurity = S['OrgSecurity']

export const twoFactorApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    loginTwoFactor: b.mutation<S['UserDto'], { ticket: string; code: string }>({ query: (body) => ({ url: '/auth/login/two-factor', method: 'POST', body }), invalidatesTags: ['Me', 'Orgs'] }),
    twoFactorStatus: b.query<S['TwoFactorStatus'], void>({ query: () => '/auth/two-factor', providesTags: ['TwoFactor'] }),
    twoFactorSetup: b.mutation<S['TwoFactorSetup'], void>({ query: () => ({ url: '/auth/two-factor/setup', method: 'POST' }) }),
    twoFactorEnable: b.mutation<S['RecoveryCodes'], { code: string }>({ query: (body) => ({ url: '/auth/two-factor/enable', method: 'POST', body }), invalidatesTags: ['TwoFactor', 'Me'] }),
    twoFactorDisable: b.mutation<void, { password: string }>({ query: (body) => ({ url: '/auth/two-factor/disable', method: 'POST', body }), invalidatesTags: ['TwoFactor', 'Me'] }),
    twoFactorNewCodes: b.mutation<S['RecoveryCodes'], { code: string }>({ query: (body) => ({ url: '/auth/two-factor/recovery-codes', method: 'POST', body }), invalidatesTags: ['TwoFactor'] }),
    orgSecurity: b.query<OrgSecurity, string>({ query: (org) => `/orgs/${org}/security`, providesTags: ['OrgSecurity'] }),
    putOrgSecurity: b.mutation<OrgSecurity, { org: string; requireTwoFactor: boolean }>({
      query: ({ org, requireTwoFactor }) => ({ url: `/orgs/${org}/security`, method: 'PUT', body: { requireTwoFactor } }),
      invalidatesTags: ['OrgSecurity'],
    }),
    resetMemberTwoFactor: b.mutation<void, { org: string; user: string }>({ query: ({ org, user }) => ({ url: `/orgs/${org}/members/${user}/two-factor`, method: 'DELETE' }), invalidatesTags: ['OrgSecurity'] }),
  }),
})

export const {
  useLoginTwoFactorMutation, useTwoFactorStatusQuery, useTwoFactorSetupMutation, useTwoFactorEnableMutation, useTwoFactorDisableMutation,
  useTwoFactorNewCodesMutation, useOrgSecurityQuery, usePutOrgSecurityMutation, useResetMemberTwoFactorMutation,
} = twoFactorApi
