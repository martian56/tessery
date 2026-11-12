import type { Capability, Category, ConfigField, PortDef, PortType, Technology } from '../domain/types'

const IN = (type: PortType, id: string = type, label?: string): PortDef => ({ id, type, label, multi: true })
const OUT: PortDef = { id: 'out', type: 'any', label: 'calls', multi: true }
const f = (key: string, label: string, def: ConfigField['default'], extra: Partial<ConfigField> = {}): ConfigField => ({
  key, label, default: def, type: typeof def === 'boolean' ? 'bool' : typeof def === 'number' ? 'number' : extra.options ? 'select' : 'text', ...extra,
})
const sel = (key: string, label: string, options: string[], def = options[0]) => f(key, label, def, { options, type: 'select' })

type Extra = Partial<Omit<Technology, 'id' | 'name' | 'category' | 'glyph' | 'description'>>
function t(id: string, name: string, category: Category, glyph: string, description: string, extra: Extra = {}): Technology {
  return { id, name, category, glyph, description, inputs: [], outputs: [], config: [], ...extra }
}

const LANGS = ['TypeScript', 'Go', 'Python', 'Rust', 'Java', 'Kotlin', 'C#', 'Elixir', 'Ruby', 'PHP', 'Scala', 'Swift', 'C++', 'Zig']
const compute = (cap: Capability, extra: Extra = {}): Extra => ({ capability: cap, inputs: [IN('http', 'in', 'requests')], outputs: [OUT], capacity: 400, latency: 10, ...extra })
const store = (cap: Capability, type: PortType, image: string, extra: Extra = {}): Extra => ({ capability: cap, inputs: [IN(type, 'in')], outputs: [], image, capacity: 2000, latency: 3, ...extra })
const resources = [sel('cpu', 'CPU', ['0.25', '0.5', '1', '2', '4', '8']), sel('memory', 'Memory', ['256Mi', '512Mi', '1Gi', '2Gi', '4Gi', '8Gi', '16Gi'])]
const dbCfg = (versions: string[]) => [sel('version', 'Version', versions), f('storageGb', 'Storage', 20, { unit: 'GB' }), f('highAvailability', 'High availability', false), sel('backups', 'Backups', ['daily', 'hourly', 'off'])]

export const TECHNOLOGIES: Technology[] = [
  t('web-app', 'Web App', 'client', 'web', 'Browser application: SPA, SSR or static.', { outputs: [OUT], inputs: [IN('ws', 'push', 'push')], capacity: 0, config: [sel('framework', 'Framework', ['Next.js', 'React + Vite', 'Remix', 'Nuxt', 'Vue + Vite', 'SvelteKit', 'Astro', 'Angular', 'SolidStart', 'Qwik']), sel('rendering', 'Rendering', ['SSR', 'SSG', 'ISR', 'SPA']), f('trafficRps', 'Expected traffic', 200, { unit: 'rps' })], image: 'node:22-alpine', capability: 'static-hosting' }),
  t('mobile-app', 'Mobile App', 'client', 'app', 'iOS / Android client.', { outputs: [OUT], inputs: [IN('ws', 'push', 'push')], config: [sel('framework', 'Framework', ['React Native', 'Flutter', 'Swift (iOS)', 'Kotlin (Android)', 'Kotlin Multiplatform', '.NET MAUI', 'Ionic']), f('trafficRps', 'Expected traffic', 100, { unit: 'rps' })] }),
  t('desktop-app', 'Desktop App', 'client', 'desk', 'Native or web-based desktop client.', { outputs: [OUT], inputs: [IN('ws', 'push', 'push')], config: [sel('framework', 'Framework', ['Tauri', 'Electron', 'Qt', '.NET WPF', 'SwiftUI (macOS)', 'Flutter Desktop']), f('trafficRps', 'Expected traffic', 20, { unit: 'rps' })] }),
  t('cli', 'CLI Tool', 'client', 'cli', 'Command-line client or SDK consumer.', { outputs: [OUT], config: [sel('language', 'Language', ['Go', 'Rust', 'TypeScript', 'Python']), f('trafficRps', 'Expected traffic', 5, { unit: 'rps' })] }),
  t('iot-device', 'IoT Devices', 'client', 'iot', 'Fleet of devices sending telemetry.', { outputs: [OUT], config: [sel('protocol', 'Protocol', ['MQTT', 'HTTP', 'CoAP', 'LwM2M']), f('devices', 'Fleet size', 10000), f('trafficRps', 'Messages', 500, { unit: 'msg/s' })] }),
  t('third-party-client', 'Partner / Webhook Caller', 'client', 'ext', 'External systems calling your API.', { outputs: [OUT], config: [f('trafficRps', 'Expected traffic', 30, { unit: 'rps' })] }),

  t('api-gateway', 'API Gateway', 'network', 'gw', 'Routing, auth, rate limits in front of services.', { ...compute('api-gateway', { capacity: 5000, latency: 2 }), image: 'kong:3.9', config: [sel('engine', 'Engine', ['Kong', 'Envoy', 'Traefik', 'Tyk', 'KrakenD', 'APISIX', 'Managed']), sel('auth', 'Auth', ['JWT', 'OAuth2 / OIDC', 'API key', 'mTLS', 'none']), f('rateLimit', 'Rate limit', '1000/min'), f('tls', 'TLS', true)] }),
  t('graphql-gateway', 'GraphQL Gateway', 'network', 'gql', 'Federated GraphQL supergraph router.', { inputs: [IN('graphql', 'in')], outputs: [OUT], image: 'ghcr.io/apollographql/router:v2', capacity: 3000, latency: 3, config: [sel('engine', 'Engine', ['Apollo Router', 'Hive Gateway', 'GraphQL Mesh', 'WunderGraph Cosmo']), f('introspection', 'Introspection', false), f('persistedQueries', 'Persisted queries', true)] }),
  t('load-balancer', 'Load Balancer', 'network', 'lb', 'L4/L7 traffic distribution.', { ...compute('load-balancer', { capacity: 20000, latency: 1 }), image: 'haproxy:3.0', config: [sel('engine', 'Engine', ['Managed', 'HAProxy', 'NGINX', 'Caddy', 'Envoy']), sel('algorithm', 'Algorithm', ['round-robin', 'least-conn', 'ip-hash']), f('healthPath', 'Health check', '/healthz')] }),
  t('reverse-proxy', 'Reverse Proxy', 'network', 'rp', 'TLS termination and routing on a VPS.', { ...compute('load-balancer', { capacity: 15000, latency: 1 }), image: 'caddy:2', config: [sel('engine', 'Engine', ['Caddy', 'NGINX', 'Traefik', 'HAProxy']), f('autoTls', 'Automatic TLS', true)] }),
  t('cdn', 'CDN', 'network', 'cdn', 'Edge cache for static and dynamic content.', { capability: 'cdn', inputs: [IN('http', 'in')], outputs: [OUT], capacity: 1e6, latency: 1, saas: true, config: [sel('provider', 'Network', ['Managed', 'Cloudflare', 'Fastly', 'Bunny', 'Akamai']), f('ttl', 'Default TTL', '3600s')] }),
  t('dns', 'DNS', 'network', 'dns', 'Domains and records.', { capability: 'dns', inputs: [], outputs: [OUT], saas: true, config: [f('domain', 'Domain', 'example.com'), sel('provider', 'Provider', ['Managed', 'Cloudflare', 'Route 53', 'Bunny DNS'])] }),
  t('waf', 'WAF / DDoS', 'network', 'waf', 'Web application firewall and DDoS protection.', { capability: 'waf', inputs: [IN('http', 'in')], outputs: [OUT], saas: true, capacity: 1e6, latency: 1, config: [sel('ruleset', 'Ruleset', ['OWASP core', 'Managed', 'Custom']), f('botProtection', 'Bot protection', true)] }),
  t('service-mesh', 'Service Mesh', 'network', 'mesh', 'mTLS, retries and traffic policy between services.', { capability: 'kubernetes', inputs: [], outputs: [], config: [sel('engine', 'Engine', ['Istio', 'Linkerd', 'Cilium', 'Consul'])] }),

  t('service', 'Service', 'compute', 'svc', 'Backend service. Pick a language, framework and API style.', { ...compute('container'), apiStyles: ['rest', 'graphql', 'grpc', 'websocket', 'trpc', 'sse', 'webhook', 'soap'], languages: LANGS, image: 'build', config: [sel('language', 'Language', LANGS), f('framework', 'Framework', 'Fastify'), sel('apiStyle', 'API style', ['rest', 'graphql', 'grpc', 'websocket', 'trpc', 'sse', 'webhook']), f('port', 'Port', 8080), ...resources] }),
  t('worker', 'Worker', 'compute', 'job', 'Background job processor / queue consumer.', { capability: 'container', inputs: [IN('sub', 'in', 'jobs')], outputs: [OUT], image: 'build', capacity: 80, latency: 40, languages: LANGS, config: [sel('language', 'Language', LANGS, 'Python'), f('concurrency', 'Concurrency', 8), ...resources] }),
  t('cron', 'Scheduled Job', 'compute', 'cron', 'Runs on a schedule.', { capability: 'container', inputs: [], outputs: [OUT], image: 'build', languages: LANGS, config: [sel('language', 'Language', LANGS), f('schedule', 'Schedule', '0 * * * *'), f('timeout', 'Timeout', '15m')] }),
  t('function', 'Serverless Function', 'compute', 'λ', 'Event-driven function.', { capability: 'serverless', inputs: [IN('http', 'in')], outputs: [OUT], capacity: 1000, latency: 25, languages: ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C#'], config: [sel('runtime', 'Runtime', ['node22', 'python3.13', 'go1.24', 'rust', 'java21', 'dotnet9']), f('memoryMb', 'Memory', 256, { unit: 'MB' }), f('timeoutS', 'Timeout', 10, { unit: 's' })] }),
  t('edge-function', 'Edge Function', 'compute', 'edge', 'Code running at CDN edge locations.', { capability: 'edge-functions', inputs: [IN('http', 'in')], outputs: [OUT], capacity: 5000, latency: 4, saas: true, config: [sel('runtime', 'Runtime', ['V8 isolates', 'WASM'])] }),
  t('workflow', 'Workflow Engine', 'compute', 'flow', 'Durable workflows and sagas.', { capability: 'container', inputs: [IN('grpc', 'in')], outputs: [OUT], image: 'temporalio/auto-setup:1.27', capacity: 800, latency: 8, config: [sel('engine', 'Engine', ['Temporal', 'Restate', 'Inngest', 'Hatchet', 'Airflow'])] }),
  t('batch', 'Batch / Data Pipeline', 'compute', 'etl', 'ETL and batch processing.', { capability: 'container', inputs: [IN('sub', 'in')], outputs: [OUT], image: 'apache/spark:3.5.4', capacity: 50, latency: 200, config: [sel('engine', 'Engine', ['Spark', 'Flink', 'dbt', 'Dagster', 'Beam'])] }),

  t('postgres', 'PostgreSQL', 'data', 'pg', 'Relational database.', store('postgres', 'sql', 'postgres:17', { config: [...dbCfg(['17', '16', '15']), f('extensions', 'Extensions', 'pgcrypto, pg_trgm')] })),
  t('mysql', 'MySQL', 'data', 'my', 'Relational database.', store('mysql', 'sql', 'mysql:8.4', { config: dbCfg(['8.4', '8.0']) })),
  t('mariadb', 'MariaDB', 'data', 'maria', 'Relational database (MySQL compatible).', store('mysql', 'sql', 'mariadb:11', { config: dbCfg(['11.4', '10.11']) })),
  t('sqlite', 'SQLite / libSQL', 'data', 'lite', 'Embedded or edge-replicated SQL.', store('postgres', 'sql', 'ghcr.io/tursodatabase/libsql-server:latest', { capacity: 800, config: [sel('mode', 'Mode', ['embedded', 'libSQL server', 'Turso'])] })),
  t('cockroachdb', 'CockroachDB', 'data', 'crdb', 'Distributed SQL.', store('postgres', 'sql', 'cockroachdb/cockroach:v24.3', { capacity: 3000, config: [f('nodes', 'Nodes', 3), ...dbCfg(['24.3'])] })),
  t('mongodb', 'MongoDB', 'data', 'mdb', 'Document database.', store('mongodb', 'nosql', 'mongo:8', { config: dbCfg(['8.0', '7.0']) })),
  t('cassandra', 'Cassandra / Scylla', 'data', 'cql', 'Wide-column store for huge write volume.', store('cassandra', 'nosql', 'scylladb/scylla:6.2', { capacity: 8000, config: [f('nodes', 'Nodes', 3), f('replicationFactor', 'Replication', 3)] })),
  t('dynamodb', 'DynamoDB', 'data', 'ddb', 'Serverless key-value / document (AWS).', store('dynamodb', 'nosql', 'amazon/dynamodb-local', { capacity: 10000, saas: true, config: [sel('billing', 'Billing', ['on-demand', 'provisioned'])] })),
  t('clickhouse', 'ClickHouse', 'data', 'ch', 'Columnar analytics database.', store('clickhouse', 'sql', 'clickhouse/clickhouse-server:25.3', { capacity: 1500, config: dbCfg(['25.3']) })),
  t('timescaledb', 'TimescaleDB', 'data', 'ts', 'Time-series on Postgres.', store('timeseries', 'sql', 'timescale/timescaledb:latest-pg17', { config: dbCfg(['2.18']) })),
  t('influxdb', 'InfluxDB', 'data', 'flux', 'Time-series database.', store('timeseries', 'nosql', 'influxdb:2.7', { config: [f('retention', 'Retention', '30d')] })),
  t('neo4j', 'Neo4j', 'data', 'graph', 'Graph database.', store('graph-db', 'nosql', 'neo4j:5', { capacity: 1200, config: dbCfg(['5']) })),
  t('elasticsearch', 'Elasticsearch / OpenSearch', 'data', 'es', 'Full-text search and analytics.', store('search', 'search', 'opensearchproject/opensearch:2', { capacity: 1500, config: [f('nodes', 'Nodes', 3), f('storageGb', 'Storage', 100, { unit: 'GB' })] })),
  t('meilisearch', 'Meilisearch', 'data', 'meili', 'Instant search engine.', store('search', 'search', 'getmeili/meilisearch:v1.13', { capacity: 1200, config: [f('storageGb', 'Storage', 10, { unit: 'GB' })] })),
  t('typesense', 'Typesense', 'data', 'tsns', 'Typo-tolerant search.', store('search', 'search', 'typesense/typesense:28.0', { capacity: 1500 })),
  t('qdrant', 'Qdrant', 'data', 'qd', 'Vector database.', store('vector-db', 'vector', 'qdrant/qdrant:v1.13', { capacity: 1500, config: [f('dimensions', 'Dimensions', 1536), sel('distance', 'Distance', ['cosine', 'dot', 'euclid'])] })),
  t('weaviate', 'Weaviate', 'data', 'wv', 'Vector database with modules.', store('vector-db', 'vector', 'semitechnologies/weaviate:1.28', { capacity: 1200 })),
  t('pgvector', 'pgvector', 'data', 'pgv', 'Vectors inside Postgres.', store('postgres', 'vector', 'pgvector/pgvector:pg17', { config: [f('dimensions', 'Dimensions', 1536), ...dbCfg(['17'])] })),
  t('pinecone', 'Pinecone', 'data', 'pc', 'Managed vector database (SaaS).', { capability: 'vector-db', inputs: [IN('vector', 'in')], outputs: [], saas: true, capacity: 5000, latency: 15, config: [sel('tier', 'Tier', ['serverless', 'pod'])] }),
  t('supabase', 'Supabase', 'data', 'supa', 'Postgres + auth + storage (SaaS or self-hosted).', store('postgres', 'sql', 'supabase/postgres:15', { config: [sel('mode', 'Mode', ['cloud', 'self-hosted'])] })),
  t('firestore', 'Firestore', 'data', 'fs', 'Serverless document DB (GCP).', { capability: 'mongodb', inputs: [IN('nosql', 'in')], outputs: [], saas: true, capacity: 10000, latency: 12, config: [] }),

  t('redis', 'Redis', 'cache', 'redis', 'In-memory cache, locks, rate limits, pub/sub.', store('redis', 'kv', 'redis:7.4', { capacity: 20000, latency: 1, config: [sel('engine', 'Engine', ['Redis', 'Valkey', 'Dragonfly', 'KeyDB']), sel('memory', 'Memory', ['256Mi', '1Gi', '4Gi', '16Gi'], '1Gi'), sel('eviction', 'Eviction', ['allkeys-lru', 'volatile-lru', 'noeviction']), f('persistence', 'Persistence', false)] })),
  t('memcached', 'Memcached', 'cache', 'mc', 'Simple distributed cache.', store('redis', 'kv', 'memcached:1.6', { capacity: 25000, latency: 1, config: [sel('memory', 'Memory', ['256Mi', '1Gi', '4Gi'], '1Gi')] })),

  t('kafka', 'Kafka', 'messaging', 'kafka', 'Durable event log.', { capability: 'kafka', inputs: [IN('pub', 'in', 'publish')], outputs: [{ id: 'sub', type: 'sub', label: 'consume', multi: true }], image: 'apache/kafka:3.9.0', capacity: 20000, latency: 4, config: [sel('engine', 'Engine', ['Kafka', 'Redpanda', 'WarpStream']), f('partitions', 'Partitions', 12), f('retention', 'Retention', '7d'), f('brokers', 'Brokers', 3)] }),
  t('rabbitmq', 'RabbitMQ', 'messaging', 'amqp', 'Message broker with routing.', { capability: 'rabbitmq', inputs: [IN('pub', 'in', 'publish')], outputs: [{ id: 'sub', type: 'sub', label: 'consume', multi: true }], image: 'rabbitmq:4-management', capacity: 8000, latency: 3, config: [f('durable', 'Durable queues', true), f('quorum', 'Quorum queues', true)] }),
  t('nats', 'NATS', 'messaging', 'nats', 'Lightweight messaging + JetStream.', { capability: 'nats', inputs: [IN('pub', 'in', 'publish')], outputs: [{ id: 'sub', type: 'sub', label: 'consume', multi: true }], image: 'nats:2.10', capacity: 40000, latency: 1, config: [f('jetstream', 'JetStream', true)] }),
  t('queue', 'Managed Queue', 'messaging', 'q', 'Simple point-to-point queue (SQS, Cloud Tasks…).', { capability: 'queue', inputs: [IN('pub', 'in', 'enqueue')], outputs: [{ id: 'sub', type: 'sub', label: 'dequeue', multi: true }], image: 'softwaremill/elasticmq-native', capacity: 3000, latency: 10, config: [f('visibilityTimeout', 'Visibility', '30s'), f('dlq', 'Dead-letter queue', true)] }),
  t('mqtt', 'MQTT Broker', 'messaging', 'mqtt', 'Pub/sub for devices.', { capability: 'pubsub', inputs: [IN('pub', 'in', 'publish')], outputs: [{ id: 'sub', type: 'sub', label: 'subscribe', multi: true }], image: 'emqx/emqx:5.8', capacity: 30000, latency: 2, config: [sel('engine', 'Engine', ['EMQX', 'Mosquitto', 'HiveMQ', 'VerneMQ'])] }),

  t('object-storage', 'Object Storage', 'storage', 's3', 'S3-compatible blobs.', store('object-storage', 'object', 'chrislusf/seaweedfs', { capacity: 5000, latency: 20, config: [f('bucket', 'Bucket', 'assets'), f('versioning', 'Versioning', true), f('publicRead', 'Public read', false), f('storageGb', 'Expected size', 100, { unit: 'GB' })] })),
  t('block-storage', 'Block Volume', 'storage', 'vol', 'Attached disks for VMs and stateful services.', store('block-storage', 'tcp', '', { capacity: 1e5, latency: 1, config: [f('sizeGb', 'Size', 100, { unit: 'GB' }), sel('class', 'Class', ['ssd', 'nvme', 'hdd'])] })),

  t('llm-api', 'LLM API', 'ai', 'llm', 'Hosted model API (Claude, etc.).', { capability: 'llm', inputs: [IN('llm', 'in')], outputs: [], saas: true, capacity: 200, latency: 900, config: [sel('model', 'Model', ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'other']), f('maxTokens', 'Max tokens', 4096), f('promptCaching', 'Prompt caching', true)] }),
  t('llm-selfhosted', 'Self-hosted Model', 'ai', 'gpu', 'Open-weights model served on GPUs.', { capability: 'gpu', inputs: [IN('llm', 'in')], outputs: [], image: 'vllm/vllm-openai:latest', capacity: 40, latency: 600, config: [sel('server', 'Server', ['vLLM', 'TGI', 'Ollama', 'llama.cpp', 'SGLang']), f('model', 'Model', 'open-weights-8b'), sel('gpu', 'GPU', ['L4', 'A10G', 'L40S', 'A100', 'H100'])] }),
  t('embeddings', 'Embedding Service', 'ai', 'emb', 'Turns text/images into vectors.', { capability: 'gpu', inputs: [IN('http', 'in')], outputs: [OUT], image: 'ghcr.io/huggingface/text-embeddings-inference:latest', capacity: 300, latency: 30, config: [f('model', 'Model', 'bge-m3'), f('dimensions', 'Dimensions', 1024)] }),
  t('ml-training', 'Training Job', 'ai', 'train', 'Model training / fine-tuning on GPUs.', { capability: 'gpu', inputs: [], outputs: [OUT], image: 'pytorch/pytorch:latest', config: [sel('gpu', 'GPU', ['A100', 'H100', 'L40S']), f('gpus', 'GPUs', 8)] }),

  t('otel-collector', 'OTel Collector', 'observability', 'otel', 'Receives metrics, logs and traces.', { capability: 'monitoring', inputs: [IN('telemetry', 'in')], outputs: [OUT], image: 'otel/opentelemetry-collector-contrib:latest', capacity: 50000, latency: 1, config: [f('sampling', 'Trace sampling', 0.1)] }),
  t('prometheus', 'Prometheus', 'observability', 'prom', 'Metrics store and alerting.', store('monitoring', 'telemetry', 'prom/prometheus:v3', { config: [f('retention', 'Retention', '15d'), f('scrapeInterval', 'Scrape interval', '15s')] })),
  t('grafana', 'Grafana', 'observability', 'graf', 'Dashboards over metrics, logs, traces.', { capability: 'monitoring', inputs: [], outputs: [OUT], image: 'grafana/grafana:11', config: [f('sso', 'SSO', true)] }),
  t('loki', 'Loki', 'observability', 'loki', 'Log aggregation.', store('logging', 'telemetry', 'grafana/loki:3', { config: [f('retention', 'Retention', '14d')] })),
  t('tempo', 'Tempo / Jaeger', 'observability', 'trace', 'Distributed tracing backend.', store('tracing', 'telemetry', 'grafana/tempo:2', { config: [f('retention', 'Retention', '7d')] })),
  t('sentry', 'Sentry', 'observability', 'sentry', 'Error tracking (SaaS or self-hosted).', { capability: 'monitoring', inputs: [IN('telemetry', 'in')], outputs: [], image: 'getsentry/self-hosted', config: [sel('mode', 'Mode', ['cloud', 'self-hosted'])] }),
  t('datadog', 'Datadog', 'observability', 'dd', 'Full observability platform (SaaS).', { capability: 'monitoring', inputs: [IN('telemetry', 'in')], outputs: [], saas: true, config: [sel('site', 'Site', ['US1', 'EU1', 'US5'])] }),

  t('auth-service', 'Identity Provider', 'security', 'idp', 'Users, sessions, OAuth/OIDC, SSO.', { capability: 'auth', inputs: [IN('http', 'in')], outputs: [OUT], image: 'quay.io/keycloak/keycloak:26', capacity: 1500, latency: 15, config: [sel('engine', 'Engine', ['Built-in (Tessery)', 'Keycloak', 'Ory', 'Zitadel', 'Authentik', 'Clerk', 'Auth0', 'WorkOS', 'Cognito', 'Supabase Auth']), f('mfa', 'MFA', true), sel('flows', 'Flows', ['PKCE', 'Client credentials', 'Device code'])] }),
  t('secrets', 'Secrets Manager', 'security', 'vault', 'Secret storage and rotation.', { capability: 'secrets', inputs: [IN('http', 'in')], outputs: [], image: 'hashicorp/vault:1.18', capacity: 3000, latency: 5, config: [sel('engine', 'Engine', ['Managed', 'Vault', 'OpenBao', 'Infisical', 'Doppler']), f('rotation', 'Auto-rotation', true)] }),

  t('payments', 'Payments', 'external', 'pay', 'Payment processor API.', { inputs: [IN('http', 'in')], outputs: [OUT], saas: true, capacity: 300, latency: 220, config: [sel('provider', 'Provider', ['Stripe', 'Adyen', 'PayPal', 'Paddle', 'Lemon Squeezy']), f('webhooks', 'Webhooks', true)] }),
  t('email', 'Email', 'external', 'mail', 'Transactional email.', { capability: 'email', inputs: [IN('smtp', 'in')], outputs: [], saas: true, capacity: 200, latency: 150, config: [sel('provider', 'Provider', ['Managed', 'Resend', 'Postmark', 'SendGrid', 'SES', 'Mailgun'])] }),
  t('sms', 'SMS / Voice', 'external', 'sms', 'Messaging and voice API.', { inputs: [IN('http', 'in')], outputs: [], saas: true, capacity: 100, latency: 300, config: [sel('provider', 'Provider', ['Twilio', 'Vonage', 'MessageBird'])] }),
  t('maps', 'Maps / Geo', 'external', 'geo', 'Geocoding, routing, tiles.', { inputs: [IN('http', 'in')], outputs: [], saas: true, capacity: 500, latency: 120, config: [sel('provider', 'Provider', ['Mapbox', 'Google Maps', 'HERE', 'OpenStreetMap'])] }),
  t('external-api', 'External API', 'external', 'api', 'Any third-party HTTP API.', { inputs: [IN('http', 'in')], outputs: [], saas: true, capacity: 300, latency: 150, config: [f('baseUrl', 'Base URL', 'https://api.example.com'), sel('auth', 'Auth', ['API key', 'OAuth2', 'none'])] }),
]

export const TECH_BY_ID: Record<string, Technology> = Object.fromEntries(TECHNOLOGIES.map((x) => [x.id, x]))

export const CATEGORY_META: Record<Category, { label: string; color: string; order: number }> = {
  client: { label: 'Clients', color: 'var(--c-client)', order: 0 },
  network: { label: 'Network & Edge', color: 'var(--c-network)', order: 1 },
  compute: { label: 'Compute', color: 'var(--c-compute)', order: 2 },
  data: { label: 'Databases', color: 'var(--c-data)', order: 3 },
  cache: { label: 'Cache', color: 'var(--c-cache)', order: 4 },
  messaging: { label: 'Messaging & Events', color: 'var(--c-messaging)', order: 5 },
  storage: { label: 'Storage', color: 'var(--c-storage)', order: 6 },
  ai: { label: 'AI / ML', color: 'var(--c-ai)', order: 7 },
  observability: { label: 'Observability', color: 'var(--c-observability)', order: 8 },
  security: { label: 'Security & Identity', color: 'var(--c-security)', order: 9 },
  external: { label: 'External Services', color: 'var(--c-external)', order: 10 },
}

export const PORT_COLORS: Record<PortType, string> = {
  http: 'var(--c-network)', graphql: '#e535ab', grpc: '#4aa3df', ws: 'var(--c-client)', sql: 'var(--c-data)', nosql: 'var(--c-data)',
  kv: 'var(--c-cache)', pub: 'var(--c-messaging)', sub: 'var(--c-messaging)', object: 'var(--c-storage)', search: '#c9a227',
  vector: 'var(--c-ai)', llm: 'var(--c-ai)', telemetry: 'var(--c-observability)', smtp: 'var(--c-external)', tcp: 'var(--tx-3)', any: 'var(--tx-2)',
}

const COMPAT: Partial<Record<PortType, PortType[]>> = {
  http: ['http', 'graphql', 'grpc', 'ws'],
  sub: ['sub', 'http', 'graphql', 'grpc'],
}
export function portsCompatible(out: PortType, input: PortType) {
  if (out === 'any') return input !== 'sub'
  if (out === input) return true
  return (COMPAT[out] ?? []).includes(input)
}

export function edgeProtocol(targetType: PortType, sourceTechId?: string): string {
  if (sourceTechId === 'iot-device') return 'MQTT'
  return ({ http: 'HTTP', graphql: 'GraphQL', grpc: 'gRPC', ws: 'WebSocket', sql: 'SQL', nosql: 'driver', kv: 'RESP', pub: 'publish', sub: 'consume', object: 'S3 API', search: 'HTTP', vector: 'HTTP', llm: 'HTTPS', telemetry: 'OTLP', smtp: 'SMTP', tcp: 'TCP', any: '' } as Record<PortType, string>)[targetType]
}
