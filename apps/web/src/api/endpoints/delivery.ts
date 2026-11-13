import { baseApi } from '../base'
import type { Checkpoint, CheckpointDiff, Pipeline, Release, ReleaseLog, ReleasePreview, Remote, SecretInfo } from '../types'
import type { ProjectDoc } from '@tessery/core/domain/types'

const releaseChanges = ['Pipeline', 'Releases'] as const

export const deliveryApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    checkpoints: b.query<Checkpoint[], string>({ query: (pid) => `/projects/${pid}/checkpoints`, providesTags: ['Checkpoints'] }),
    createCheckpoint: b.mutation<Checkpoint, { pid: string; name: string; message?: string; version: number }>({
      query: ({ pid, ...body }) => ({ url: `/projects/${pid}/checkpoints`, method: 'POST', body }),
      invalidatesTags: ['Checkpoints', 'Pipeline', 'Remote'],
    }),
    checkpointDoc: b.query<{ doc: ProjectDoc }, { pid: string; id: string }>({ query: ({ pid, id }) => `/projects/${pid}/checkpoints/${id}/doc` }),
    checkpointDiff: b.query<CheckpointDiff, { pid: string; id: string; base?: string }>({
      query: ({ pid, id, base }) => ({ url: `/projects/${pid}/checkpoints/${id}/diff`, params: base ? { base } : {} }),
    }),

    pipeline: b.query<Pipeline, string>({ query: (pid) => `/projects/${pid}/pipeline`, providesTags: ['Pipeline'] }),
    releases: b.query<Release[], string>({ query: (pid) => `/projects/${pid}/releases`, providesTags: ['Releases'] }),
    releasePreview: b.query<ReleasePreview, { pid: string; env: string; checkpointId: string }>({
      query: ({ pid, env, checkpointId }) => ({ url: `/projects/${pid}/releases/preview`, params: { env, checkpointId } }),
      keepUnusedDataFor: 0,
    }),
    createRelease: b.mutation<Release, { pid: string; env: string; checkpointId: string; note?: string; redeploy?: boolean; confirmDestructive?: boolean }>({
      query: ({ pid, ...body }) => ({ url: `/projects/${pid}/releases`, method: 'POST', body }),
      invalidatesTags: [...releaseChanges, 'Remote'],
    }),
    decideRelease: b.mutation<Release, { id: string; verdict: 'approve' | 'reject' | 'cancel'; note?: string }>({
      query: ({ id, verdict, note }) => ({ url: `/releases/${id}/${verdict}`, method: 'POST', body: { note: note ?? '' } }),
      invalidatesTags: [...releaseChanges, 'Remote'],
    }),

    stopEnv: b.mutation<void, { pid: string; env: string }>({
      query: ({ pid, env }) => ({ url: `/projects/${pid}/environments/${env}/stop`, method: 'POST' }),
      invalidatesTags: ['Pipeline', 'Releases'],
    }),
    releaseLog: b.query<ReleaseLog, { id: string; after: number }>({ query: ({ id, after }) => ({ url: `/releases/${id}/logs`, params: { after } }) }),

    secrets: b.query<SecretInfo[], { pid: string; env: string }>({ query: ({ pid, env }) => `/projects/${pid}/environments/${env}/secrets`, providesTags: ['Secrets'] }),
    putSecret: b.mutation<void, { pid: string; env: string; name: string; value: string }>({
      query: ({ pid, env, name, value }) => ({ url: `/projects/${pid}/environments/${env}/secrets/${name}`, method: 'PUT', body: { value } }),
      invalidatesTags: ['Secrets'],
    }),
    deleteSecret: b.mutation<void, { pid: string; env: string; name: string }>({
      query: ({ pid, env, name }) => ({ url: `/projects/${pid}/environments/${env}/secrets/${name}`, method: 'DELETE' }),
      invalidatesTags: ['Secrets'],
    }),

    remote: b.query<Remote | null, string>({ query: (pid) => `/projects/${pid}/remote`, providesTags: ['Remote'] }),
    putRemote: b.mutation<Remote, { pid: string; url: string; username: string; token?: string; autoPush: boolean }>({
      query: ({ pid, ...body }) => ({ url: `/projects/${pid}/remote`, method: 'PUT', body }),
      invalidatesTags: ['Remote'],
    }),
    deleteRemote: b.mutation<void, string>({ query: (pid) => ({ url: `/projects/${pid}/remote`, method: 'DELETE' }), invalidatesTags: ['Remote'] }),
    pushRemote: b.mutation<void, string>({ query: (pid) => ({ url: `/projects/${pid}/remote/push`, method: 'POST' }), invalidatesTags: ['Remote'] }),
  }),
})

export const {
  useCheckpointsQuery, useCreateCheckpointMutation, useLazyCheckpointDocQuery, useCheckpointDiffQuery,
  usePipelineQuery, useReleasesQuery, useLazyReleasePreviewQuery, useCreateReleaseMutation, useDecideReleaseMutation,
  useStopEnvMutation, useLazyReleaseLogQuery, useSecretsQuery, usePutSecretMutation, useDeleteSecretMutation,
  useRemoteQuery, usePutRemoteMutation, useDeleteRemoteMutation, usePushRemoteMutation,
} = deliveryApi
