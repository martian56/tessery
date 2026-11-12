import type { ProjectDoc } from '@tessery/core/domain/types'
import type { UiState } from '@/store/uiSlice'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { alertRules, ciWorkflow, migrationSql, otelConfig, pageSource, readme, serviceFiles, terraform, vpsFiles } from '@tessery/core/codegen'
import { apiClient } from '@tessery/core/codegen/apiclient'
import { devCompose, envCompose, manifests, plan } from '@tessery/core/codegen/deploy'

export { generateAll } from '@tessery/core/codegen'

export function contextFiles(doc: ProjectDoc, u: UiState): Record<string, string> {
  const env = doc.environments.find((e) => e.id === u.envId) ?? doc.environments[0]
  if (u.workspace === 'api') { const id = u.api.nodeId && doc.apis[u.api.nodeId] ? u.api.nodeId : Object.keys(doc.apis)[0]; const n = doc.nodes.find((x) => x.id === id); if (n) return { ...serviceFiles(doc, n), 'lib/api.ts': apiClient(doc) } }
  if (u.workspace === 'database') { const id = u.database.nodeId && doc.databases[u.database.nodeId] ? u.database.nodeId : Object.keys(doc.databases)[0]; const d = id ? doc.databases[id] : undefined; const n = doc.nodes.find((x) => x.id === id); if (d && n) return { [`db/${n.name}/migrations/0001_init.sql`]: migrationSql(d, n.techId) } }
  if (u.workspace === 'pages') { const p = doc.pages.find((x) => x.id === u.pages.pageId) ?? doc.pages[0]; if (p) return { [`app${p.route === '/' ? '' : p.route}/page.tsx`]: pageSource(doc, p), 'lib/api.ts': apiClient(doc) } }
  if (u.workspace === 'deploy' && env) {
    const kind = env.target?.kind ?? 'git'
    const target = kind === 'docker' ? { [`deploy/${env.id}/compose.yaml`]: envCompose(doc, env) } : kind === 'kubernetes' ? { [`deploy/${env.id}/k8s.yaml`]: manifests(doc, env) } : { ...terraform(doc, env), ...vpsFiles(doc, env), '.github/workflows/build.yml': ciWorkflow(doc) }
    return { ...target, [`deploy/${env.id}/plan.json`]: JSON.stringify(plan(doc, env), null, 2) }
  }
  if (u.workspace === 'observe') return { 'otel-collector.yaml': otelConfig(doc), 'prometheus/alerts.yml': alertRules(doc) }
  if (u.selection.kind === 'nodes' && u.selection.ids.length === 1) {
    const n = doc.nodes.find((x) => x.id === (u.selection as { ids: string[] }).ids[0])
    if (n) { const sf = serviceFiles(doc, n); if (Object.keys(sf).length) return { ...sf, 'compose.yaml': devCompose(doc) }; if (TECH_BY_ID[n.techId].category === 'data' && doc.databases[n.id]?.tables.length) return { [`migrations/${n.name}.sql`]: migrationSql(doc.databases[n.id], n.techId), 'compose.yaml': devCompose(doc) } }
  }
  return { 'compose.yaml': devCompose(doc), 'README.md': readme(doc), ...(env ? terraform(doc, env) : {}) }
}
