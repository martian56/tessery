import { block, nested, raw, resource, type Body } from './hcl'
import type { Generated, NodeCtx, TfProvider } from './types'

/** App Platform names regions without the datacenter number: fra1 becomes fra. */
const APP_REGION = 'replace(var.region, "/[0-9]+$/", "")'

function appImage(c: NodeCtx): Body {
  if (c.tech.image === 'build') return { registry_type: 'GHCR', registry: raw('trimprefix(var.image_registry, "ghcr.io/")'), repository: c.node.name, tag: raw('var.image_tag') }
  const [path, tag = 'latest'] = (c.tech.image ?? 'nginx:stable').split(':')
  const [registry, ...rest] = path.includes('/') ? path.split('/') : ['library', path]
  return { registry_type: 'DOCKER_HUB', registry, repository: rest.join('/') || path, tag }
}

function database(engine: string, version: string, size: string, nodes: number): (c: NodeCtx) => Generated {
  return (c) => {
    c.use('vpc')
    return {
      hcl: resource('digitalocean_database_cluster', c.id, {
        name: c.name, engine, version, size, region: c.region, node_count: nodes,
        private_network_uuid: raw('digitalocean_vpc.this.id'),
        tags: [c.prefix],
      }),
      outputs: { [`${c.id}_uri`]: { value: `digitalocean_database_cluster.${c.id}.private_uri`, description: `Connection string for ${c.node.name} inside the VPC`, sensitive: true } },
    }
  }
}

function droplet(c: NodeCtx, size: string, image: string): Generated {
  c.use('vpc')
  c.use('ssh_key')
  return {
    hcl: resource('digitalocean_droplet', c.id, {
      name: c.name, size, image, region: c.region,
      vpc_uuid: raw('digitalocean_vpc.this.id'),
      ssh_keys: [raw('digitalocean_ssh_key.this.fingerprint')],
      user_data: c.cloudInit ? raw(`file("${c.cloudInit}")`) : undefined,
      tags: [c.prefix],
    }),
    outputs: { [`${c.id}_ip`]: { value: `digitalocean_droplet.${c.id}.ipv4_address`, description: `Public IPv4 address of ${c.node.name}` } },
  }
}

export const digitalocean: TfProvider = {
  id: 'digitalocean',
  name: 'DigitalOcean',
  local: 'digitalocean',
  source: 'digitalocean/digitalocean',
  version: '~> 2.109',
  variables: [
    block('variable', ['do_token'], { type: raw('string'), sensitive: true, description: 'DigitalOcean API token with write access.' }),
    block('variable', ['spaces_access_id'], { type: raw('string'), default: raw('null'), description: 'Spaces access key, needed for buckets.' }),
    block('variable', ['spaces_secret_key'], { type: raw('string'), default: raw('null'), sensitive: true, description: 'Spaces secret key, needed for buckets.' }),
    block('variable', ['ssh_public_key'], { type: raw('string'), default: raw('null'), description: 'Public key allowed to log in to the Droplets as root.' }),
  ].join('\n'),
  provider: block('provider', ['digitalocean'], { token: raw('var.do_token'), spaces_access_id: raw('var.spaces_access_id'), spaces_secret_key: raw('var.spaces_secret_key') }),
  shared: {
    vpc: (c) => ({ hcl: resource('digitalocean_vpc', 'this', { name: c.prefix, region: raw('var.region') }) }),
    ssh_key: (c) => ({ hcl: resource('digitalocean_ssh_key', 'this', { name: c.prefix, public_key: raw('var.ssh_public_key') }) }),
    domain: () => ({ hcl: '', variables: block('variable', ['domain'], { type: raw('string'), description: 'Domain DigitalOcean hosts the DNS for, like example.com.' }) }),
    alert_email: () => ({ hcl: '', variables: block('variable', ['alert_email'], { type: raw('string'), description: 'Address that gets monitoring alerts.' }) }),
  },
  vm: (c) => droplet(c, c.plan, 'ubuntu-24-04-x64'),
  managed: {
    container: (c) => {
      const component: Body = { name: c.node.name, instance_count: c.replicas, instance_size_slug: 'apps-s-1vcpu-1gb', image: nested(appImage(c)) }
      const web = c.port !== undefined && ['service', 'workflow'].includes(c.tech.id)
      return {
        hcl: resource('digitalocean_app', c.id, {
          spec: nested({
            name: c.name.slice(0, 32).replace(/-+$/, ''),
            region: raw(APP_REGION),
            ...(web ? { service: nested({ ...component, http_port: c.port }) } : { worker: nested(component) }),
          }),
        }),
        outputs: web ? { [`${c.id}_url`]: { value: `digitalocean_app.${c.id}.live_url`, description: `Public URL of ${c.node.name}` } } : undefined,
      }
    },
    kubernetes: (c) => ({
      hcl: [
        `data "digitalocean_kubernetes_versions" "${c.id}" {}\n`,
        resource('digitalocean_kubernetes_cluster', c.id, {
          name: c.name, region: c.region, version: raw(`data.digitalocean_kubernetes_versions.${c.id}.latest_version`),
          node_pool: nested({ name: 'default', size: 's-2vcpu-4gb', node_count: Math.max(2, c.replicas) }),
        }),
      ].join('\n'),
      outputs: { [`${c.id}_kubeconfig`]: { value: `digitalocean_kubernetes_cluster.${c.id}.kube_config[0].raw_config`, description: `Kubeconfig for ${c.node.name}`, sensitive: true } },
    }),
    postgres: (c) => database('pg', ['13', '14', '15', '16', '17'].includes(c.version ?? '') ? c.version! : '17', 'db-s-1vcpu-1gb', 1)(c),
    mysql: database('mysql', '8', 'db-s-1vcpu-1gb', 1),
    mongodb: database('mongodb', '8', 'db-s-1vcpu-1gb', 1),
    redis: database('valkey', '8', 'db-s-1vcpu-1gb', 1),
    kafka: database('kafka', '3.8', 'db-s-2vcpu-2gb', 3),
    search: database('opensearch', '2', 'db-s-1vcpu-2gb', 1),
    'object-storage': (c) => ({
      hcl: resource('digitalocean_spaces_bucket', c.id, { name: c.name, region: c.region }),
      outputs: { [`${c.id}_endpoint`]: { value: `digitalocean_spaces_bucket.${c.id}.bucket_domain_name`, description: `Endpoint of the ${c.node.name} bucket` } },
    }),
    'block-storage': (c) => ({
      hcl: resource('digitalocean_volume', c.id, { name: c.name, region: c.region, size: c.storageGb, initial_filesystem_type: 'ext4' }),
    }),
    cdn: (c) => ({
      hcl: resource('digitalocean_cdn', c.id, { origin: raw(`var.${c.id}_origin`) }),
      variables: block('variable', [`${c.id}_origin`], { type: raw('string'), description: `Spaces bucket domain ${c.node.name} serves, like assets.fra1.digitaloceanspaces.com.` }),
      outputs: { [`${c.id}_endpoint`]: { value: `digitalocean_cdn.${c.id}.endpoint`, description: `CDN address of ${c.node.name}` } },
    }),
    'load-balancer': (c) => {
      c.use('vpc')
      return {
        hcl: resource('digitalocean_loadbalancer', c.id, {
          name: c.name, region: c.region, vpc_uuid: raw('digitalocean_vpc.this.id'), droplet_tag: c.prefix,
          forwarding_rule: nested({ entry_port: 80, entry_protocol: 'http', target_port: c.port ?? 80, target_protocol: 'http' }),
        }),
        outputs: { [`${c.id}_ip`]: { value: `digitalocean_loadbalancer.${c.id}.ip`, description: `Public IP of ${c.node.name}` } },
      }
    },
    dns: (c) => (c.use('domain'), { hcl: resource('digitalocean_domain', c.id, { name: raw('var.domain') }) }),
    monitoring: (c) => (c.use('alert_email'), {
      hcl: resource('digitalocean_monitor_alert', c.id, {
        description: `${c.prefix}: CPU above 80%`, type: 'v1/insights/droplet/cpu', compare: 'GreaterThan', value: 80, window: '5m', tags: [c.prefix],
        alerts: nested({ email: [raw('var.alert_email')] }),
      }),
    }),
    gpu: (c) => droplet(c, 'gpu-h100x1-80gb', 'gpu-h100x1-base'),
    llm: (c) => ({ hcl: '', outputs: { [`${c.id}_endpoint`]: { value: '"https://inference.do-ai.run/v1"', description: `Serverless inference endpoint for ${c.node.name}. Create a model access key in the control panel` } } }),
    serverless: 'DigitalOcean Functions deploy from a git repository, which this Terraform doesn\'t set up. Run it on App Platform instead',
  },
}
