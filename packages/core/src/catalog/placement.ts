import type { SystemNode, Environment, Offering, Placement, PlacementMode, Provider, Technology } from '../domain/types'
import { PROVIDER_BY_ID, PROVIDERS } from './providers'
import { TECH_BY_ID } from './technologies'

export interface PlacementOption {
  mode: PlacementMode
  label: string
  offering?: Offering
  monthly: number
  note?: string
}

export interface PlacementCheck {
  ok: boolean
  mode: PlacementMode
  product: string
  monthly: number
  issue?: string
  suggestion?: string
}

const resourceRam = (node: SystemNode) => {
  const m = String(node.config.memory ?? '512Mi')
  return m.endsWith('Gi') ? parseFloat(m) : parseFloat(m) / 1024
}

export function fitPlan(provider: Provider, node: SystemNode, tech: Technology) {
  const needRam = tech.category === 'data' || tech.category === 'cache' ? Math.max(2, resourceRam(node) * 2) : Math.max(1, resourceRam(node))
  const plans = [...provider.plans].sort((a, b) => a.monthly - b.monthly)
  return plans.find((p) => p.ramGb >= needRam) ?? plans[plans.length - 1]
}

export function placementOptions(tech: Technology, provider: Provider, node?: SystemNode): PlacementOption[] {
  const out: PlacementOption[] = []
  const cap = tech.capability
  if (tech.category === 'client' && !cap) return [{ mode: 'external', label: 'Runs on user devices', monthly: 0, note: 'distributed via app stores / installers' }]
  const managed = cap ? provider.offers[cap] : undefined
  if (managed) out.push({ mode: 'managed', label: managed.product, offering: managed, monthly: managed.monthly, note: managed.notes })
  if (tech.image && provider.offers.vm && provider.plans.length) {
    const plan = node ? fitPlan(provider, node, tech) : provider.plans[0]
    out.push({ mode: 'self-hosted', label: `Self-host on ${provider.offers.vm.product}${plan ? ` · ${plan.name}` : ''}`, monthly: plan?.monthly ?? provider.offers.vm.monthly, note: tech.image === 'build' ? 'your image' : tech.image })
  }
  if (tech.saas || (!tech.image && !managed)) out.push({ mode: 'external', label: `${tech.name} (vendor SaaS)`, monthly: PROVIDER_BY_ID.saas.offers[cap ?? 'llm']?.monthly ?? 0, note: 'billed by the vendor' })
  return out
}

export function effectivePlacement(node: SystemNode, env?: Environment): Placement {
  const o = env?.overrides[node.id]
  return { ...node.placement, ...(o ?? {}) }
}

export function checkPlacement(node: SystemNode, env?: Environment): PlacementCheck {
  const tech = TECH_BY_ID[node.techId]
  const pl = effectivePlacement(node, env)
  const provider = PROVIDER_BY_ID[pl.providerId]
  if (!tech || !provider) return { ok: false, mode: pl.mode, product: '-', monthly: 0, issue: 'Unknown provider or technology' }
  const opts = placementOptions(tech, provider, node)
  const chosen = opts.find((x) => x.mode === pl.mode)
  const scale = env?.scale ?? 1
  const replicas = tech.category === 'compute' || tech.category === 'network' ? Math.max(1, Math.round(node.replicas * scale)) : node.replicas
  if (chosen) return { ok: true, mode: chosen.mode, product: chosen.label, monthly: Math.round(chosen.monthly * replicas) }
  const alt = opts[0]
  const elsewhere = PROVIDERS.filter((p) => p.kind !== 'self' && tech.capability && p.offers[tech.capability]).slice(0, 3).map((p) => p.name)
  return {
    ok: false,
    mode: pl.mode,
    product: '-',
    monthly: 0,
    issue: pl.mode === 'managed' ? `${provider.name} has no managed ${tech.name}` : pl.mode === 'self-hosted' ? `${tech.name} can't be self-hosted on ${provider.name}` : `${tech.name} isn't offered as SaaS`,
    suggestion: alt ? `Use “${alt.label}” instead` : elsewhere.length ? `Available managed at ${elsewhere.join(', ')}` : undefined,
  }
}

export function defaultPlacement(tech: Technology, providerId: string, regionId?: string): Placement {
  const provider = PROVIDER_BY_ID[providerId] ?? PROVIDERS[0]
  const opts = placementOptions(tech, provider)
  const best = opts[0]
  const region = regionId && provider.regions.some((r) => r.id === regionId) ? regionId : provider.regions[0]?.id
  if (best) return { providerId: provider.id, regionId: region, mode: best.mode }
  const fallback = PROVIDERS.find((p) => placementOptions(tech, p).length)!
  return { providerId: fallback.id, regionId: fallback.regions[0]?.id, mode: placementOptions(tech, fallback)[0].mode }
}

export function projectCost(nodes: SystemNode[], env?: Environment) {
  return nodes.reduce((sum, n) => sum + checkPlacement(n, env).monthly, 0)
}
