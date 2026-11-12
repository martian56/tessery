import { baseApi } from '../base'
import type { AuditExport, AuditPage, AuditResult, Binding, CreateBinding, Member, Org, PermissionInfo, Role, Team, TeamDetail } from '../types'

export interface AuditFilter { actor?: string; action?: string; result?: AuditResult; since?: string; until?: string }

const changesAccess = ['Bindings', 'Members', 'Permissions', 'Projects'] as const

export const orgsApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    createOrg: b.mutation<Org, { name: string; slug?: string }>({ query: (body) => ({ url: '/orgs', method: 'POST', body }), invalidatesTags: ['Orgs'] }),
    getOrg: b.query<Org, string>({ query: (org) => `/orgs/${org}`, providesTags: ['Orgs'] }),
    updateOrg: b.mutation<Org, { org: string; name: string; slug: string }>({ query: ({ org, ...body }) => ({ url: `/orgs/${org}`, method: 'PATCH', body }), invalidatesTags: ['Orgs'] }),
    deleteOrg: b.mutation<void, string>({ query: (org) => ({ url: `/orgs/${org}`, method: 'DELETE' }), invalidatesTags: ['Orgs'] }),

    listMembers: b.query<Member[], string>({ query: (org) => `/orgs/${org}/members`, providesTags: ['Members'] }),
    addMember: b.mutation<Member, { org: string; email: string; name?: string; password?: string; role?: string }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/members`, method: 'POST', body }),
      invalidatesTags: [...changesAccess],
    }),
    removeMember: b.mutation<void, { org: string; user: string }>({ query: ({ org, user }) => ({ url: `/orgs/${org}/members/${user}`, method: 'DELETE' }), invalidatesTags: [...changesAccess, 'Teams', 'Team'] }),

    listTeams: b.query<Team[], string>({ query: (org) => `/orgs/${org}/teams`, providesTags: ['Teams'] }),
    getTeam: b.query<TeamDetail, { org: string; team: string }>({ query: ({ org, team }) => `/orgs/${org}/teams/${team}`, providesTags: ['Team'] }),
    createTeam: b.mutation<Team, { org: string; name: string; slug?: string; description?: string }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/teams`, method: 'POST', body }),
      invalidatesTags: ['Teams'],
    }),
    updateTeam: b.mutation<Team, { org: string; team: string; name: string; slug?: string; description?: string }>({
      query: ({ org, team, ...body }) => ({ url: `/orgs/${org}/teams/${team}`, method: 'PATCH', body }),
      invalidatesTags: ['Teams', 'Team'],
    }),
    deleteTeam: b.mutation<void, { org: string; team: string }>({ query: ({ org, team }) => ({ url: `/orgs/${org}/teams/${team}`, method: 'DELETE' }), invalidatesTags: ['Teams', ...changesAccess] }),
    addTeamMember: b.mutation<void, { org: string; team: string; userId: string }>({
      query: ({ org, team, userId }) => ({ url: `/orgs/${org}/teams/${team}/members`, method: 'POST', body: { userId } }),
      invalidatesTags: ['Teams', 'Team', 'Permissions', 'Projects'],
    }),
    removeTeamMember: b.mutation<void, { org: string; team: string; user: string }>({
      query: ({ org, team, user }) => ({ url: `/orgs/${org}/teams/${team}/members/${user}`, method: 'DELETE' }),
      invalidatesTags: ['Teams', 'Team', 'Permissions', 'Projects'],
    }),

    permissionCatalog: b.query<PermissionInfo[], void>({ query: () => '/permissions' }),
    listRoles: b.query<Role[], string>({ query: (org) => `/orgs/${org}/roles`, providesTags: ['Roles'] }),
    createRole: b.mutation<Role, { org: string; key?: string; name: string; description?: string; permissions: string[] }>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/roles`, method: 'POST', body }),
      invalidatesTags: ['Roles'],
    }),
    updateRole: b.mutation<Role, { org: string; role: string; name: string; description?: string; permissions: string[] }>({
      query: ({ org, role, ...body }) => ({ url: `/orgs/${org}/roles/${role}`, method: 'PATCH', body }),
      invalidatesTags: ['Roles', ...changesAccess],
    }),
    deleteRole: b.mutation<void, { org: string; role: string }>({ query: ({ org, role }) => ({ url: `/orgs/${org}/roles/${role}`, method: 'DELETE' }), invalidatesTags: ['Roles', ...changesAccess] }),

    listBindings: b.query<Binding[], string>({ query: (org) => `/orgs/${org}/bindings`, providesTags: ['Bindings'] }),
    createBinding: b.mutation<Binding, { org: string } & CreateBinding>({ query: ({ org, ...body }) => ({ url: `/orgs/${org}/bindings`, method: 'POST', body }), invalidatesTags: [...changesAccess] }),
    deleteBinding: b.mutation<void, { org: string; binding: string }>({ query: ({ org, binding }) => ({ url: `/orgs/${org}/bindings/${binding}`, method: 'DELETE' }), invalidatesTags: [...changesAccess] }),

    auditLog: b.query<AuditPage, { org: string; before?: number; limit?: number } & AuditFilter>({
      query: ({ org, ...params }) => ({ url: `/orgs/${org}/audit`, params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) }),
      providesTags: ['Audit'],
    }),
    createExport: b.mutation<AuditExport, { org: string; format: 'json' | 'csv' } & AuditFilter>({
      query: ({ org, ...body }) => ({ url: `/orgs/${org}/audit/exports`, method: 'POST', body }),
      invalidatesTags: ['Audit'],
    }),
    getExport: b.query<AuditExport, { org: string; id: string }>({ query: ({ org, id }) => `/orgs/${org}/audit/exports/${id}` }),
  }),
})

export const {
  useCreateOrgMutation, useGetOrgQuery, useUpdateOrgMutation, useDeleteOrgMutation,
  useListMembersQuery, useAddMemberMutation, useRemoveMemberMutation,
  useListTeamsQuery, useGetTeamQuery, useCreateTeamMutation, useUpdateTeamMutation, useDeleteTeamMutation, useAddTeamMemberMutation, useRemoveTeamMemberMutation,
  usePermissionCatalogQuery, useListRolesQuery, useCreateRoleMutation, useUpdateRoleMutation, useDeleteRoleMutation,
  useListBindingsQuery, useCreateBindingMutation, useDeleteBindingMutation,
  useAuditLogQuery, useCreateExportMutation, useGetExportQuery,
} = orgsApi
