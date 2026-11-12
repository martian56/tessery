import type { ProjectDoc } from '../domain/types'
import { migrationSql, serviceFiles } from './backend'
import { alertRules, ciWorkflow, otelConfig, readme, terraform, vpsFiles } from './infra'
import { deployFiles } from './deploy'
import { webAppFiles } from './webapp'

export * from './backend'
export * from './infra'
export * from './webapp'
export * as deploy from './deploy'

export function generateAll(doc: ProjectDoc): Record<string, string> {
  const f: Record<string, string> = {
    'README.md': readme(doc),
    'observability/otel-collector.yaml': otelConfig(doc),
    'observability/prometheus/alerts.yml': alertRules(doc),
    'tessery.json': JSON.stringify(doc, null, 2),
  }
  doc.nodes.forEach((n) => Object.assign(f, serviceFiles(doc, n)))
  Object.values(doc.databases).forEach((d) => { const n = doc.nodes.find((x) => x.id === d.nodeId); if (n && d.tables.length) f[`db/${n.name}/migrations/0001_init.sql`] = migrationSql(d, n.techId) })
  doc.nodes.filter((n) => n.techId === 'web-app').forEach((app) => Object.assign(f, webAppFiles(doc, app)))
  Object.assign(f, deployFiles(doc))
  if (doc.environments.some((e) => (e.target?.kind ?? 'git') === 'git')) f['.github/workflows/build.yml'] = ciWorkflow(doc)
  doc.environments.filter((e) => (e.target?.kind ?? 'git') === 'git').forEach((e) => Object.assign(f, terraform(doc, e), vpsFiles(doc, e)))
  return f
}
