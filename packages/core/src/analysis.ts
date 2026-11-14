import type { ProjectDoc, Environment } from './domain/types'
import { blocksOf } from './domain/tree'
import { TECH_BY_ID } from './catalog/technologies'
import { checkPlacement } from './catalog/placement'
import { builtInAuth } from './codegen/deploy/runtime'
import { SQL_STORES } from './codegen/services/crud'
import { readsOnly } from './codegen/services/model'
import type { SimResult } from './domain/simulate'

export interface Problem {
  id: string
  severity: 'error' | 'warning' | 'info'
  area: 'design' | 'api' | 'database' | 'pages' | 'deploy' | 'runtime'
  message: string
  nodeId?: string
  target?: { tableId?: string; opId?: string; pageId?: string; blockId?: string }
}

export function analyze(doc: ProjectDoc, env: Environment | undefined, sim: SimResult | null): Problem[] {
  const out: Problem[] = []
  const add = (p: Omit<Problem, 'id'>) => out.push({ ...p, id: `${p.area}:${p.nodeId ?? ''}:${out.length}` })
  if (env?.target?.kind === 'docker' && env.target.server && !env.target.host) add({ severity: 'error', area: 'deploy', message: `${env.name} runs on a saved server whose address is missing. Pick the server again under Deploys to.` })
  for (const n of doc.nodes) {
    const t = TECH_BY_ID[n.techId]
    const pc = checkPlacement(n, env)
    if (!pc.ok && (env?.target?.kind ?? 'git') === 'git') add({ severity: 'error', area: 'deploy', nodeId: n.id, message: `${n.name}: ${pc.issue}${pc.suggestion ? `. ${pc.suggestion}` : ''}` })
    if (n.id === builtInAuth(doc)?.id && !doc.edges.some((e) => e.source === n.id && SQL_STORES.has(doc.nodes.find((x) => x.id === e.target)?.techId ?? ''))) {
      add({ severity: 'error', area: 'design', nodeId: n.id, message: `${n.name}: connect it to a PostgreSQL database, where it keeps user accounts` })
    }
    const inbound = doc.edges.some((e) => e.target === n.id), outbound = doc.edges.some((e) => e.source === n.id)
    if (t.inputs.length && !inbound && !['client', 'observability'].includes(t.category) && !['dns', 'cron', 'ml-training', 'grafana'].includes(t.id)) add({ severity: 'warning', area: 'design', nodeId: n.id, message: `${n.name}: nothing connects to it` })
    if (t.category === 'client' && !outbound) add({ severity: 'warning', area: 'design', nodeId: n.id, message: `${n.name}: client doesn't call anything` })
    if ((t.id === 'worker' || t.id === 'cron') && !outbound) add({ severity: 'warning', area: 'design', nodeId: n.id, message: `${n.name}: processes work but writes nowhere` })
    if ((t.category === 'compute' || t.id === 'api-gateway' || t.id === 'load-balancer') && n.replicas < 2 && !['cron', 'batch', 'function', 'edge-function'].includes(t.id)) add({ severity: 'warning', area: 'deploy', nodeId: n.id, message: `${n.name}: single replica, no redundancy` })
    const spec = doc.apis[n.id]
    if (spec && spec.operations.length === 0) add({ severity: 'warning', area: 'api', nodeId: n.id, message: `${n.name}: API has no operations yet` })
    spec?.operations.forEach((o) => { if (!o.steps.length) add({ severity: 'info', area: 'api', nodeId: n.id, message: `${n.name}.${o.name}: empty handler`, target: { opId: o.id } }) })
    const schema = doc.databases[n.id]
    if (schema) {
      if (!schema.tables.length) add({ severity: 'info', area: 'database', nodeId: n.id, message: `${n.name}: no tables designed yet` })
      schema.tables.forEach((tb) => {
        if (!tb.columns.some((c) => c.pk)) add({ severity: 'error', area: 'database', nodeId: n.id, message: `${n.name}.${tb.name}: table has no primary key`, target: { tableId: tb.id } })
        tb.columns.forEach((c) => {
          if (c.ref && !schema.tables.some((x) => x.name === c.ref!.table)) add({ severity: 'error', area: 'database', nodeId: n.id, message: `${tb.name}.${c.name}: references missing table ${c.ref.table}`, target: { tableId: tb.id } })
          if (c.ref && !tb.indexes.some((ix) => ix.columns[0] === c.name) && !c.pk) add({ severity: 'info', area: 'database', nodeId: n.id, message: `${tb.name}.${c.name}: foreign key without an index`, target: { tableId: tb.id } })
        })
      })
    }
    if (['postgres', 'mysql', 'mongodb'].includes(t.id)) { const users = doc.edges.filter((e) => e.target === n.id).length; if (users > 3) add({ severity: 'info', area: 'design', nodeId: n.id, message: `${n.name}: shared by ${users} services, consider database-per-service` }) }
  }
  for (const p of doc.pages) for (const b of blocksOf(p.root)) for (const k of ['source', 'action']) {
    const v = b.props[k]
    if (typeof v !== 'string' || !v) continue
    const [nid, opName] = v.split(':')
    const what = b.type === 'block' ? String(b.props.block) : b.name ?? 'frame'
    const op = doc.apis[nid]?.operations.find((o) => o.name === opName)
    if (!op) add({ severity: 'error', area: 'pages', message: `${p.name}: ${what}.${k} bound to a missing operation`, target: { pageId: p.id, blockId: b.id } })
    else if (k === 'source' && !readsOnly(doc.apis[nid].style, op)) add({ severity: 'error', area: 'pages', message: `${p.name}: ${what} reads from ${opName}, which changes data; pages only load from read operations`, target: { pageId: p.id, blockId: b.id } })
  }
  if (sim) for (const n of doc.nodes) {
    const r = sim.nodes[n.id]; if (!r) continue
    if (r.down) add({ severity: 'error', area: 'runtime', nodeId: n.id, message: `${n.name}: DOWN (chaos), dependants are failing` })
    else if (r.util > 1) add({ severity: 'error', area: 'runtime', nodeId: n.id, message: `${n.name}: saturated at ${Math.round(r.util * 100)}% utilisation, ${r.errorRate.toFixed(1)}% errors` })
    else if (r.util > 0.85) add({ severity: 'warning', area: 'runtime', nodeId: n.id, message: `${n.name}: ${Math.round(r.util * 100)}% utilisation, near capacity` })
  }
  return out
}
