import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TEMPLATES } from '../src/templates'
import { blankTemplate } from '../src/templates/blank'
import { TECHNOLOGIES, TECH_BY_ID } from '../src/catalog/technologies'
import { defaultPlacement } from '../src/catalog/placement'
import { newNode } from '../src/domain/builders'
import { normalizeDoc } from '../src/domain/normalize'
import { TF_PROVIDERS, terraform, terraformProblems } from '../src/codegen/terraform'
import { vpsFiles } from '../src/codegen/infra'
import type { ProjectDoc } from '../src/domain/types'

const out = process.argv[2] ?? 'dist/terraform'
const only = process.argv[3]?.split(',')
rmSync(out, { recursive: true, force: true })

function everything(): ProjectDoc {
  const doc = blankTemplate('catalog')
  TECHNOLOGIES.filter((t) => t.category !== 'client').forEach((t, i) => doc.nodes.push(newNode(t.id, t.id, (i % 8) * 300, Math.floor(i / 8) * 200)))
  return doc
}

const docs: [string, () => ProjectDoc][] = [...TEMPLATES.map((t) => [t.id, t.build] as [string, () => ProjectDoc]), ['catalog', everything]]
let dirs = 0
for (const [name, build] of docs) {
  for (const pid of Object.keys(TF_PROVIDERS).filter((p) => !only || only.includes(p))) {
    const doc = normalizeDoc(build())
    const env = { ...doc.environments[0], target: { kind: 'git' as const }, overrides: {} }
    for (const n of doc.nodes) if (TECH_BY_ID[n.techId].category !== 'client') n.placement = defaultPlacement(TECH_BY_ID[n.techId], pid)
    const files = { ...terraform(doc, env), ...vpsFiles(doc, env) }
    for (const [path, body] of Object.entries(files)) {
      const file = join(out, `${name}-${pid}`, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, body)
    }
    dirs += Object.keys(files).filter((f) => f.endsWith('/versions.tf')).length
    for (const p of terraformProblems(doc, env)) console.log(`${name} on ${pid}: ${p.message}`)
  }
}
console.log(`wrote ${dirs} Terraform directories to ${out}`)
