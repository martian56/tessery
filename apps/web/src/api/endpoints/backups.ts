import { baseApi } from '../base'
import type { Backup } from '../types'

export const backupsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    backups: b.query<Backup[], { pid: string; env: string }>({ query: ({ pid, env }) => `/projects/${pid}/environments/${env}/backups`, providesTags: ['Backups'] }),
    backupNow: b.mutation<Backup[], { pid: string; env: string }>({
      query: ({ pid, env }) => ({ url: `/projects/${pid}/environments/${env}/backups`, method: 'POST' }),
      invalidatesTags: ['Backups'],
    }),
    restoreBackup: b.mutation<Backup, { id: string; confirm: string }>({
      query: ({ id, confirm }) => ({ url: `/backups/${id}/restore`, method: 'POST', body: { confirm } }),
      invalidatesTags: ['Backups'],
    }),
  }),
})

export const { useBackupsQuery, useBackupNowMutation, useRestoreBackupMutation } = backupsApi
