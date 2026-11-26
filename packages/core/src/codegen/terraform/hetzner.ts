import { block, nested, raw, resource } from './hcl'
import type { NodeCtx, TfProvider } from './types'

const NETWORK_ZONE = 'lookup({ fsn1 = "eu-central", nbg1 = "eu-central", hel1 = "eu-central", ash = "us-east", hil = "us-west", sin = "ap-southeast" }, var.region, "eu-central")'

/** Object Storage runs in fsn1, nbg1 and hel1; other locations use Falkenstein. */
const OBJECT_LOCATION = 'contains(["fsn1", "nbg1", "hel1"], var.region) ? var.region : "fsn1"'

const server =(c: NodeCtx, serverType: string) => ({
  hcl: resource('hcloud_server', c.id, {
    name: c.name,
    server_type: serverType,
    image: 'ubuntu-24.04',
    location: c.region,
    ssh_keys: [raw('hcloud_ssh_key.this.id')],
    user_data: c.cloudInit ? raw(`file("${c.cloudInit}")`) : undefined,
    labels: { project: c.prefix },
    network: nested({ network_id: raw('hcloud_network.this.id') }),
    depends_on: [raw('hcloud_network_subnet.this')],
  }),
  outputs: { [`${c.id}_ip`]: { value: `hcloud_server.${c.id}.ipv4_address`, description: `Public IPv4 address of ${c.node.name}` } },
})

export const hetzner: TfProvider = {
  id: 'hetzner',
  name: 'Hetzner',
  local: 'hcloud',
  source: 'hetznercloud/hcloud',
  version: '~> 1.70',
  variables: [
    block('variable', ['hcloud_token'], { type: raw('string'), sensitive: true, description: 'API token of the Hetzner Cloud project, with read and write access.' }),
    block('variable', ['ssh_public_key'], { type: raw('string'), description: 'Public key allowed to log in to the servers as root.' }),
  ].join('\n'),
  provider: block('provider', ['hcloud'], { token: raw('var.hcloud_token') }),
  shared: {
    network: (c) => ({
      hcl: [
        resource('hcloud_network', 'this', { name: c.prefix, ip_range: '10.0.0.0/16', labels: { project: c.prefix } }),
        resource('hcloud_network_subnet', 'this', { network_id: raw('hcloud_network.this.id'), type: 'cloud', network_zone: raw(NETWORK_ZONE), ip_range: '10.0.1.0/24' }),
      ].join('\n'),
    }),
    ssh_key: (c) => ({ hcl: resource('hcloud_ssh_key', 'this', { name: c.prefix, public_key: raw('var.ssh_public_key') }) }),
    s3: () => ({
      hcl: block('provider', ['aws'], {
        region: raw('var.region'),
        access_key: raw('var.s3_access_key'),
        secret_key: raw('var.s3_secret_key'),
        s3_use_path_style: true,
        skip_credentials_validation: true,
        skip_region_validation: true,
        skip_requesting_account_id: true,
        skip_metadata_api_check: true,
        endpoints: nested({ s3: raw(`"https://\${${OBJECT_LOCATION}}.your-objectstorage.com"`) }),
      }),
      variables: [
        block('variable', ['s3_access_key'], { type: raw('string'), description: 'Object Storage access key, created in the Hetzner console.' }),
        block('variable', ['s3_secret_key'], { type: raw('string'), sensitive: true, description: 'Object Storage secret key.' }),
      ].join('\n'),
      requires: { aws: { source: 'hashicorp/aws', version: '~> 6.74' } },
    }),
    domain: () => ({ hcl: '', variables: block('variable', ['domain'], { type: raw('string'), description: 'Domain whose DNS zone Hetzner hosts, like example.com.' }) }),
  },
  vm: (c) => {
    c.use('network')
    c.use('ssh_key')
    return server(c, c.plan)
  },
  managed: {
    'load-balancer': (c) => {
      c.use('network')
      return {
        hcl: [
          resource('hcloud_load_balancer', c.id, { name: c.name, load_balancer_type: 'lb11', location: c.region, labels: { project: c.prefix } }),
          resource('hcloud_load_balancer_network', c.id, { load_balancer_id: raw(`hcloud_load_balancer.${c.id}.id`), network_id: raw('hcloud_network.this.id'), depends_on: [raw('hcloud_network_subnet.this')] }),
          resource('hcloud_load_balancer_service', c.id, { load_balancer_id: raw(`hcloud_load_balancer.${c.id}.id`), protocol: 'http', listen_port: 80, destination_port: c.port ?? 80 }),
          resource('hcloud_load_balancer_target', c.id, { load_balancer_id: raw(`hcloud_load_balancer.${c.id}.id`), type: 'label_selector', label_selector: `project=${c.prefix}`, use_private_ip: true, depends_on: [raw(`hcloud_load_balancer_network.${c.id}`)] }),
        ].join('\n'),
        outputs: { [`${c.id}_ip`]: { value: `hcloud_load_balancer.${c.id}.ipv4`, description: `Public IPv4 address of ${c.node.name}` } },
      }
    },
    dns: (c) => (c.use('domain'), {
      hcl: resource('hcloud_zone', c.id, { name: raw('var.domain'), mode: 'primary' }),
      outputs: { [`${c.id}_name_servers`]: { value: `hcloud_zone.${c.id}.authoritative_nameservers.assigned`, description: 'Name servers to set at your registrar' } },
    }),
    'block-storage': (c) => ({
      hcl: resource('hcloud_volume', c.id, { name: c.name, size: Math.max(10, c.storageGb), location: c.region, format: 'ext4' }),
      outputs: { [`${c.id}_device`]: { value: `hcloud_volume.${c.id}.linux_device`, description: `Device path of ${c.node.name} once attached` } },
    }),
    // Object Storage speaks the S3 API, so the AWS provider pointed at Hetzner's endpoint creates the buckets.
    'object-storage': (c) => (c.use('s3'), {
      hcl: resource('aws_s3_bucket', c.id, { bucket: c.name }),
      outputs: { [`${c.id}_endpoint`]: { value: `"https://\${${OBJECT_LOCATION}}.your-objectstorage.com/\${aws_s3_bucket.${c.id}.bucket}"`, description: `Address of the ${c.node.name} bucket` } },
    }),
    gpu: 'the GEX44 is a dedicated server ordered through Hetzner Robot, which Terraform can\'t do. Self-host it on a cloud server or use a provider with cloud GPUs',
  },
}
