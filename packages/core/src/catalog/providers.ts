import type { Capability, Offering, Provider, ProviderPlan, Region } from '../domain/types'

const o = (product: string, monthly: number, notes?: string, unit?: string): Offering => ({ product, monthly, notes, unit })
const r = (id: string, name: string, geo: Region['geo']): Region => ({ id, name, geo })
const p = (id: string, name: string, vcpu: number, ramGb: number, diskGb: number, monthly: number): ProviderPlan => ({ id, name, vcpu, ramGb, diskGb, monthly })

export const PROVIDERS: Provider[] = [
  {
    id: 'aws', name: 'AWS', kind: 'hyperscaler', color: '#ff9900', iac: ['terraform', 'pulumi'],
    regions: [r('us-east-1', 'N. Virginia', 'na'), r('us-west-2', 'Oregon', 'na'), r('eu-central-1', 'Frankfurt', 'eu'), r('eu-west-1', 'Ireland', 'eu'), r('ap-southeast-1', 'Singapore', 'apac'), r('ap-northeast-1', 'Tokyo', 'apac'), r('sa-east-1', 'São Paulo', 'sa'), r('me-central-1', 'UAE', 'me')],
    plans: [p('t4g.small', 't4g.small', 2, 2, 20, 13), p('t4g.medium', 't4g.medium', 2, 4, 30, 27), p('m7g.large', 'm7g.large', 2, 8, 50, 60), p('m7g.xlarge', 'm7g.xlarge', 4, 16, 80, 119), p('c7g.2xlarge', 'c7g.2xlarge', 8, 16, 100, 210)],
    offers: {
      vm: o('EC2', 13), container: o('ECS Fargate', 18), kubernetes: o('EKS', 73, 'control plane'), serverless: o('Lambda', 3), gpu: o('EC2 G6 (L4)', 590), 'static-hosting': o('S3 + CloudFront', 2), 'edge-functions': o('CloudFront Functions', 1),
      postgres: o('RDS / Aurora PostgreSQL', 28), mysql: o('RDS MySQL', 26), mongodb: o('DocumentDB', 200, 'MongoDB-compatible'), redis: o('ElastiCache (Valkey)', 24), clickhouse: undefined, cassandra: o('Keyspaces', 40), dynamodb: o('DynamoDB', 5), timeseries: o('Timestream', 30), 'graph-db': o('Neptune', 110), 'vector-db': o('OpenSearch vectors', 60), search: o('OpenSearch Service', 55),
      kafka: o('MSK', 150), rabbitmq: o('Amazon MQ (RabbitMQ)', 60), queue: o('SQS', 1), pubsub: o('SNS', 1), stream: o('Kinesis', 30),
      'object-storage': o('S3', 3), 'block-storage': o('EBS gp3', 8), cdn: o('CloudFront', 5), 'load-balancer': o('ALB', 22), 'api-gateway': o('API Gateway', 10), dns: o('Route 53', 1), waf: o('AWS WAF', 10),
      llm: o('Bedrock', 0, 'pay per token'), monitoring: o('CloudWatch', 10), logging: o('CloudWatch Logs', 10), tracing: o('X-Ray', 5), secrets: o('Secrets Manager', 2), auth: o('Cognito', 0, 'free tier'), email: o('SES', 1),
    },
  },
  {
    id: 'gcp', name: 'Google Cloud', kind: 'hyperscaler', color: '#4285f4', iac: ['terraform', 'pulumi'],
    regions: [r('us-central1', 'Iowa', 'na'), r('us-east4', 'Virginia', 'na'), r('europe-west1', 'Belgium', 'eu'), r('europe-west3', 'Frankfurt', 'eu'), r('asia-southeast1', 'Singapore', 'apac'), r('asia-northeast1', 'Tokyo', 'apac'), r('southamerica-east1', 'São Paulo', 'sa')],
    plans: [p('e2-small', 'e2-small', 2, 2, 20, 13), p('e2-medium', 'e2-medium', 2, 4, 30, 25), p('n2-standard-2', 'n2-standard-2', 2, 8, 50, 57), p('n2-standard-4', 'n2-standard-4', 4, 16, 80, 114), p('c3-standard-8', 'c3-standard-8', 8, 32, 100, 250)],
    offers: {
      vm: o('Compute Engine', 13), container: o('Cloud Run', 10), kubernetes: o('GKE Autopilot', 73), serverless: o('Cloud Run functions', 3), gpu: o('G2 (L4)', 520), 'static-hosting': o('Firebase Hosting', 0), 'edge-functions': undefined,
      postgres: o('Cloud SQL / AlloyDB', 30), mysql: o('Cloud SQL MySQL', 28), mongodb: o('Firestore (Mongo API)', 10), redis: o('Memorystore', 35), cassandra: o('Bigtable', 470), timeseries: o('Bigtable', 470), 'vector-db': o('Vertex Vector Search', 70), search: o('Vertex AI Search', 50), clickhouse: undefined, dynamodb: undefined, 'graph-db': o('Spanner Graph', 65),
      kafka: o('Managed Kafka', 150), queue: o('Cloud Tasks', 1), pubsub: o('Pub/Sub', 2), stream: o('Pub/Sub', 2),
      'object-storage': o('Cloud Storage', 3), 'block-storage': o('Persistent Disk', 8), cdn: o('Cloud CDN', 5), 'load-balancer': o('Cloud Load Balancing', 18), 'api-gateway': o('API Gateway / Apigee', 10), dns: o('Cloud DNS', 1), waf: o('Cloud Armor', 6),
      llm: o('Vertex AI', 0, 'pay per token'), monitoring: o('Cloud Monitoring', 8), logging: o('Cloud Logging', 8), tracing: o('Cloud Trace', 2), secrets: o('Secret Manager', 1), auth: o('Identity Platform', 0), email: undefined,
    },
  },
  {
    id: 'azure', name: 'Microsoft Azure', kind: 'hyperscaler', color: '#0078d4', iac: ['terraform', 'pulumi'],
    regions: [r('eastus', 'East US', 'na'), r('westus3', 'West US 3', 'na'), r('westeurope', 'Netherlands', 'eu'), r('germanywestcentral', 'Frankfurt', 'eu'), r('southeastasia', 'Singapore', 'apac'), r('japaneast', 'Tokyo', 'apac'), r('brazilsouth', 'São Paulo', 'sa'), r('uaenorth', 'UAE', 'me')],
    plans: [p('B2s', 'B2s', 2, 4, 30, 30), p('D2s_v5', 'D2s v5', 2, 8, 50, 70), p('D4s_v5', 'D4s v5', 4, 16, 80, 140), p('F8s_v2', 'F8s v2', 8, 16, 100, 248)],
    offers: {
      vm: o('Virtual Machines', 30), container: o('Container Apps', 15), kubernetes: o('AKS', 73), serverless: o('Functions', 3), gpu: o('NC A100 v4', 2600), 'static-hosting': o('Static Web Apps', 0), 'edge-functions': undefined,
      postgres: o('Database for PostgreSQL', 30), mysql: o('Database for MySQL', 28), mongodb: o('Cosmos DB (Mongo)', 25), redis: o('Azure Cache for Redis', 40), cassandra: o('Cosmos DB (Cassandra)', 25), dynamodb: undefined, 'vector-db': o('AI Search vectors', 75), search: o('AI Search', 75), timeseries: o('Data Explorer', 200), 'graph-db': o('Cosmos DB (Gremlin)', 25),
      kafka: o('Event Hubs (Kafka)', 22), rabbitmq: undefined, queue: o('Service Bus', 10), pubsub: o('Event Grid', 1), stream: o('Event Hubs', 22),
      'object-storage': o('Blob Storage', 3), 'block-storage': o('Managed Disks', 8), cdn: o('Front Door', 35), 'load-balancer': o('Application Gateway', 25), 'api-gateway': o('API Management', 50), dns: o('Azure DNS', 1), waf: o('Front Door WAF', 20),
      llm: o('Azure AI Foundry', 0, 'pay per token'), monitoring: o('Azure Monitor', 10), logging: o('Log Analytics', 10), tracing: o('App Insights', 5), secrets: o('Key Vault', 1), auth: o('Entra External ID', 0), email: o('Communication Services', 1),
    },
  },
  {
    id: 'hetzner', name: 'Hetzner', kind: 'cloud', color: '#d50c2d', iac: ['terraform', 'cloud-init', 'ansible'],
    regions: [r('fsn1', 'Falkenstein', 'eu'), r('nbg1', 'Nuremberg', 'eu'), r('hel1', 'Helsinki', 'eu'), r('ash', 'Ashburn', 'na'), r('hil', 'Hillsboro', 'na'), r('sin', 'Singapore', 'apac')],
    plans: [p('cx22', 'CX22', 2, 4, 40, 5), p('cx32', 'CX32', 4, 8, 80, 8), p('cx42', 'CX42', 8, 16, 160, 19), p('cx52', 'CX52', 16, 32, 320, 38), p('ccx33', 'CCX33 (dedicated)', 8, 32, 240, 60)],
    offers: {
      vm: o('Cloud Server', 5), 'block-storage': o('Volumes', 5, undefined, '100 GB'), 'load-balancer': o('Load Balancer', 6), 'object-storage': o('Object Storage', 6, 'S3-compatible, 1 TB'), dns: o('DNS', 0), gpu: o('GEX44 (dedicated)', 200),
    },
  },
  {
    id: 'contabo', name: 'Contabo', kind: 'vps', color: '#0f5aa5', iac: ['cloud-init', 'ansible', 'terraform'],
    regions: [r('eu', 'Germany', 'eu'), r('uk', 'United Kingdom', 'eu'), r('us-central', 'US Central', 'na'), r('us-east', 'US East', 'na'), r('sin', 'Singapore', 'apac'), r('jpn', 'Japan', 'apac'), r('aus', 'Sydney', 'oc')],
    plans: [p('vps-s', 'Cloud VPS 10', 4, 8, 75, 5), p('vps-m', 'Cloud VPS 20', 6, 12, 100, 8), p('vps-l', 'Cloud VPS 30', 8, 24, 200, 15), p('vps-xl', 'Cloud VPS 40', 12, 48, 250, 28), p('vds-m', 'Cloud VDS M (dedicated)', 4, 32, 240, 50)],
    offers: { vm: o('Cloud VPS', 5), 'object-storage': o('Object Storage', 3, '250 GB'), 'block-storage': undefined },
  },
  {
    id: 'digitalocean', name: 'DigitalOcean', kind: 'cloud', color: '#0080ff', iac: ['terraform', 'pulumi', 'cloud-init'],
    regions: [r('nyc3', 'New York', 'na'), r('sfo3', 'San Francisco', 'na'), r('ams3', 'Amsterdam', 'eu'), r('fra1', 'Frankfurt', 'eu'), r('lon1', 'London', 'eu'), r('sgp1', 'Singapore', 'apac'), r('blr1', 'Bangalore', 'apac'), r('syd1', 'Sydney', 'oc')],
    plans: [p('s-1vcpu-2gb', 'Basic 2 GB', 1, 2, 50, 12), p('s-2vcpu-4gb', 'Basic 4 GB', 2, 4, 80, 24), p('g-2vcpu-8gb', 'General 8 GB', 2, 8, 25, 63), p('c-4', 'CPU-Optimized 8 GB', 4, 8, 50, 84)],
    offers: {
      vm: o('Droplets', 6), container: o('App Platform', 5), kubernetes: o('DOKS', 0, 'free control plane'), serverless: o('Functions', 0), gpu: o('GPU Droplets (H100)', 2500), 'static-hosting': o('App Platform static', 0),
      postgres: o('Managed PostgreSQL', 15), mysql: o('Managed MySQL', 15), mongodb: o('Managed MongoDB', 15), redis: o('Managed Valkey', 15), kafka: o('Managed Kafka', 147), search: o('Managed OpenSearch', 19),
      'object-storage': o('Spaces', 5), 'block-storage': o('Volumes', 10), cdn: o('Spaces CDN', 0), 'load-balancer': o('Load Balancer', 12), dns: o('DNS', 0), monitoring: o('Monitoring', 0), llm: o('GenAI Platform', 0, 'pay per token'),
    },
  },
  {
    id: 'linode', name: 'Akamai (Linode)', kind: 'cloud', color: '#02b159', iac: ['terraform', 'cloud-init'],
    regions: [r('us-east', 'Newark', 'na'), r('us-west', 'Fremont', 'na'), r('eu-central', 'Frankfurt', 'eu'), r('gb-lon', 'London', 'eu'), r('ap-south', 'Singapore', 'apac'), r('jp-osa', 'Osaka', 'apac'), r('br-gru', 'São Paulo', 'sa')],
    plans: [p('g6-nanode-1', 'Nanode 1 GB', 1, 1, 25, 5), p('g6-standard-2', 'Linode 4 GB', 2, 4, 80, 24), p('g6-standard-4', 'Linode 8 GB', 4, 8, 160, 48), p('g6-dedicated-4', 'Dedicated 8 GB', 4, 8, 160, 72)],
    offers: { vm: o('Linodes', 5), kubernetes: o('LKE', 0), gpu: o('RTX 4000 Ada', 350), postgres: o('Managed PostgreSQL', 15), mysql: o('Managed MySQL', 15), 'object-storage': o('Object Storage', 5), 'block-storage': o('Block Storage', 10), cdn: o('Akamai CDN', 20), 'load-balancer': o('NodeBalancers', 10), dns: o('DNS Manager', 0), waf: o('App & API Protector', 50) },
  },
  {
    id: 'vultr', name: 'Vultr', kind: 'cloud', color: '#007bfc', iac: ['terraform', 'cloud-init'],
    regions: [r('ewr', 'New Jersey', 'na'), r('lax', 'Los Angeles', 'na'), r('fra', 'Frankfurt', 'eu'), r('ams', 'Amsterdam', 'eu'), r('sgp', 'Singapore', 'apac'), r('nrt', 'Tokyo', 'apac'), r('jnb', 'Johannesburg', 'af'), r('syd', 'Sydney', 'oc')],
    plans: [p('vc2-1c-2gb', 'Regular 2 GB', 1, 2, 55, 10), p('vc2-2c-4gb', 'Regular 4 GB', 2, 4, 80, 20), p('vhp-4c-8gb', 'High Perf 8 GB', 4, 8, 180, 48), p('voc-g-4c-16gb', 'Optimized 16 GB', 4, 16, 80, 120)],
    offers: { vm: o('Cloud Compute', 5), kubernetes: o('VKE', 0), gpu: o('Cloud GPU (A100)', 1300), postgres: o('Managed PostgreSQL', 15), mysql: o('Managed MySQL', 15), redis: o('Managed Valkey', 15), kafka: o('Managed Kafka', 120), 'object-storage': o('Object Storage', 6), 'block-storage': o('Block Storage', 10), 'load-balancer': o('Load Balancer', 10), dns: o('DNS', 0), cdn: o('CDN', 10) },
  },
  {
    id: 'ovh', name: 'OVHcloud', kind: 'cloud', color: '#123f6d', iac: ['terraform', 'pulumi', 'cloud-init'],
    regions: [r('gra', 'Gravelines', 'eu'), r('sbg', 'Strasbourg', 'eu'), r('de1', 'Frankfurt', 'eu'), r('uk1', 'London', 'eu'), r('bhs', 'Beauharnois', 'na'), r('sgp', 'Singapore', 'apac'), r('syd', 'Sydney', 'oc')],
    plans: [p('d2-4', 'D2-4', 2, 4, 50, 7), p('b3-8', 'B3-8', 2, 8, 50, 24), p('b3-16', 'B3-16', 4, 16, 100, 48), p('c3-32', 'C3-32', 16, 32, 200, 130)],
    offers: { vm: o('Public Cloud Instances', 7), kubernetes: o('Managed Kubernetes', 0), gpu: o('L40S', 1100), postgres: o('Managed PostgreSQL', 20), mysql: o('Managed MySQL', 20), mongodb: o('Managed MongoDB', 20), redis: o('Managed Valkey', 20), kafka: o('Managed Kafka', 80), search: o('Managed OpenSearch', 60), 'object-storage': o('Object Storage', 7), 'block-storage': o('Block Storage', 4), 'load-balancer': o('Load Balancer', 12), dns: o('DNS', 0), llm: o('AI Endpoints', 0) },
  },
  {
    id: 'scaleway', name: 'Scaleway', kind: 'cloud', color: '#4f0599', iac: ['terraform', 'pulumi'],
    regions: [r('fr-par', 'Paris', 'eu'), r('nl-ams', 'Amsterdam', 'eu'), r('pl-waw', 'Warsaw', 'eu')],
    plans: [p('DEV1-S', 'DEV1-S', 2, 2, 20, 7), p('PLAY2-MICRO', 'PLAY2-MICRO', 4, 8, 40, 22), p('PRO2-S', 'PRO2-S', 8, 32, 80, 120)],
    offers: { vm: o('Instances', 7), container: o('Serverless Containers', 5), kubernetes: o('Kapsule', 0), serverless: o('Serverless Functions', 2), gpu: o('L4 / H100', 650), postgres: o('Managed PostgreSQL', 15), mysql: o('Managed MySQL', 15), mongodb: o('Managed MongoDB', 30), redis: o('Managed Redis', 20), queue: o('Queues', 1), pubsub: o('Topics & Events', 1), nats: o('NATS', 1), 'object-storage': o('Object Storage', 2), 'block-storage': o('Block Storage', 8), 'load-balancer': o('Load Balancer', 10), dns: o('Domains & DNS', 0), secrets: o('Secret Manager', 1), monitoring: o('Cockpit', 0), logging: o('Cockpit', 0), tracing: o('Cockpit', 0), llm: o('Generative APIs', 0), email: o('Transactional Email', 1) },
  },
  {
    id: 'oracle', name: 'Oracle Cloud', kind: 'hyperscaler', color: '#c74634', iac: ['terraform'],
    regions: [r('us-ashburn-1', 'Ashburn', 'na'), r('eu-frankfurt-1', 'Frankfurt', 'eu'), r('ap-tokyo-1', 'Tokyo', 'apac'), r('sa-saopaulo-1', 'São Paulo', 'sa')],
    plans: [p('A1.Flex-2', 'Ampere A1 2 OCPU', 2, 12, 50, 18), p('E5.Flex-2', 'E5 Flex 2 OCPU', 2, 16, 50, 45)],
    offers: { vm: o('Compute', 18), container: o('Container Instances', 15), kubernetes: o('OKE', 0), serverless: o('Functions', 2), gpu: o('GPU A10', 1450), postgres: o('Database with PostgreSQL', 40), mysql: o('HeatWave MySQL', 35), redis: o('Cache', 30), kafka: o('Streaming (Kafka API)', 25), queue: o('Queue', 1), search: o('Search with OpenSearch', 60), 'object-storage': o('Object Storage', 3), 'block-storage': o('Block Volumes', 4), 'load-balancer': o('Load Balancer', 10), cdn: undefined, dns: o('DNS', 1), waf: o('WAF', 5), secrets: o('Vault', 0), llm: o('Generative AI', 0), monitoring: o('Monitoring', 0), logging: o('Logging', 0), email: o('Email Delivery', 1) },
  },
  {
    id: 'cloudflare', name: 'Cloudflare', kind: 'paas', color: '#f38020', iac: ['terraform', 'pulumi'],
    regions: [r('global', 'Global edge', 'na')],
    plans: [],
    offers: { 'edge-functions': o('Workers', 5), serverless: o('Workers', 5), container: o('Containers', 10), 'static-hosting': o('Pages', 0), postgres: o('Hyperdrive (to your Postgres)', 0, 'connection pooling only'), 'object-storage': o('R2', 2, 'no egress fees'), queue: o('Queues', 1), 'vector-db': o('Vectorize', 5), cdn: o('CDN', 0), dns: o('DNS', 0), waf: o('WAF', 20), 'load-balancer': o('Load Balancing', 5), 'api-gateway': o('API Shield', 0), llm: o('Workers AI', 0), email: o('Email Routing', 0) },
  },
  {
    id: 'vercel', name: 'Vercel', kind: 'paas', color: '#e2e2e7', iac: ['terraform'],
    regions: [r('iad1', 'Washington DC', 'na'), r('fra1', 'Frankfurt', 'eu'), r('sin1', 'Singapore', 'apac')],
    plans: [],
    offers: { 'static-hosting': o('Vercel', 20, 'Pro seat'), serverless: o('Functions', 0), 'edge-functions': o('Edge Middleware', 0), cdn: o('Edge Network', 0), waf: o('Firewall', 0), 'object-storage': o('Blob', 0) },
  },
  {
    id: 'fly', name: 'Fly.io', kind: 'paas', color: '#8b5cf6', iac: ['terraform'],
    regions: [r('iad', 'Ashburn', 'na'), r('ord', 'Chicago', 'na'), r('fra', 'Frankfurt', 'eu'), r('lhr', 'London', 'eu'), r('sin', 'Singapore', 'apac'), r('syd', 'Sydney', 'oc'), r('gru', 'São Paulo', 'sa')],
    plans: [p('shared-1x-1gb', 'shared-cpu-1x 1 GB', 1, 1, 10, 6), p('performance-2x-4gb', 'performance-2x 4 GB', 2, 4, 10, 62)],
    offers: { vm: o('Machines', 2), container: o('Machines', 2), gpu: o('L40S', 900), postgres: o('Managed Postgres', 38), redis: o('Upstash Redis', 0), 'object-storage': o('Tigris', 0), 'load-balancer': o('Fly Proxy', 0), 'block-storage': o('Volumes', 0) },
  },
  {
    id: 'railway', name: 'Railway', kind: 'paas', color: '#a0a0ab', iac: [],
    regions: [r('us-west', 'US West', 'na'), r('us-east', 'US East', 'na'), r('eu-west', 'EU West', 'eu'), r('asia-se', 'Southeast Asia', 'apac')],
    plans: [],
    offers: { container: o('Services', 5), postgres: o('PostgreSQL', 5), mysql: o('MySQL', 5), mongodb: o('MongoDB', 5), redis: o('Redis', 5), 'block-storage': o('Volumes', 0) },
  },
  {
    id: 'saas', name: 'Vendor SaaS', kind: 'paas', color: '#8a8a94', iac: [],
    regions: [r('vendor', 'Vendor-managed', 'na')], plans: [],
    offers: { llm: o('Model API', 0, 'pay per token'), email: o('Email API', 20), monitoring: o('SaaS', 30), auth: o('SaaS IdP', 25), 'vector-db': o('SaaS', 50), cdn: o('SaaS', 20), dns: o('SaaS', 0), waf: o('SaaS', 20), 'edge-functions': o('SaaS', 5), secrets: o('SaaS', 10), dynamodb: undefined },
  },
  {
    id: 'self', name: 'Own servers / VPS', kind: 'self', color: '#6c6c76', iac: ['ansible', 'cloud-init', 'compose'],
    regions: [r('onprem', 'On-premises', 'eu'), r('colo', 'Colocation', 'eu')],
    plans: [p('small', 'Small (2 vCPU, 4 GB)', 2, 4, 80, 0), p('medium', 'Medium (4 vCPU, 16 GB)', 4, 16, 250, 0), p('large', 'Large (16 vCPU, 64 GB)', 16, 64, 1000, 0)],
    offers: { vm: o('Your hardware', 0, 'capex, not billed here') },
  },
]

export const PROVIDER_BY_ID: Record<string, Provider> = Object.fromEntries(PROVIDERS.map((x) => [x.id, x]))

export const CAPABILITY_LABEL: Record<Capability, string> = {
  vm: 'Virtual machines', container: 'Containers', kubernetes: 'Kubernetes', serverless: 'Serverless functions', gpu: 'GPUs', 'static-hosting': 'Static hosting', 'edge-functions': 'Edge functions',
  postgres: 'PostgreSQL', mysql: 'MySQL', mongodb: 'Document DB', redis: 'Redis / Valkey', clickhouse: 'ClickHouse', cassandra: 'Wide-column', dynamodb: 'DynamoDB', timeseries: 'Time-series', 'graph-db': 'Graph DB', 'vector-db': 'Vector DB', search: 'Search',
  kafka: 'Kafka', rabbitmq: 'RabbitMQ', nats: 'NATS', queue: 'Queues', pubsub: 'Pub/Sub', stream: 'Streams',
  'object-storage': 'Object storage', 'block-storage': 'Block storage', cdn: 'CDN', 'load-balancer': 'Load balancer', 'api-gateway': 'API gateway', dns: 'DNS', waf: 'WAF',
  llm: 'LLM API', monitoring: 'Monitoring', logging: 'Logging', tracing: 'Tracing', secrets: 'Secrets', auth: 'Identity', email: 'Email',
}
export const CAPABILITIES = Object.keys(CAPABILITY_LABEL) as Capability[]
