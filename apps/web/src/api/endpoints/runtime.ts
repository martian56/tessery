import { baseApi } from '../base'
import type { components } from '../schema'

type S = components['schemas']
export type EnvStatus = S['EnvStatusDto']
export type NodeStatus = S['NodeStatusDto']
export type Instance = S['InstanceDto']
export type EnvLogLine = S['EnvLogLineDto']
export type Rows = S['RowsDto']
export type SqlResult = S['SqlResultDto']
export type TraceSummary = S['TraceSummaryDto']
export type TraceSpan = S['SpanDto']

const env = (pid: string, e: string) => `/projects/${pid}/environments/${e}`

export const runtimeApi = baseApi.injectEndpoints({
  endpoints: (b) => ({
    envStatus: b.query<EnvStatus, { pid: string; env: string }>({ query: ({ pid, env: e }) => `${env(pid, e)}/status` }),
    envLogs: b.query<EnvLogLine[], { pid: string; env: string; node?: string; level?: string; q?: string; limit?: number }>({
      query: ({ pid, env: e, ...q }) => ({ url: `${env(pid, e)}/logs`, params: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) }),
    }),
    envTraces: b.query<TraceSummary[], { pid: string; env: string; service?: string; errors?: boolean; limit?: number }>({
      query: ({ pid, env: e, ...q }) => ({ url: `${env(pid, e)}/traces`, params: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== false)) }),
    }),
    envTrace: b.query<TraceSpan[], { pid: string; env: string; trace: string }>({ query: ({ pid, env: e, trace }) => `${env(pid, e)}/traces/${trace}` }),
    dbTables: b.query<{ tables: string[] }, { pid: string; env: string; node: string }>({ query: ({ pid, env: e, node }) => `${env(pid, e)}/databases/${node}/tables` }),
    dbRows: b.query<Rows, { pid: string; env: string; node: string; table: string; page: number; pageSize: number; sort?: string; filter?: string }>({
      query: ({ pid, env: e, node, table, ...q }) => ({ url: `${env(pid, e)}/databases/${node}/tables/${table}/rows`, params: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) }),
    }),
    dbSql: b.mutation<SqlResult, { pid: string; env: string; node: string; sql: string }>({
      query: ({ pid, env: e, node, sql }) => ({ url: `${env(pid, e)}/databases/${node}/sql`, method: 'POST', body: { sql } }),
    }),
  }),
})

export const { useEnvStatusQuery, useEnvLogsQuery, useEnvTracesQuery, useEnvTraceQuery, useDbTablesQuery, useDbRowsQuery, useDbSqlMutation } = runtimeApi
