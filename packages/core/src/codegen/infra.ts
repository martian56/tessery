import type { SystemNode, Environment, ProjectDoc } from '../domain/types'
import { TECH_BY_ID } from '../catalog/technologies'
import { localPorts, workloads } from './deploy/runtime'
import { slug } from './deploy/compose'
import { PROVIDER_BY_ID } from '../catalog/providers'
import { checkPlacement, effectivePlacement, fitPlan } from '../catalog/placement'

const tf = (s: string) => s.replace(/-/g, '_')
const isWorkload = (n: SystemNode) => { const t = TECH_BY_ID[n.techId]; return t.category !== 'client' && !t.saas && !!t.image }

const TF_PROVIDER: Record<string, string> = {
  aws: 'hashicorp/aws', gcp: 'hashicorp/google', azure: 'hashicorp/azurerm', hetzner: 'hetznercloud/hcloud', digitalocean: 'digitalocean/digitalocean',
  linode: 'linode/linode', vultr: 'vultr/vultr', ovh: 'ovh/ovh', scaleway: 'scaleway/scaleway', oracle: 'oracle/oci', cloudflare: 'cloudflare/cloudflare', vercel: 'vercel/vercel', fly: 'fly-apps/fly', contabo: 'contabo/contabo',
}
function managedResource(n: SystemNode, pid: string, product: string, region: string): string {
  const name = tf(n.name), t = n.techId
  const T: Record<string, Record<string, string>> = {
    aws: { postgres: `module "${name}" {\n  source         = "terraform-aws-modules/rds/aws"\n  engine         = "postgres"\n  engine_version = "${n.config.version ?? '17'}"\n  multi_az       = ${!!n.config.highAvailability}\n  allocated_storage = ${n.config.storageGb ?? 20}\n}`, redis: `resource "aws_elasticache_replication_group" "${name}" {\n  engine = "valkey"\n  node_type = "cache.t4g.small"\n}`, kafka: `resource "aws_msk_cluster" "${name}" {\n  kafka_version = "3.9.x"\n  number_of_broker_nodes = ${n.config.brokers ?? 3}\n}`, 'object-storage': `resource "aws_s3_bucket" "${name}" {\n  bucket = "${n.config.bucket ?? n.name}"\n}`, queue: `resource "aws_sqs_queue" "${name}" {\n  name = "${n.name}"\n}`, service: `resource "aws_ecs_service" "${name}" {\n  name          = "${n.name}"\n  desired_count = ${n.replicas}\n  launch_type   = "FARGATE"\n}` },
    gcp: { postgres: `resource "google_sql_database_instance" "${name}" {\n  database_version = "POSTGRES_${n.config.version ?? '17'}"\n  region = "${region}"\n}`, redis: `resource "google_redis_instance" "${name}" {\n  memory_size_gb = 1\n  region = "${region}"\n}`, 'object-storage': `resource "google_storage_bucket" "${name}" {\n  name = "${n.config.bucket ?? n.name}"\n  location = "${region}"\n}`, queue: `resource "google_cloud_tasks_queue" "${name}" {\n  location = "${region}"\n}`, service: `resource "google_cloud_run_v2_service" "${name}" {\n  name = "${n.name}"\n  location = "${region}"\n  template { scaling { min_instance_count = ${n.replicas} } }\n}` },
    azure: { postgres: `resource "azurerm_postgresql_flexible_server" "${name}" {\n  version = "${n.config.version ?? '16'}"\n  location = "${region}"\n}`, redis: `resource "azurerm_redis_cache" "${name}" {\n  location = "${region}"\n  sku_name = "Standard"\n}`, service: `resource "azurerm_container_app" "${name}" {\n  name = "${n.name}"\n}` },
    digitalocean: { postgres: `resource "digitalocean_database_cluster" "${name}" {\n  engine = "pg"\n  version = "${n.config.version ?? '17'}"\n  region = "${region}"\n  size = "db-s-1vcpu-1gb"\n  node_count = ${n.config.highAvailability ? 2 : 1}\n}`, redis: `resource "digitalocean_database_cluster" "${name}" {\n  engine = "valkey"\n  region = "${region}"\n  size = "db-s-1vcpu-1gb"\n  node_count = 1\n}`, 'object-storage': `resource "digitalocean_spaces_bucket" "${name}" {\n  name = "${n.config.bucket ?? n.name}"\n  region = "${region}"\n}`, service: `resource "digitalocean_app" "${name}" {\n  spec { name = "${n.name}"\n    region = "${region}" }\n}` },
    hetzner: { 'load-balancer': `resource "hcloud_load_balancer" "${name}" {\n  load_balancer_type = "lb11"\n  location = "${region}"\n}`, 'object-storage': `# Hetzner Object Storage bucket "${n.config.bucket ?? n.name}" (S3 API) in ${region}` },
  }
  const key = TECH_BY_ID[t].category === 'compute' && t !== 'function' ? 'service' : t
  return T[pid]?.[key] ?? `# ${n.name}: ${product} (${PROVIDER_BY_ID[pid]?.name}, ${region})\nresource "null_resource" "${name}" {}`
}
function vmResource(n: SystemNode, pid: string, region: string): string {
  const p = PROVIDER_BY_ID[pid]
  const plan = n.placement.planId ?? fitPlan(p, n, TECH_BY_ID[n.techId])?.id ?? 'small'
  const name = tf(n.name)
  const VM: Record<string, string> = {
    hetzner: `resource "hcloud_server" "${name}" {\n  name        = "${n.name}"\n  server_type = "${plan}"\n  image       = "ubuntu-24.04"\n  location    = "${region}"\n  user_data   = file("\${path.module}/cloud-init/${n.name}.yaml")\n}`,
    digitalocean: `resource "digitalocean_droplet" "${name}" {\n  name   = "${n.name}"\n  size   = "${plan}"\n  image  = "ubuntu-24-04-x64"\n  region = "${region}"\n  user_data = file("\${path.module}/cloud-init/${n.name}.yaml")\n}`,
    aws: `resource "aws_instance" "${name}" {\n  instance_type = "${plan}"\n  ami           = data.aws_ami.ubuntu.id\n  user_data     = file("\${path.module}/cloud-init/${n.name}.yaml")\n}`,
    vultr: `resource "vultr_instance" "${name}" {\n  plan = "${plan}"\n  region = "${region}"\n  os_id = 2284\n}`,
    linode: `resource "linode_instance" "${name}" {\n  type = "${plan}"\n  region = "${region}"\n  image = "linode/ubuntu24.04"\n}`,
    contabo: `resource "contabo_instance" "${name}" {\n  product_id = "${plan}"\n  region = "${region.toUpperCase()}"\n  image_id = "ubuntu-24.04"\n}`,
    scaleway: `resource "scaleway_instance_server" "${name}" {\n  type = "${plan}"\n  image = "ubuntu_noble"\n}`,
    ovh: `resource "ovh_cloud_project_instance" "${name}" {\n  flavor_name = "${plan}"\n  region = "${region.toUpperCase()}"\n}`,
  }
  return VM[pid] ?? `# ${n.name}: VM ${plan} at ${p.name} (${region}), provisioned with ansible/inventory.ini`
}

export function terraform(doc: ProjectDoc, env: Environment): Record<string, string> {
  const by = new Map<string, SystemNode[]>()
  doc.nodes.forEach((n) => { const pl = effectivePlacement(n, env); if (pl.mode === 'external' || pl.providerId === 'self' || pl.providerId === 'saas' || TECH_BY_ID[n.techId].category === 'client') return; if (!by.has(pl.providerId)) by.set(pl.providerId, []); by.get(pl.providerId)!.push(n) })
  const files: Record<string, string> = {}
  for (const [pid, nodes] of by) {
    const src = TF_PROVIDER[pid]
    const region = env.overrides[nodes[0].id]?.regionId ?? nodes[0].placement.regionId ?? PROVIDER_BY_ID[pid].regions[0].id
    const body = nodes.map((n) => { const pl = effectivePlacement(n, env); const c = checkPlacement(n, env); return pl.mode === 'self-hosted' ? vmResource(n, pid, pl.regionId ?? region) : managedResource(n, pid, c.product, pl.regionId ?? region) }).join('\n\n')
    files[`infra/${env.id}/${pid}/main.tf`] = `# ${env.name} on ${PROVIDER_BY_ID[pid].name}, sketched by Tessery from the design's placements.\n# A starting point, not a working configuration: add networking, credentials, sizing and the\n# provider settings before running tofu apply. Docker and Kubernetes targets need none of this.\nterraform {\n  required_providers {\n    ${pid} = { source = "${src ?? 'hashicorp/null'}" }\n  }\n  backend "s3" { key = "${doc.name}/${env.id}/${pid}.tfstate" }\n}\n\n${body}\n`
  }
  return files
}

export function vpsFiles(doc: ProjectDoc, env: Environment): Record<string, string> {
  const vms = doc.nodes.filter((n) => effectivePlacement(n, env).mode === 'self-hosted' && isWorkload(n))
  if (!vms.length) return {}
  const files: Record<string, string> = {}
  vms.forEach((n) => {
    const t = TECH_BY_ID[n.techId]
    files[`infra/${env.id}/cloud-init/${n.name}.yaml`] = `#cloud-config: ${n.name} (${t.name})\npackage_update: true\npackages: [docker.io, docker-compose-v2, fail2ban, unattended-upgrades]\nruncmd:\n  - ufw default deny incoming\n  - ufw allow 22/tcp${n.config.port ? `\n  - ufw allow from 10.0.0.0/8 to any port ${n.config.port}` : ''}\n  - ufw --force enable\n  - docker run -d --restart=always --name ${n.name} ${n.config.port ? `-p ${n.config.port}:${n.config.port} ` : ''}${t.image === 'build' ? `ghcr.io/${doc.name}/${n.name}:latest` : t.image}\n`
  })
  files[`infra/${env.id}/ansible/inventory.ini`] = Object.entries(vms.reduce<Record<string, SystemNode[]>>((a, n) => { const k = TECH_BY_ID[n.techId].category; (a[k] ??= []).push(n); return a }, {}))
    .map(([g, ns]) => `[${g}]\n${ns.map((n) => `${n.name} ansible_host=<${PROVIDER_BY_ID[effectivePlacement(n, env).providerId]?.name} IP>`).join('\n')}`).join('\n\n') + '\n'
  files[`infra/${env.id}/ansible/site.yml`] = `- hosts: all\n  become: true\n  roles: [common, docker, node_exporter, promtail]\n\n- hosts: data\n  become: true\n  roles: [backups]\n`
  return files
}

export function ciWorkflow(doc: ProjectDoc): string {
  const builds = workloads(doc).filter((w) => w.build).map((w) => ({ name: w.name, context: w.build! }))
  const branches = doc.environments.filter((e) => (e.target?.kind ?? 'git') === 'git').map((e) => `env/${e.id}`)
  return `# Generated by Tessery. Runs when Tessery releases a checkpoint to an environment that your CI deploys.
name: build
on:
  push:
    branches: [${branches.map((b) => JSON.stringify(b)).join(', ')}]
permissions:
  contents: read
  packages: write
jobs:
  images:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
${builds.map((b) => `          - { name: ${JSON.stringify(b.name)}, context: ${JSON.stringify(b.context)} }`).join('\n') || '          []'}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: \${{ github.actor }}, password: \${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with:
          context: \${{ matrix.context }}
          push: true
          tags: ghcr.io/\${{ github.repository_owner }}/${slug(doc.name)}-\${{ matrix.name }}:\${{ github.sha }}
  deploy:
    needs: images
    runs-on: ubuntu-latest
    environment: \${{ github.ref_name }}
    steps:
      - uses: actions/checkout@v4
      # Deploy the images tagged \${{ github.sha }} here, for example with the Compose or Kubernetes
      # files Tessery writes to deploy/<environment>/ when you switch the environment's target.
      - run: echo "deploy \${{ github.sha }} to \${{ github.ref_name }}"
`
}

export function otelConfig(doc: ProjectDoc): string {
  const o = doc.observability
  return `# otel-collector.yaml, generated by Tessery\nreceivers:\n  otlp: { protocols: { grpc: {}, http: {} } }\nprocessors:\n  batch: {}\n  probabilistic_sampler: { sampling_percentage: ${Math.round(o.sampling * 100)} }\nexporters:\n  prometheusremotewrite: { endpoint: "http://prometheus:9090/api/v1/write" }   # ${o.metrics}\n  loki: { endpoint: "http://loki:3100/loki/api/v1/push" }                     # ${o.logs}\n  otlp/traces: { endpoint: "tempo:4317", tls: { insecure: true } }              # ${o.traces}\nservice:\n  pipelines:\n    metrics: { receivers: [otlp], processors: [batch], exporters: [prometheusremotewrite] }\n    logs: { receivers: [otlp], processors: [batch], exporters: [loki] }\n    traces: { receivers: [otlp], processors: [probabilistic_sampler, batch], exporters: [otlp/traces] }\n`
}
export function alertRules(doc: ProjectDoc): string {
  const name = (id?: string) => doc.nodes.find((n) => n.id === id)?.name ?? 'all'
  return `# prometheus/alerts.yml, generated by Tessery\ngroups:\n  - name: ${doc.name}\n    rules:\n${doc.observability.alerts.filter((a) => a.enabled).map((a) => `      - alert: ${a.name.replace(/\W+/g, '')}\n        expr: ${a.expr.replace(/error_rate/g, `sum(rate(http_requests_total{service="${name(a.nodeId)}",code=~"5.."}[5m])) / sum(rate(http_requests_total{service="${name(a.nodeId)}"}[5m])) * 100`)}\n        labels: { severity: ${a.severity}, channel: "${a.channel}" }\n        annotations: { summary: "${a.name} on ${name(a.nodeId)}" }`).join('\n')}\n${doc.observability.slos.map((s) => `      - alert: SLOBurn_${s.name.replace(/\W+/g, '')}\n        expr: slo:error_budget_burn_rate:${s.window}{service="${name(s.nodeId)}"} > 14.4\n        labels: { severity: critical }\n        annotations: { summary: "Fast burn on SLO ${s.name} (target ${s.target}${s.metric === 'latency_p99' ? 'ms' : '%'})" }`).join('\n')}\n`
}

export function readme(doc: ProjectDoc): string {
  const containers = workloads(doc)
  const local = localPorts(doc)
  const ports = containers.filter((w) => w.port).map((w) => `| ${w.name} | ${TECH_BY_ID[w.node.techId].name} | http://localhost:${local.get(w.name)} |`).join('\n')
  const envs = doc.environments.map((e) => `- **${e.name}** (\`env/${e.id}\`): ${e.target?.kind === 'kubernetes' ? 'Kubernetes' : e.target?.kind === 'docker' ? `Docker${e.target.host ? ` on ${e.target.host}` : ''}` : 'your own CI deploys this branch'}${e.approval ? ', needs approval' : ''}`).join('\n')
  return `# ${doc.name}

${doc.description ? `${doc.description}\n\n` : ''}Designed and generated with Tessery.

## Run it locally

    docker compose up --build

Everything runs in containers, including databases and queues, so you need nothing but Docker.
Passwords default to \`dev\`; copy \`.env.example\` to \`.env\` to change them.

| Node | Technology | Address |
|---|---|---|
${ports || '| | | |'}

## Working with Tessery

- Push your code to \`main\`. Tessery never overwrites it: each checkpoint commits what the design
  generates to \`tessery/generated\` and merges that into \`main\`, so design changes reach your code
  and your changes survive regeneration.
- If a checkpoint reports a conflict, run \`git merge origin/tessery/generated\`, resolve it, push, and
  create the checkpoint again.
- Operations whose path names a table of a connected database (\`GET /orders\`, \`POST /orders\`,
  \`PATCH /orders/{id}\`...) are implemented already. The rest return 501 until you write them; the
  designed steps are in comments above each handler.
- Database schema scripts in \`services/*/migrations\` only add tables, columns and indexes, and run
  on every service start.

## Environments

Checkpoints move through these in order, each one only accepting what the previous one runs:

${envs}
`
}
