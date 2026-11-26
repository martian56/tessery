import type { Environment, ProjectDoc, SystemNode, Technology } from '../../domain/types'
import type { Raw } from './hcl'

export interface SharedCtx {
  doc: ProjectDoc
  env: Environment
  prefix: string
}

export interface NodeCtx extends SharedCtx {
  node: SystemNode
  tech: Technology
  id: string
  name: string
  region: Raw
  product: string
  plan: string
  port?: number
  image: Raw
  replicas: number
  version?: string
  storageGb: number
  /** The node's cloud-init, with its image filled in, for self-hosted nodes that run a container. */
  userData?: Raw
  use: (key: string) => void
}

export interface Output {
  value: string
  description: string
  sensitive?: boolean
}

export interface Generated {
  hcl: string
  outputs?: Record<string, Output>
  variables?: string
  random?: boolean
  requires?: Record<string, { source: string; version: string }>
}

export interface TfProvider {
  id: string
  name: string
  local: string
  source: string
  version: string
  variables: string
  provider: string
  shared?: Record<string, (c: SharedCtx) => Generated>
  vm?: (c: NodeCtx) => Generated
  /** By tech id first, then by capability. A string says why the product can't be created with Terraform. */
  managed: Record<string, ((c: NodeCtx) => Generated) | string>
}
