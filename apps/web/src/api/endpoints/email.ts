import { baseApi } from '../base'
import type { components } from '../schema'

type S = components['schemas']
export type EmailSettings = S['EmailSettingsDto']
export type SmtpSettings = S['SmtpSettings']

export const emailApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    emailSettings: b.query<EmailSettings, void>({ query: () => '/admin/email', providesTags: ['AdminSettings'] }),
    saveEmailSettings: b.mutation<EmailSettings, { settings: SmtpSettings | null; password?: string }>({
      query: (body) => ({ url: '/admin/email', method: 'PUT', body }),
      invalidatesTags: ['AdminSettings'],
    }),
    testEmail: b.mutation<void, { to: string }>({ query: (body) => ({ url: '/admin/email/test', method: 'POST', body }) }),
    forgotPassword: b.mutation<void, { email: string }>({ query: (body) => ({ url: '/auth/password/forgot', method: 'POST', body }) }),
    passwordToken: b.query<S['TokenInfo'], string>({ query: (token) => ({ url: '/auth/password/token', params: { token } }) }),
    resetPassword: b.mutation<void, { token: string; password: string }>({ query: (body) => ({ url: '/auth/password/reset', method: 'POST', body }) }),
  }),
})

export const { useEmailSettingsQuery, useSaveEmailSettingsMutation, useTestEmailMutation, useForgotPasswordMutation, usePasswordTokenQuery, useResetPasswordMutation } = emailApi
