import { useMemo } from 'react'
import type { Environment, ProjectDoc } from '@tessery/core/domain/types'
import { secrets as requiredSecrets } from '@tessery/core/codegen/deploy'
import { useSecretsQuery } from '@/api/endpoints/delivery'

export interface SecretRow {
  name: string
  description: string
  generate: boolean
  required: boolean
  stored?: { generated: boolean; updatedAt: string; updatedBy?: string | null }
}

export function useEnvSecrets(doc: ProjectDoc, env: Environment | undefined) {
  const { data: stored, error } = useSecretsQuery({ pid: doc.id, env: env?.id ?? '' }, { skip: !env })
  const rows = useMemo<SecretRow[]>(() => {
    if (!env) return []
    const req: SecretRow[] = requiredSecrets(doc, env).map((r) => ({ name: r.name, description: r.description, generate: r.generate, required: true }))
    if (env.target?.kind === 'kubernetes') req.push({ name: 'KUBECONFIG', description: 'Kubeconfig for the cluster', generate: false, required: true })
    if (env.target?.kind === 'docker' && env.target.host?.startsWith('ssh://')) {
      req.push({ name: 'SSH_PRIVATE_KEY', description: `Private key for ${env.target.host.slice(6)}`, generate: false, required: true })
      req.push({ name: 'SSH_KNOWN_HOSTS', description: 'Optional. Pins the host key (ssh-keyscan output)', generate: false, required: false })
    }
    const out = req.map((r) => ({ ...r, stored: stored?.find((x) => x.name === r.name) }))
    for (const x of stored ?? []) if (!out.some((r) => r.name === x.name)) out.push({ name: x.name, description: 'Not used by the design', generate: false, required: false, stored: x })
    return out
  }, [doc, env, stored])
  const missing = useMemo(() => (stored ? rows.filter((r) => r.required && !r.generate && !r.stored).map((r) => r.name) : []), [rows, stored])
  return { rows, missing, error }
}
