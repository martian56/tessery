import type { SystemNode, Environment, ProjectDoc } from '../../domain/types'
import { TECH_BY_ID } from '../../catalog/technologies'
import { effectivePlacement } from '../../catalog/placement'

export const envName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_')

export interface SecretSpec {
  name: string
  generate: boolean
  description: string
}

export interface Workload {
  node: SystemNode
  name: string
  role: 'app' | 'data' | 'edge'
  build?: string
  image?: string
  port?: number
  ports: number[]
  env: Record<string, string>
  command?: string[]
  volume?: string
  health?: string[]
  httpHealth?: string
  public: boolean
  schedule?: string
  memory: string
  cpu: string
}

export interface Connection {
  env: string
  url: string
  extra?: Record<string, string>
}

interface DataSpec {
  image: (n: SystemNode) => string
  port: number
  ports?: number[]
  volume?: string
  env?: (p: string) => Record<string, string>
  command?: (p: string, n: SystemNode) => string[]
  health?: (p: string) => string[]
  url: (n: SystemNode, p: string) => string
  extra?: (n: SystemNode, p: string) => Record<string, string>
  password?: boolean
  memory?: string
}

const pg = (image: (n: SystemNode) => string): DataSpec => ({
  image,
  port: 5432,
  volume: '/var/lib/postgresql/data',
  env: (p) => ({ POSTGRES_USER: 'app', POSTGRES_PASSWORD: p, POSTGRES_DB: 'app', PGDATA: '/var/lib/postgresql/data/pgdata' }),
  health: () => ['pg_isready', '-U', 'app', '-d', 'app'],
  url: (n, p) => `postgres://app:${p}@${n.name}:5432/app?sslmode=disable`,
  password: true,
})

const pgMajor = (n: SystemNode) => String(n.config.version ?? '17').replace(/\D.*$/, '') || '17'

const DATA: Record<string, DataSpec> = {
  postgres: pg((n) => `postgres:${pgMajor(n)}-alpine`),
  timescaledb: pg(() => 'timescale/timescaledb:latest-pg17'),
  pgvector: pg(() => 'pgvector/pgvector:pg17'),
  mysql: {
    image: (n) => `mysql:${n.config.version ?? '8.4'}`, port: 3306, volume: '/var/lib/mysql', password: true, memory: '512Mi',
    env: (p) => ({ MYSQL_DATABASE: 'app', MYSQL_USER: 'app', MYSQL_PASSWORD: p, MYSQL_ROOT_PASSWORD: p }),
    health: (p) => ['mysqladmin', 'ping', '-h', '127.0.0.1', '-uapp', `-p${p}`],
    url: (n, p) => `mysql://app:${p}@${n.name}:3306/app`,
  },
  mariadb: {
    image: () => 'mariadb:11.8', port: 3306, volume: '/var/lib/mysql', password: true,
    env: (p) => ({ MARIADB_DATABASE: 'app', MARIADB_USER: 'app', MARIADB_PASSWORD: p, MARIADB_ROOT_PASSWORD: p }),
    health: () => ['healthcheck.sh', '--connect', '--innodb_initialized'],
    url: (n, p) => `mysql://app:${p}@${n.name}:3306/app`,
  },
  mongodb: {
    image: () => 'mongo:8.0', port: 27017, volume: '/data/db', password: true, memory: '512Mi',
    env: (p) => ({ MONGO_INITDB_ROOT_USERNAME: 'app', MONGO_INITDB_ROOT_PASSWORD: p }),
    health: () => ['mongosh', '--quiet', '--eval', 'db.adminCommand("ping")'],
    url: (n, p) => `mongodb://app:${p}@${n.name}:27017/app?authSource=admin`,
  },
  redis: {
    image: () => 'redis:7.4-alpine', port: 6379, volume: '/data', password: true,
    command: (p) => ['redis-server', '--appendonly', 'yes', '--requirepass', p],
    health: (p) => ['redis-cli', '--no-auth-warning', '-a', p, 'ping'],
    url: (n, p) => `redis://:${p}@${n.name}:6379`,
  },
  memcached: { image: () => 'memcached:1.6-alpine', port: 11211, url: (n) => `memcached://${n.name}:11211` },
  rabbitmq: {
    image: () => 'rabbitmq:4-management-alpine', port: 5672, ports: [15672], volume: '/var/lib/rabbitmq', password: true, memory: '512Mi',
    env: (p) => ({ RABBITMQ_DEFAULT_USER: 'app', RABBITMQ_DEFAULT_PASS: p }),
    health: () => ['rabbitmq-diagnostics', '-q', 'ping'],
    url: (n, p) => `amqp://app:${p}@${n.name}:5672/%2f`,
  },
  kafka: {
    image: () => 'apache/kafka:3.9.1', port: 9092, volume: '/var/lib/kafka/data', memory: '768Mi',
    url: (n) => `${n.name}:9092`,
    command: () => [],
  },
  nats: {
    image: () => 'nats:2.11-alpine', port: 4222, ports: [8222], volume: '/data',
    command: () => ['-js', '-sd', '/data', '-m', '8222'],
    url: (n) => `nats://${n.name}:4222`,
  },
  mqtt: {
    image: () => 'eclipse-mosquitto:2.0', port: 1883,
    command: () => ['mosquitto', '-c', '/mosquitto-no-auth.conf'],
    url: (n) => `mqtt://${n.name}:1883`,
  },
  'object-storage': {
    image: () => 'chrislusf/seaweedfs:4.53', port: 9000, ports: [], volume: '/data', password: true,
    env: (p) => ({ AWS_ACCESS_KEY_ID: 'app-admin', AWS_SECRET_ACCESS_KEY: p }),
    command: () => ['server', '-dir=/data', '-s3', '-s3.port=9000'],
    url: (n) => `http://${n.name}:9000`,
    extra: (n, p) => ({ ACCESS_KEY: 'app-admin', SECRET_KEY: p, BUCKET: String(n.config.bucket ?? n.name) }),
  },
  clickhouse: {
    image: () => 'clickhouse/clickhouse-server:25.3-alpine', port: 8123, ports: [9000], volume: '/var/lib/clickhouse', password: true, memory: '768Mi',
    env: (p) => ({ CLICKHOUSE_DB: 'app', CLICKHOUSE_USER: 'app', CLICKHOUSE_PASSWORD: p }),
    url: (n, p) => `http://app:${p}@${n.name}:8123/app`,
  },
  elasticsearch: {
    image: () => 'elasticsearch:8.17.4', port: 9200, volume: '/usr/share/elasticsearch/data', memory: '1Gi',
    env: () => ({ 'discovery.type': 'single-node', 'xpack.security.enabled': 'false', ES_JAVA_OPTS: '-Xms512m -Xmx512m' }),
    url: (n) => `http://${n.name}:9200`,
  },
  meilisearch: {
    image: () => 'getmeili/meilisearch:v1.13', port: 7700, volume: '/meili_data', password: true,
    env: (p) => ({ MEILI_MASTER_KEY: p, MEILI_ENV: 'production' }),
    url: (n) => `http://${n.name}:7700`,
    extra: (_, p) => ({ KEY: p }),
  },
  typesense: {
    image: () => 'typesense/typesense:28.0', port: 8108, volume: '/data', password: true,
    command: (p) => ['--data-dir', '/data', `--api-key=${p}`, '--enable-cors'],
    url: (n) => `http://${n.name}:8108`,
    extra: (_, p) => ({ KEY: p }),
  },
  qdrant: { image: () => 'qdrant/qdrant:v1.13.4', port: 6333, ports: [6334], volume: '/qdrant/storage', url: (n) => `http://${n.name}:6333` },
  neo4j: {
    image: () => 'neo4j:5.26', port: 7687, ports: [7474], volume: '/data', password: true, memory: '1Gi',
    env: (p) => ({ NEO4J_AUTH: `neo4j/${p}` }),
    url: (n, p) => `bolt://neo4j:${p}@${n.name}:7687`,
  },
  influxdb: {
    image: () => 'influxdb:2.7-alpine', port: 8086, volume: '/var/lib/influxdb2', password: true,
    env: (p) => ({ DOCKER_INFLUXDB_INIT_MODE: 'setup', DOCKER_INFLUXDB_INIT_USERNAME: 'app', DOCKER_INFLUXDB_INIT_PASSWORD: p, DOCKER_INFLUXDB_INIT_ORG: 'app', DOCKER_INFLUXDB_INIT_BUCKET: 'app', DOCKER_INFLUXDB_INIT_ADMIN_TOKEN: p }),
    url: (n) => `http://${n.name}:8086`,
    extra: (_, p) => ({ TOKEN: p }),
  },
  cassandra: {
    image: () => 'cassandra:5.0', port: 9042, volume: '/var/lib/cassandra', memory: '1536Mi',
    env: () => ({ MAX_HEAP_SIZE: '768M', HEAP_NEWSIZE: '128M' }),
    url: (n) => `${n.name}:9042`,
  },
  cockroachdb: {
    image: () => 'cockroachdb/cockroach:v25.1.5', port: 26257, ports: [8080], volume: '/cockroach/cockroach-data', memory: '1Gi',
    command: () => ['start-single-node', '--insecure'],
    url: (n) => `postgres://root@${n.name}:26257/defaultdb?sslmode=disable`,
  },
}

function kafkaEnv(n: SystemNode): Record<string, string> {
  return {
    KAFKA_NODE_ID: '1',
    KAFKA_PROCESS_ROLES: 'broker,controller',
    KAFKA_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
    KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://${n.name}:9092`,
    KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT',
    KAFKA_CONTROLLER_QUORUM_VOTERS: '1@localhost:9093',
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
    KAFKA_LOG_DIRS: '/var/lib/kafka/data',
    KAFKA_HEAP_OPTS: '-Xms256m -Xmx512m',
  }
}

const EDGE = new Set(['api-gateway', 'graphql-gateway', 'load-balancer', 'reverse-proxy'])

export function builtInAuth(doc: ProjectDoc): SystemNode | undefined {
  return doc.nodes.find((n) => n.techId === 'auth-service' && (n.config.engine ?? 'Built-in (Tessery)') === 'Built-in (Tessery)')
}
const BUILT = new Set(['service', 'worker', 'cron', 'function', 'batch', 'workflow'])

export const passwordSecret = (n: SystemNode) => `${envName(n.name)}_PASSWORD`
const ref = (name: string) => '${' + name + '}'

export function runsAsContainer(n: SystemNode, env?: Environment): boolean {
  const t = TECH_BY_ID[n.techId]
  if (!t) return false
  if (n.techId === 'web-app') return true
  if (n.techId === 'auth-service' && (n.config.engine ?? 'Built-in (Tessery)') === 'Built-in (Tessery)') return true
  if (t.category === 'client' || t.saas) return false
  if (env && effectivePlacement(n, env).mode === 'external') return false
  return BUILT.has(n.techId) || EDGE.has(n.techId) || n.techId in DATA
}

export function connection(d: SystemNode, env?: Environment): Connection {
  const key = envName(d.name)
  if (!runsAsContainer(d, env)) return { env: `${key}_URL`, url: ref(`${key}_URL`) }
  const spec = DATA[d.techId]
  if (spec) {
    const p = spec.password ? ref(passwordSecret(d)) : ''
    const extra = spec.extra ? Object.fromEntries(Object.entries(spec.extra(d, p)).map(([k, v]) => [`${key}_${k}`, v])) : undefined
    return { env: `${key}_URL`, url: spec.url(d, p), extra }
  }
  return { env: `${key}_URL`, url: `http://${d.name}:${portOf(d)}` }
}

export function localPorts(doc: ProjectDoc): Map<string, number> {
  const out = new Map<string, number>()
  const taken = new Set<number>()
  const pick = (key: string) => { let p = hostPort(doc, 'local', key); while (taken.has(p)) p = p >= 29999 ? 20000 : p + 1; taken.add(p); out.set(key, p) }
  for (const w of workloads(doc)) {
    if (w.schedule || !w.port) continue
    pick(w.name)
    for (const p of w.ports) pick(`${w.name}:${p}`)
  }
  return out
}

export function devConnection(d: SystemNode, doc?: ProjectDoc): Connection {
  const c = connection(d)
  const local = doc && localPorts(doc).get(d.name)
  const fill = (s: string) => {
    const out = s.replace(/\$\{[A-Z0-9_]+_PASSWORD\}/g, 'dev').replace(/\$\{([A-Z0-9_]+)\}/g, '').replace(`@${d.name}:`, '@localhost:').replace(`//${d.name}:`, '//localhost:').replace(new RegExp(`^${d.name}:`), 'localhost:')
    return local ? out.replace(`localhost:${portOf(d)}`, `localhost:${local}`) : out
  }
  return { env: c.env, url: fill(c.url), extra: c.extra && Object.fromEntries(Object.entries(c.extra).map(([k, v]) => [k, fill(v)])) }
}

export function portOf(n: SystemNode): number {
  if (DATA[n.techId]) return DATA[n.techId].port
  if (n.techId === 'web-app') return 3000
  if (EDGE.has(n.techId)) return 8080
  return Number(n.config.port ?? 8080)
}

function dependencies(doc: ProjectDoc, n: SystemNode): SystemNode[] {
  return doc.edges
    .filter((e) => e.source === n.id)
    .map((e) => doc.nodes.find((x) => x.id === e.target))
    .filter((d): d is SystemNode => !!d && TECH_BY_ID[d.techId]?.category !== 'client')
}

function isPublic(doc: ProjectDoc, n: SystemNode): boolean {
  if (n.techId === 'web-app' || EDGE.has(n.techId)) return true
  return doc.edges.some((e) => e.target === n.id && TECH_BY_ID[doc.nodes.find((x) => x.id === e.source)?.techId ?? '']?.category === 'client' && doc.nodes.find((x) => x.id === e.source)?.techId !== 'web-app')
}

const memoryOf = (n: SystemNode, fallback: string) => String(n.config.memory ?? fallback).replace(/i?B$/, 'i').replace(/^(\d+)M$/, '$1Mi').replace(/^(\d+)G$/, '$1Gi')

export function workloads(doc: ProjectDoc, env?: Environment): Workload[] {
  return doc.nodes.filter((n) => runsAsContainer(n, env)).map((n): Workload => {
    const spec = DATA[n.techId]
    if (spec) {
      const p = spec.password ? ref(passwordSecret(n)) : ''
      return {
        node: n, name: n.name, role: 'data', image: spec.image(n), port: spec.port, ports: spec.ports ?? [],
        env: n.techId === 'kafka' ? kafkaEnv(n) : spec.env?.(p) ?? {},
        command: spec.command?.(p, n)?.length ? spec.command(p, n) : undefined,
        volume: spec.volume, health: spec.health?.(p), public: false,
        memory: spec.memory ?? '256Mi', cpu: '250m',
      }
    }
    const vars: Record<string, string> = {}
    for (const d of dependencies(doc, n)) {
      const c = connection(d, env)
      vars[c.env] = c.url
      Object.assign(vars, c.extra)
    }
    if (EDGE.has(n.techId)) {
      return { node: n, name: n.name, role: 'edge', build: `gateways/${n.name}`, port: 8080, ports: [], env: vars, public: true, memory: '64Mi', cpu: '100m', httpHealth: '/healthz' }
    }
    for (const name of env?.secrets ?? []) vars[name] = ref(name)
    const auth = builtInAuth(doc)
    if (auth) {
      vars.AUTH_SECRET = ref('AUTH_SECRET')
      if (n.techId === 'web-app' && !vars[connection(auth, env).env]) vars[connection(auth, env).env] = connection(auth, env).url
    }
    const web = n.techId === 'web-app'
    const port = portOf(n)
    return {
      node: n, name: n.name, role: 'app', build: web ? `apps/${n.name}` : `services/${n.name}`,
      port, ports: [], env: { ...vars, PORT: String(port), OTEL_SERVICE_NAME: n.name, ...TELEMETRY },
      public: isPublic(doc, n),
      httpHealth: n.techId === 'cron' ? undefined : web ? '/' : '/healthz',
      schedule: n.techId === 'cron' ? String(n.config.schedule ?? '0 * * * *') : undefined,
      memory: memoryOf(n, web ? '384Mi' : '256Mi'),
      cpu: String(n.config.cpu ?? '0.25'),
    }
  })
}

const TELEMETRY: Record<string, string> = {
  OTEL_EXPORTER_OTLP_ENDPOINT: ref('TESSERY_OTLP_ENDPOINT'),
  OTEL_EXPORTER_OTLP_HEADERS: ref('TESSERY_OTLP_HEADERS'),
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
  OTEL_METRICS_EXPORTER: 'none',
  OTEL_LOGS_EXPORTER: 'none',
}

export function secrets(doc: ProjectDoc, env?: Environment): SecretSpec[] {
  const out = new Map<string, SecretSpec>()
  for (const n of doc.nodes) {
    if (runsAsContainer(n, env)) {
      if (DATA[n.techId]?.password) out.set(passwordSecret(n), { name: passwordSecret(n), generate: true, description: `Password for ${n.name}` })
      continue
    }
    const used = doc.edges.some((e) => e.target === n.id && runsAsContainer(doc.nodes.find((x) => x.id === e.source)!, env))
    const t = TECH_BY_ID[n.techId]
    if (used && t && t.category !== 'client') out.set(`${envName(n.name)}_URL`, { name: `${envName(n.name)}_URL`, generate: false, description: `Address of ${n.name} (${t.name}), which runs outside this environment` })
  }
  if (builtInAuth(doc)) out.set('AUTH_SECRET', { name: 'AUTH_SECRET', generate: true, description: 'Signs user sessions' })
  for (const s of env?.secrets ?? []) if (!out.has(s)) out.set(s, { name: s, generate: false, description: 'Declared on the environment' })
  return [...out.values()]
}

export function hostPort(doc: ProjectDoc, envId: string, name: string): number {
  let h = 2166136261
  for (const c of `${doc.id}/${envId}/${name}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return 20000 + ((h >>> 0) % 10000)
}
