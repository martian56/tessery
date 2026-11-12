import { baseApi } from '../base'
import type { ProjectRecord, ProjectSummary, ProjectVersion } from '../types'
import type { ProjectDoc } from '@tessery/core/domain/types'

export const projectsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    listProjects: b.query<ProjectSummary[], string>({ query: (org) => `/orgs/${org}/projects`, providesTags: ['Projects'] }),
    createProject: b.mutation<ProjectRecord, { org: string; doc: ProjectDoc; teamId?: string | null; slug?: string }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/projects`, method: 'POST', body }),
      invalidatesTags: ['Projects'],
    }),
    getProject: b.query<ProjectRecord, string>({ query: (id) => `/projects/${id}`, providesTags: (_r, _e, id) => [{ type: 'Project', id }] }),
    saveProject: b.mutation<ProjectRecord, { id: string; version: number; doc: ProjectDoc; message?: string }>({
      query: ({ id, ...body }) => ({ url: `/projects/${id}`, method: 'PUT', body }),
      invalidatesTags: ['Projects', 'Versions'],
    }),
    deleteProject: b.mutation<void, string>({ query: (id) => ({ url: `/projects/${id}`, method: 'DELETE' }), invalidatesTags: ['Projects'] }),
    moveProject: b.mutation<void, { id: string; teamId: string | null }>({ query: ({ id, teamId }) => ({ url: `/projects/${id}/team`, method: 'PATCH', body: { teamId } }), invalidatesTags: ['Projects', 'Permissions'] }),
    projectVersions: b.query<ProjectVersion[], string>({ query: (id) => `/projects/${id}/versions`, providesTags: ['Versions'] }),
    projectVersion: b.query<{ version: number; doc: ProjectDoc }, { id: string; version: number }>({ query: ({ id, version }) => `/projects/${id}/versions/${version}` }),
  }),
})

export const {
  useListProjectsQuery, useCreateProjectMutation, useGetProjectQuery, useLazyGetProjectQuery, useSaveProjectMutation, useDeleteProjectMutation, useMoveProjectMutation,
  useProjectVersionsQuery, useLazyProjectVersionQuery,
} = projectsApi
