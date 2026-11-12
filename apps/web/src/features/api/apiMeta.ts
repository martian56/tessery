import type { ApiSpec, ApiStyle, Operation, TypeDef } from '@tessery/core/domain/types'

export interface OpView { badge: string; color: string; title: string }

const METHOD_COLOR: Record<string, string> = { GET: 'var(--ok)', POST: 'var(--info)', PUT: 'var(--warn)', PATCH: 'var(--warn)', DELETE: 'var(--err)' }

export function opView(style: ApiStyle, o: Operation): OpView {
  if (style === 'graphql' || style === 'trpc') return { badge: o.kind.slice(0, 3).toUpperCase(), color: o.kind === 'mutation' ? 'var(--info)' : o.kind === 'subscription' ? 'var(--c-client)' : 'var(--ok)', title: o.name }
  if (style === 'grpc') return { badge: o.streaming && o.streaming !== 'none' ? 'STRM' : 'RPC', color: '#4aa3df', title: o.name }
  if (style === 'websocket') { const [dir, ...ev] = o.kind.split(' '); return { badge: dir.toUpperCase().slice(0, 5), color: 'var(--c-client)', title: ev.join(' ') || o.name } }
  if (style === 'soap') return { badge: 'SOAP', color: 'var(--tx-3)', title: o.name }
  const [m, p] = o.kind.split(' ')
  return { badge: m, color: METHOD_COLOR[m] ?? 'var(--tx-3)', title: p ?? o.name }
}

export const KIND_OPTIONS: Record<ApiStyle, string[]> = {
  rest: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], webhook: ['POST', 'PUT'], sse: ['GET', 'POST'],
  graphql: ['query', 'mutation', 'subscription'], trpc: ['query', 'mutation', 'subscription'],
  grpc: ['rpc'], websocket: ['join', 'push', 'event'], soap: ['operation'],
}
export const isPathStyle = (s: ApiStyle) => s === 'rest' || s === 'webhook' || s === 'sse'

export function newOperation(spec: ApiSpec): { kind: string; name: string; summary: string } {
  const n = spec.operations.length + 1
  switch (spec.style) {
    case 'graphql': case 'trpc': return { kind: 'query', name: `newQuery${n}`, summary: 'New query' }
    case 'grpc': return { kind: 'rpc', name: `NewMethod${n}`, summary: 'New RPC' }
    case 'websocket': return { kind: `push event${n}`, name: `event${n}`, summary: 'New event' }
    case 'soap': return { kind: 'operation', name: `Operation${n}`, summary: 'New operation' }
    default: return { kind: `GET ${spec.basePath.replace(/\/$/, '')}/resource${n}`, name: `getResource${n}`, summary: 'New endpoint' }
  }
}

export const STEP_TEMPLATES: Record<string, string[]> = {
  Auth: ['auth.session', 'auth.jwt', 'auth.apiKey', 'auth.mtls', 'policy owner', 'policy admin', 'policy member'],
  Input: ['validate Body', 'parse query', 'idempotency.check', 'rate.limit 100/min'],
  Data: ['db.find', 'db.list', 'db.insert', 'db.update', 'db.delete', 'db.tx', 'dataloader batch'],
  Cache: ['cache.get key', 'cache.set 60s', 'cache.del key', 'cache.semantic lookup'],
  Async: ['queue.send job', 'bus.publish event', 'pubsub.subscribe topic', 'webhook.emit'],
  External: ['http.call service', 'llm.complete', 'llm.stream', 'embed text', 'vector.search top_k=8', 's3.presign PUT', 'payments.charge', 'email.send'],
  Output: ['respond 200', 'respond 201', 'respond 204', 'return', 'stream', 'broadcast'],
}

const SCALAR: Record<string, unknown> = { ID: 'c1b2-…-9f3a', String: 'example', Int: 42, Float: 3.14, Boolean: true, DateTime: '2026-10-22T09:30:00Z', string: 'example', int32: 42, int64: 1200, bool: true, double: 2.5 }
export function exampleFor(typeName: string | undefined, types: TypeDef[], depth = 0): unknown {
  if (!typeName) return { ok: true }
  const list = /^\[.*\]|\[\]$/.test(typeName)
  const base = typeName.replace(/[[\]!]/g, '').trim()
  const make = (): unknown => {
    if (base in SCALAR) return SCALAR[base]
    const t = types.find((x) => x.name === base)
    if (!t) return depth ? `<${base}>` : { id: 'c1b2-…-9f3a', type: base }
    if (t.kind === 'enum') return t.fields[0]?.name ?? 'VALUE'
    if (depth > 2) return { id: 'c1b2-…' }
    return Object.fromEntries(t.fields.map((f) => [f.name, f.list ? [exampleFor(f.type, types, depth + 1)] : exampleFor(f.type, types, depth + 1)]))
  }
  return list ? [make(), make()] : make()
}
