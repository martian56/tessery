import type { ProjectDoc } from '../domain/types'
import { serviceFiles } from './backend'
import { migrationFiles, planMigrations, setMigrations, type MigrationState } from './migrations'
import { alertRules, ciWorkflow, otelConfig, readme, terraform, vpsFiles } from './infra'
import { deployFiles } from './deploy'
import { webAppFiles } from './webapp'

export * from './backend'
export * from './infra'
export * from './webapp'
export * from './migrations'
export * as deploy from './deploy'

export function generateAll(doc: ProjectDoc, previous?: MigrationState): Record<string, string> {
  const migrations = planMigrations(doc, previous)
  setMigrations(doc, migrations)
  const f: Record<string, string> = {
    'README.md': readme(doc),
    'observability/otel-collector.yaml': otelConfig(doc),
    'observability/prometheus/alerts.yml': alertRules(doc),
    'tessery.json': JSON.stringify(doc, null, 2),
  }
  doc.nodes.forEach((n) => Object.assign(f, serviceFiles(doc, n)))
  Object.assign(f, migrationFiles(migrations))
  doc.nodes.filter((n) => n.techId === 'web-app').forEach((app) => Object.assign(f, webAppFiles(doc, app)))
  Object.assign(f, deployFiles(doc))
  if (doc.environments.some((e) => (e.target?.kind ?? 'git') === 'git')) f['.github/workflows/build.yml'] = ciWorkflow(doc)
  doc.environments.filter((e) => (e.target?.kind ?? 'git') === 'git').forEach((e) => Object.assign(f, terraform(doc, e), vpsFiles(doc, e)))
  return f
}
