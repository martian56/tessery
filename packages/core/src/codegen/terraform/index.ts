import type { Environment, ProjectDoc, SystemNode } from '../../domain/types'
import { TECH_BY_ID } from '../../catalog/technologies'
import { PROVIDER_BY_ID } from '../../catalog/providers'
import { checkPlacement, effectivePlacement, fitPlan } from '../../catalog/placement'
import { slug } from '../deploy/compose'
import { block, raw } from './hcl'
import type { Generated, NodeCtx, Output, SharedCtx, TfProvider } from './types'
import { hetzner } from './hetzner'
import { digitalocean } from './digitalocean'
import { aws } from './aws'
import { gcp } from './gcp'
import { azure } from './azure'

export const TF_PROVIDERS: Record<string, TfProvider> = { aws, gcp, azure, hetzner, digitalocean }

export function hasCloudInit(n: SystemNode, env: Environment): boolean {
  const t = TECH_BY_ID[n.techId]
  return effectivePlacement(n, env).mode === 'self-hosted' && t.category !== 'client' && !t.saas && !!t.image
}

const tfName = (s: string) => {
  const n = s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(n) ? n : `n_${n}`
}
const cloudName = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '')

function provisioned(doc: ProjectDoc, env: Environment): Map<string, SystemNode[]> {
  const by = new Map<string, SystemNode[]>()
  for (const n of doc.nodes) {
    const pl = effectivePlacement(n, env)
    const t = TECH_BY_ID[n.techId]
    if (!t || pl.mode === 'external' || pl.providerId === 'self' || pl.providerId === 'saas' || t.category === 'client') continue
    if (!checkPlacement(n, env).ok) continue
    by.set(pl.providerId, [...(by.get(pl.providerId) ?? []), n])
  }
  return by
}

function gap(n: SystemNode, env: Environment): string | undefined {
  const pl = effectivePlacement(n, env)
  const p = TF_PROVIDERS[pl.providerId]
  const where = PROVIDER_BY_ID[pl.providerId]?.name ?? pl.providerId
  if (!p) return `Tessery writes Terraform for AWS, Google Cloud, Azure, Hetzner and DigitalOcean, so ${n.name} on ${where} is left out. Move it to one of them or create it by hand`
  if (pl.mode === 'self-hosted') return p.vm ? undefined : `${where} servers can't be created with Terraform`
  const t = TECH_BY_ID[n.techId]
  const how = p.managed[t.id] ?? (t.capability ? p.managed[t.capability] : undefined)
  if (typeof how === 'string') return `${n.name}: ${how}`
  if (!how) return `${n.name}: Tessery can't create ${checkPlacement(n, env).product} on ${where} with Terraform yet. Self-host it instead`
  return undefined
}

export function terraformProblems(doc: ProjectDoc, env: Environment): { nodeId: string; message: string }[] {
  if ((env.target?.kind ?? 'git') !== 'git') return []
  return [...provisioned(doc, env).values()].flat().flatMap((n) => {
    const message = gap(n, env)
    return message ? [{ nodeId: n.id, message }] : []
  })
}

export function terraform(doc: ProjectDoc, env: Environment): Record<string, string> {
  const files: Record<string, string> = {}
  const prefix = cloudName(`${slug(doc.name)}-${env.id}`)
  for (const [pid, nodes] of provisioned(doc, env)) {
    const p = TF_PROVIDERS[pid]
    if (!p) continue
    const provider = PROVIDER_BY_ID[pid]
    const regionOf = (n: SystemNode) => effectivePlacement(n, env).regionId ?? env.defaultRegion
    const counts = new Map<string, number>()
    nodes.forEach((n) => counts.set(regionOf(n), (counts.get(regionOf(n)) ?? 0) + 1))
    const region = provider.regions.some((r) => r.id === env.defaultRegion) && counts.has(env.defaultRegion) ? env.defaultRegion : [...counts].sort((a, b) => b[1] - a[1])[0][0]
    const shared = new Set<string>()
    const outputs: Record<string, Output> = {}
    let extraVars = ''
    let random = false
    const requires: Record<string, { source: string; version: string }> = {}
    const parts: Generated[] = []
    const base: SharedCtx = { doc, env, prefix }
    for (const n of nodes) {
      if (gap(n, env)) continue
      const t = TECH_BY_ID[n.techId]
      const pl = effectivePlacement(n, env)
      const id = tfName(n.name)
      const r = regionOf(n)
      const ctx: NodeCtx = {
        ...base, node: n, tech: t, id,
        name: cloudName(`${prefix}-${n.name}`),
        region: r === region ? raw('var.region') : raw(JSON.stringify(r)),
        product: checkPlacement(n, env).product,
        plan: n.placement.planId ?? fitPlan(provider, n, t)?.id ?? provider.plans[0]?.id ?? 'small',
        port: typeof n.config.port === 'number' ? n.config.port : undefined,
        image: t.image === 'build' ? raw(`"\${var.image_registry}/${n.name}:\${var.image_tag}"`) : raw(JSON.stringify(t.image ?? 'nginx:stable')),
        replicas: t.category === 'compute' || t.category === 'network' ? Math.max(1, Math.round(n.replicas * env.scale)) : 1,
        version: n.config.version === undefined ? undefined : String(n.config.version),
        storageGb: Math.max(1, Number(n.config.storageGb ?? 20)),
        cloudInit: hasCloudInit(n, env) ? `\${path.module}/../cloud-init/${n.name}.yaml` : undefined,
        use: (key) => shared.add(key),
      }
      const how = pl.mode === 'self-hosted' ? p.vm! : (p.managed[t.id] ?? p.managed[t.capability!]) as (c: NodeCtx) => Generated
      parts.push(how(ctx))
    }
    for (const g of parts) {
      Object.entries(g.outputs ?? {}).forEach(([k, o]) => (outputs[k] = o))
      extraVars += g.variables ?? ''
      random ||= !!g.random
      Object.assign(requires, g.requires)
    }
    const sharedParts = [...shared].sort().map((k) => p.shared![k](base))
    sharedParts.forEach((g) => { extraVars += g.variables ?? ''; random ||= !!g.random; Object.assign(outputs, g.outputs); Object.assign(requires, g.requires) })
    const dir = `infra/${env.id}/${pid}`
    const providers: Record<string, { source: string; version: string }> = { [p.local]: { source: p.source, version: p.version } }
    Object.assign(providers, requires)
    if (random) providers.random = { source: 'hashicorp/random', version: '~> 3.7' }
    files[`${dir}/versions.tf`] = `# ${env.name} on ${provider.name} for ${doc.name}, generated by Tessery.
# State lives in any S3-compatible bucket. Fill in the rest of the backend when you initialise:
#   terraform init -backend-config="bucket=<bucket>" -backend-config="region=<region>"
terraform {
  required_version = ">= 1.6"

  required_providers {
${Object.entries(providers).map(([k, v]) => `    ${k} = { source = "${v.source}", version = "${v.version}" }`).join('\n')}
  }

  backend "s3" {
    key = "${slug(doc.name)}/${env.id}/${pid}.tfstate"
  }
}
`
    files[`${dir}/variables.tf`] = [
      block('variable', ['region'], { type: raw('string'), default: region, description: `${provider.name} region for everything that doesn't name its own.` }),
      block('variable', ['image_registry'], { type: raw('string'), default: `ghcr.io/${slug(doc.name)}`, description: 'Registry the service images were pushed to.' }),
      block('variable', ['image_tag'], { type: raw('string'), default: 'latest', description: 'Tag of the service images to run.' }),
      p.variables,
      extraVars,
    ].filter(Boolean).join('\n')
    files[`${dir}/main.tf`] = [p.provider, ...sharedParts.map((g) => g.hcl), ...parts.map((g) => g.hcl)].filter(Boolean).join('\n')
    files[`${dir}/outputs.tf`] = Object.entries(outputs).map(([k, o]) => block('output', [k], { value: raw(o.value), description: o.description, sensitive: o.sensitive || undefined })).join('\n') || '# Nothing to output.\n'
  }
  return files
}
