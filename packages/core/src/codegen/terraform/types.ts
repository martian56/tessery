import type { Environment, ProjectDoc, SystemNode, Technology } from '../../domain/types'
import type { Raw } from './hcl'

export interface SharedCtx {
  doc: ProjectDoc
  env: Environment
  /** Lowercase prefix for cloud resource names, like `tasks-dev`. */
  prefix: string
}

export interface NodeCtx extends SharedCtx {
  node: SystemNode
  tech: Technology
  /** Terraform name of the node's main resource, like `tasks_db`. */
  id: string
  /** Name for the cloud resource, like `tasks-dev-tasks-db`: lowercase letters, digits and dashes. */
  name: string
  region: Raw
  product: string
  /** Size picked from the provider's plans, for self-hosted nodes and products sized like a server. */
  plan: string
  port?: number
  /** The container image: built images come from var.image_registry, others are the catalog image. */
  image: Raw
  replicas: number
  version?: string
  storageGb: number
  /** Path of the node's cloud-init file, relative to the module, when vpsFiles writes one. */
  cloudInit?: string
  /** Asks for a shared resource, such as a network or an SSH key, to be written once. */
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
  /** Extra variable blocks this resource needs, written to variables.tf. */
  variables?: string
  /** Set when the resource uses random_password. */
  random?: boolean
  /** Providers besides the main one that the resource needs, by local name. */
  requires?: Record<string, { source: string; version: string }>
}

export interface TfProvider {
  id: string
  name: string
  /** Local name in required_providers, like `hcloud`. */
  local: string
  source: string
  version: string
  /** Credential and provider-specific variable blocks. */
  variables: string
  provider: string
  shared?: Record<string, (c: SharedCtx) => Generated>
  vm?: (c: NodeCtx) => Generated
  /** By tech id first, then by capability. A string says why the product can't be created with Terraform. */
  managed: Record<string, ((c: NodeCtx) => Generated) | string>
}
