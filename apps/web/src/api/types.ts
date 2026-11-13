import type { components } from './schema'

type S = components['schemas']

export type User = S['UserDto']
export type Org = S['OrgDto']
export type OrgListItem = S['OrgListItem']
export type Member = S['MemberDto']
export type Team = S['TeamDto']
export type TeamDetail = S['TeamDetail']
export type Role = S['RoleDto']
export type PermissionInfo = S['PermissionInfo']
export type Binding = S['BindingDto']
export type CreateBinding = S['CreateBinding']
export type SubjectKind = S['SubjectKind']
export type ScopeKind = S['ScopeKind']
export type ProjectSummary = S['ProjectSummaryDto']
export type ProjectRecord = S['ProjectDto']
export type ProjectVersion = S['VersionDto']
export type AuditEvent = S['AuditEventDto']
export type AuditPage = S['AuditPage']
export type AuditResult = S['AuditResult']
export type AuditExport = S['ExportDto']
export type MyPermissions = S['MyPermissions']
export type InstanceSettings = S['Settings']
export type Health = S['Health']
export type Checkpoint = S['CheckpointDto']
export type Release = S['ReleaseDto']
export type ReleasePreview = S['ReleasePreviewDto']
export type ReleaseStatus = S['ReleaseStatus']
export type Pipeline = S['PipelineDto']
export type Stage = S['StageDto']
export type Remote = S['RemoteDto']
export type ReleaseLog = S['ReleaseLogDto']
export type SecretInfo = S['SecretDto']
export interface Endpoint { name: string; url: string }
export type CheckpointDiff = S['DiffDto']

export interface ApiErrorBody { error: { code: string; message: string; field?: string; permission?: string } }

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as { status?: number | string; data?: ApiErrorBody }
  if (err?.data?.error?.message) return err.data.error.message
  if (err?.status === 'FETCH_ERROR') return 'Cannot reach the Tessery server'
  return fallback
}

export function errorCode(e: unknown): string | undefined {
  return (e as { data?: ApiErrorBody })?.data?.error?.code
}
