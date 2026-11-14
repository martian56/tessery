
export type Category =
  | 'client' | 'network' | 'compute' | 'data' | 'cache' | 'messaging'
  | 'storage' | 'ai' | 'observability' | 'security' | 'external'

export type Capability =
  | 'vm' | 'container' | 'kubernetes' | 'serverless' | 'gpu' | 'static-hosting' | 'edge-functions'
  | 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'clickhouse' | 'cassandra' | 'dynamodb' | 'timeseries' | 'graph-db' | 'vector-db' | 'search'
  | 'kafka' | 'rabbitmq' | 'nats' | 'queue' | 'pubsub' | 'stream'
  | 'object-storage' | 'block-storage' | 'cdn' | 'load-balancer' | 'api-gateway' | 'dns' | 'waf'
  | 'llm' | 'monitoring' | 'logging' | 'tracing' | 'secrets' | 'auth' | 'email'

export type PortType =
  | 'http' | 'graphql' | 'grpc' | 'ws' | 'sql' | 'nosql' | 'kv' | 'pub' | 'sub' | 'object'
  | 'search' | 'vector' | 'llm' | 'telemetry' | 'smtp' | 'tcp' | 'any'

export interface PortDef { id: string; type: PortType; label?: string; multi?: boolean }

export type ConfigValue = string | number | boolean
export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'bool' | 'select'
  options?: string[]
  default: ConfigValue
  unit?: string
  hint?: string
}

export interface Technology {
  id: string
  name: string
  category: Category
  capability?: Capability
  vendor?: string
  description: string
  inputs: PortDef[]
  outputs: PortDef[]
  config: ConfigField[]
  image?: string
  capacity?: number
  latency?: number
  apiStyles?: ApiStyle[]
  languages?: string[]
  glyph: string
  tags?: string[]
  saas?: boolean
}

export interface Language {
  id: string
  name: string
  frameworks: { id: string; name: string; styles: ApiStyle[] }[]
  ext: string
}

export interface Region { id: string; name: string; geo: 'eu' | 'na' | 'sa' | 'apac' | 'me' | 'af' | 'oc' }

export interface Offering {
  product: string
  monthly: number
  unit?: string
  notes?: string
}

export interface ProviderPlan { id: string; name: string; vcpu: number; ramGb: number; diskGb: number; monthly: number }

export interface Provider {
  id: string
  name: string
  kind: 'hyperscaler' | 'cloud' | 'vps' | 'paas' | 'baremetal' | 'self'
  color: string
  regions: Region[]
  offers: Partial<Record<Capability, Offering>>
  plans: ProviderPlan[]
  iac: ('terraform' | 'pulumi' | 'ansible' | 'cloud-init' | 'compose')[]
  website?: string
}

export type PlacementMode = 'managed' | 'self-hosted' | 'external'
export interface Placement { providerId: string; regionId?: string; mode: PlacementMode; planId?: string }

export interface SystemNode {
  id: string
  techId: string
  name: string
  x: number
  y: number
  config: Record<string, ConfigValue>
  placement: Placement
  replicas: number
  notes?: string
  groupId?: string
}

export interface SystemEdge {
  id: string
  source: string
  sourcePort: string
  target: string
  targetPort: string
  protocol?: string
  timeoutMs: number
  retries: number
  mtls: boolean
  async?: boolean
}

export interface SystemGroup { id: string; name: string; color: string; x: number; y: number; w: number; h: number }

export type ApiStyle = 'rest' | 'graphql' | 'grpc' | 'websocket' | 'trpc' | 'sse' | 'webhook' | 'soap'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Operation {
  id: string
  kind: string
  name: string
  summary: string
  auth: 'public' | 'user' | 'admin' | 'service' | 'api-key'
  input?: string
  output?: string
  steps: string[]
  rateLimit?: string
  cache?: string
  streaming?: 'none' | 'server' | 'client' | 'bidi'
}

export interface ApiSpec {
  nodeId: string
  style: ApiStyle
  language: string
  framework: string
  basePath: string
  operations: Operation[]
  types: TypeDef[]
}

export interface TypeDef { id: string; name: string; kind: 'object' | 'input' | 'enum'; fields: { name: string; type: string; required: boolean; list?: boolean }[] }

export type ColumnType =
  | 'uuid' | 'text' | 'varchar' | 'int' | 'bigint' | 'serial' | 'numeric' | 'float' | 'boolean'
  | 'timestamptz' | 'date' | 'jsonb' | 'bytea' | 'enum' | 'text[]' | 'vector'

export interface Column {
  id: string
  name: string
  type: ColumnType
  length?: number
  enumValues?: string[]
  pk?: boolean
  nullable?: boolean
  unique?: boolean
  default?: string
  ref?: { table: string; column: string; onDelete: 'cascade' | 'restrict' | 'set null' }
  comment?: string
}

export interface Index { id: string; name: string; columns: string[]; unique: boolean; method: 'btree' | 'hash' | 'gin' | 'gist' | 'hnsw' }

export interface Table { id: string; name: string; columns: Column[]; indexes: Index[]; x: number; y: number; comment?: string }

export interface DbSchema { nodeId: string; tables: Table[] }

export interface Block { id: string; type: string; props: Record<string, ConfigValue> }

/** CSS declarations in camelCase. Numbers are pixels for lengths. Values may use theme tokens such as var(--c-primary). */
export type StyleMap = Record<string, string | number>

export type ElementType = 'frame' | 'text' | 'image' | 'video' | 'button' | 'icon' | 'input' | 'select' | 'shape' | 'path' | 'embed' | 'block'

/** Style maps an element can carry: the base style, breakpoint overrides and interaction states. */
export const STYLE_KEYS = ['style', 'tablet', 'mobile', 'hover', 'focus', 'active', 'current'] as const
export type StyleKey = (typeof STYLE_KEYS)[number]

/**
 * One element of a page. Frames hold children and lay them out with flex or grid; any element can be positioned
 * absolutely inside its parent. `tablet` and `mobile` override `style` at those breakpoints; `hover`, `focus` (keyboard
 * focus), `active` (pressed) and `current` (a link to the page being shown) override it in those states.
 * A `block` element renders one of the data and section blocks, named by props.block. A frame with props.source
 * repeats its children once per record, filling `{field}` placeholders in their text, links and images.
 */
export interface UIElement {
  id: string
  type: ElementType
  name?: string
  props: Record<string, ConfigValue>
  style?: StyleMap
  tablet?: StyleMap
  mobile?: StyleMap
  hover?: StyleMap
  focus?: StyleMap
  active?: StyleMap
  current?: StyleMap
  hidden?: boolean
  children?: UIElement[]
}

export interface Theme {
  /** Exposed as var(--c-<name>). */
  colors: Record<string, string>
  /** Google Fonts family names or CSS font stacks, exposed as var(--font-heading) and var(--font-body). */
  fonts: { heading: string; body: string }
  /** Default corner radius in pixels, exposed as var(--radius). */
  radius: number
  /** Colors that replace `colors` when the visitor's system is in dark mode. */
  dark?: Record<string, string>
}

export interface Page {
  id: string
  appNodeId: string
  name: string
  route: string
  render: 'ssr' | 'ssg' | 'isr' | 'csr'
  access: 'public' | 'user' | 'admin'
  title: string
  /** The page's element tree. Pages saved before the tree existed are migrated into it on load. */
  root: UIElement
  /** Kept empty; older documents listed blocks here before the element tree. */
  blocks: Block[]
}

export type DeployTarget =
  | { kind: 'git' }
  | { kind: 'docker'; host?: string; server?: string; domain?: string; hosts?: Record<string, string> }
  | { kind: 'kubernetes'; namespace?: string; registry?: string; domain?: string; ingressClass?: string; publicPort?: number }

export interface Environment {
  id: string
  name: string
  target?: DeployTarget
  defaultProvider: string
  defaultRegion: string
  scale: number
  strategy: 'recreate' | 'rolling' | 'canary' | 'blue-green'
  approval: boolean
  autoRollback: boolean
  overrides: Record<string, Partial<Placement>>
  secrets: string[]
  backups?: BackupPolicy
}

export interface BackupPolicy {
  integration: string
  bucket?: string
  every: 'hourly' | 'daily' | 'weekly'
  keep: number
}

export const BACKUP_TECHS = ['postgres', 'timescaledb', 'pgvector', 'mysql', 'mariadb', 'mongodb']


export interface SloDef { id: string; nodeId: string; name: string; metric: 'availability' | 'latency_p99' | 'error_rate'; target: number; window: '7d' | '28d' | '30d' }
export interface AlertRule { id: string; nodeId?: string; name: string; expr: string; severity: 'info' | 'warning' | 'critical'; channel: string; enabled: boolean }
export interface ObservabilityConfig { metrics: string; logs: string; traces: string; sampling: number; slos: SloDef[]; alerts: AlertRule[] }

export interface ProjectDoc {
  id: string
  name: string
  description: string
  icon: string
  nodes: SystemNode[]
  edges: SystemEdge[]
  groups: SystemGroup[]
  apis: Record<string, ApiSpec>
  databases: Record<string, DbSchema>
  pages: Page[]
  /** Theme per web app node id. */
  themes: Record<string, Theme>
  environments: Environment[]
  observability: ObservabilityConfig
  updatedAt: number
}

export interface ProjectSummary { id: string; name: string; description: string; icon: string; nodes: number; updatedAt: number }
