import { block, nested, raw, resource, type Body } from './hcl'
import type { Generated, NodeCtx, Output, TfProvider } from './types'

const GROUP = raw('azurerm_resource_group.this.name')

/** Short hash of the subscription, appended to names that must be unique across all of Azure. */
const SUFFIX = 'substr(sha1(var.subscription_id), 0, 6)'

/** Lowercase letters and digits only, capped at `max` characters including the suffix. */
const compact = (c: NodeCtx, max: number) => raw(`"${c.name.replace(/-/g, '').slice(0, max - 6)}\${${SUFFIX}}"`)
const capped = (c: NodeCtx, max: number) => c.name.slice(0, max).replace(/-+$/, '')

function placed(c: NodeCtx): Body {
  c.use('group')
  return { resource_group_name: GROUP, location: c.region }
}

const vmSize = (plan: string) => (plan.startsWith('Standard_') ? plan : `Standard_${plan}`)

function vm(c: NodeCtx, size: string): Generated {
  c.use('network')
  c.use('ssh_key')
  const at = placed(c)
  return {
    hcl: [
      resource('azurerm_public_ip', c.id, { name: c.name, ...at, allocation_method: 'Static', sku: 'Standard' }),
      resource('azurerm_network_interface', c.id, {
        name: c.name, ...at,
        ip_configuration: nested({ name: 'primary', subnet_id: raw('azurerm_subnet.this.id'), private_ip_address_allocation: 'Dynamic', public_ip_address_id: raw(`azurerm_public_ip.${c.id}.id`) }),
      }),
      resource('azurerm_linux_virtual_machine', c.id, {
        name: c.name, ...at, size,
        admin_username: 'azureuser',
        network_interface_ids: [raw(`azurerm_network_interface.${c.id}.id`)],
        custom_data: c.cloudInit ? raw(`filebase64("${c.cloudInit}")`) : undefined,
        admin_ssh_key: nested({ username: 'azureuser', public_key: raw('var.ssh_public_key') }),
        os_disk: nested({ caching: 'ReadWrite', storage_account_type: 'StandardSSD_LRS' }),
        source_image_reference: nested({ publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }),
      }),
    ].join('\n'),
    outputs: { [`${c.id}_ip`]: { value: `azurerm_public_ip.${c.id}.ip_address`, description: `Public IPv4 address of ${c.node.name}` } },
  }
}

const password = (c: NodeCtx) => resource('random_password', c.id, { length: 32, special: false, min_upper: 1, min_lower: 1, min_numeric: 1 })

function postgres(settings: Record<string, string> = {}): (c: NodeCtx) => Generated {
  return (c) => {
    const version = ['13', '14', '15', '16', '17'].includes(c.version ?? '') ? c.version! : '17'
    const server = `azurerm_postgresql_flexible_server.${c.id}`
    return {
      hcl: [
        password(c),
        resource('azurerm_postgresql_flexible_server', c.id, {
          name: c.name, ...placed(c), version,
          sku_name: 'B_Standard_B1ms',
          storage_mb: 32768,
          administrator_login: 'tessery',
          administrator_password: raw(`random_password.${c.id}.result`),
          public_network_access_enabled: true,
          backup_retention_days: 7,
        }),
        resource('azurerm_postgresql_flexible_server_firewall_rule', c.id, { name: 'azure-services', server_id: raw(`${server}.id`), start_ip_address: '0.0.0.0', end_ip_address: '0.0.0.0' }),
        ...Object.entries(settings).map(([name, value]) => resource('azurerm_postgresql_flexible_server_configuration', `${c.id}_${name.replace(/\W/g, '_')}`, { name, server_id: raw(`${server}.id`), value })),
      ].join('\n'),
      outputs: { [`${c.id}_uri`]: { value: `"postgresql://tessery:\${random_password.${c.id}.result}@\${${server}.fqdn}:5432/postgres?sslmode=require"`, description: `Connection string for ${c.node.name}`, sensitive: true } },
      random: true,
    }
  }
}

function cosmos(capability: string, outputs: (c: NodeCtx, account: string) => Record<string, Output>): (c: NodeCtx) => Generated {
  return (c) => {
    const mongo = capability === 'EnableMongo'
    return {
      hcl: resource('azurerm_cosmosdb_account', c.id, {
        name: capped(c, 44), ...placed(c),
        offer_type: 'Standard',
        kind: mongo ? 'MongoDB' : 'GlobalDocumentDB',
        mongo_server_version: mongo ? '7.0' : undefined,
        capabilities: [nested({ name: capability }), nested({ name: 'EnableServerless' })],
        consistency_policy: nested({ consistency_level: 'Session' }),
        geo_location: nested({ location: c.region, failover_priority: 0 }),
      }),
      outputs: outputs(c, `azurerm_cosmosdb_account.${c.id}`),
    }
  }
}

function search(c: NodeCtx): Generated {
  return {
    hcl: resource('azurerm_search_service', c.id, { name: c.name, ...placed(c), sku: 'basic' }),
    outputs: {
      [`${c.id}_endpoint`]: { value: `azurerm_search_service.${c.id}.endpoint`, description: `Endpoint of ${c.node.name}` },
      [`${c.id}_key`]: { value: `azurerm_search_service.${c.id}.primary_key`, description: `Admin key for ${c.node.name}`, sensitive: true },
    },
  }
}

function eventHubs(c: NodeCtx): Generated {
  const ns = `azurerm_eventhub_namespace.${c.id}`
  return {
    hcl: [
      resource('azurerm_eventhub_namespace', c.id, { name: c.name, ...placed(c), sku: 'Standard', capacity: 1 }),
      resource('azurerm_eventhub', c.id, { name: 'events', namespace_id: raw(`${ns}.id`), partition_count: 2, message_retention: 1 }),
    ].join('\n'),
    outputs: {
      [`${c.id}_bootstrap`]: { value: `"\${${ns}.name}.servicebus.windows.net:9093"`, description: `Kafka bootstrap server of ${c.node.name}` },
      [`${c.id}_connection_string`]: { value: `${ns}.default_primary_connection_string`, description: `Connection string for ${c.node.name}, also the SASL password for Kafka clients`, sensitive: true },
    },
  }
}

function insights(c: NodeCtx): Generated {
  c.use('workspace')
  return {
    hcl: resource('azurerm_application_insights', c.id, { name: c.name, ...placed(c), application_type: 'web', workspace_id: raw('azurerm_log_analytics_workspace.this.id') }),
    outputs: { [`${c.id}_connection_string`]: { value: `azurerm_application_insights.${c.id}.connection_string`, description: `Connection string ${c.node.name} sends telemetry with`, sensitive: true } },
  }
}

/** A Front Door profile with one endpoint that forwards everything to the origin in var.<id>_origin. */
function frontDoor(c: NodeCtx, sku: 'Standard' | 'Premium', extra: string[] = []): Generated {
  c.use('group')
  const profile = raw(`azurerm_cdn_frontdoor_profile.${c.id}.id`)
  return {
    hcl: [
      resource('azurerm_cdn_frontdoor_profile', c.id, { name: c.name, resource_group_name: GROUP, sku_name: `${sku}_AzureFrontDoor` }),
      resource('azurerm_cdn_frontdoor_endpoint', c.id, { name: capped(c, 46), cdn_frontdoor_profile_id: profile }),
      resource('azurerm_cdn_frontdoor_origin_group', c.id, { name: 'origin', cdn_frontdoor_profile_id: profile, load_balancing: nested({}) }),
      resource('azurerm_cdn_frontdoor_origin', c.id, {
        name: 'origin',
        cdn_frontdoor_origin_group_id: raw(`azurerm_cdn_frontdoor_origin_group.${c.id}.id`),
        host_name: raw(`var.${c.id}_origin`),
        origin_host_header: raw(`var.${c.id}_origin`),
        certificate_name_check_enabled: true,
      }),
      resource('azurerm_cdn_frontdoor_route', c.id, {
        name: 'default',
        cdn_frontdoor_endpoint_id: raw(`azurerm_cdn_frontdoor_endpoint.${c.id}.id`),
        cdn_frontdoor_origin_group_id: raw(`azurerm_cdn_frontdoor_origin_group.${c.id}.id`),
        cdn_frontdoor_origin_ids: [raw(`azurerm_cdn_frontdoor_origin.${c.id}.id`)],
        patterns_to_match: ['/*'],
        supported_protocols: ['Http', 'Https'],
        forwarding_protocol: 'HttpsOnly',
        https_redirect_enabled: true,
        link_to_default_domain: true,
      }),
      ...extra,
    ].join('\n'),
    variables: block('variable', [`${c.id}_origin`], { type: raw('string'), description: `Host name ${c.node.name} forwards to, like app.example.com.` }),
    outputs: { [`${c.id}_host`]: { value: `azurerm_cdn_frontdoor_endpoint.${c.id}.host_name`, description: `Front Door address of ${c.node.name}` } },
  }
}

/** Flex Consumption runtime for the function's runtime setting, like node22 or python3.13. */
function functionRuntime(runtime: string): [string, string] {
  const [, name = 'node', version = ''] = /^([a-z]+)([\d.]*)$/.exec(runtime) ?? []
  if (name === 'node') return ['node', version || '22']
  if (name === 'python') return ['python', version || '3.12']
  if (name === 'java') return ['java', version || '21']
  if (name === 'dotnet') return ['dotnet-isolated', `${version || '9'}.0`]
  return ['custom', '1.0']
}

const seconds = (s: string) => {
  const m = /^(\d+)\s*([smh]?)$/.exec(s.trim())
  return m ? Number(m[1]) * { s: 1, m: 60, h: 3600 }[(m[2] || 's') as 's' | 'm' | 'h'] : 900
}

/** Where Communication Services keeps its data, by region. */
const DATA_LOCATION = '{ eastus = "United States", eastus2 = "United States", westus3 = "United States", centralus = "United States", westeurope = "Europe", northeurope = "Europe", germanywestcentral = "Germany", francecentral = "France", uksouth = "UK", southeastasia = "Asia Pacific", japaneast = "Japan", brazilsouth = "Brazil", uaenorth = "UAE", australiaeast = "Australia" }'

export const azure: TfProvider = {
  id: 'azure',
  name: 'Azure',
  local: 'azurerm',
  source: 'hashicorp/azurerm',
  version: '~> 5.15',
  variables: [
    block('variable', ['subscription_id'], { type: raw('string'), description: 'Azure subscription to create everything in.' }),
    block('variable', ['tenant_id'], { type: raw('string'), default: raw('null'), description: 'Entra tenant of the service principal. Leave empty to use the Azure CLI login.' }),
    block('variable', ['client_id'], { type: raw('string'), default: raw('null'), description: 'Client ID of the service principal. Leave empty to use the Azure CLI login.' }),
    block('variable', ['client_secret'], { type: raw('string'), default: raw('null'), sensitive: true, description: 'Client secret of the service principal.' }),
  ].join('\n'),
  provider: block('provider', ['azurerm'], {
    subscription_id: raw('var.subscription_id'),
    tenant_id: raw('var.tenant_id'),
    client_id: raw('var.client_id'),
    client_secret: raw('var.client_secret'),
    features: nested({}),
  }),
  shared: {
    group: (c) => ({ hcl: resource('azurerm_resource_group', 'this', { name: c.prefix, location: raw('var.region'), tags: { project: c.prefix } }) }),
    network: (c) => ({
      hcl: [
        resource('azurerm_virtual_network', 'this', { name: c.prefix, resource_group_name: GROUP, location: raw('var.region'), address_space: ['10.0.0.0/16'] }),
        resource('azurerm_subnet', 'this', { name: 'servers', resource_group_name: GROUP, virtual_network_name: raw('azurerm_virtual_network.this.name'), address_prefixes: ['10.0.1.0/24'] }),
        resource('azurerm_network_security_group', 'this', { name: c.prefix, resource_group_name: GROUP, location: raw('var.region') }),
        ...([['ssh', '22', 100], ['http', '80', 110], ['https', '443', 120]] as const).map(([name, port, priority]) => resource('azurerm_network_security_rule', name, {
          name, resource_group_name: GROUP, network_security_group_name: raw('azurerm_network_security_group.this.name'),
          priority, direction: 'Inbound', access: 'Allow', protocol: 'Tcp',
          source_address_prefix: '*', source_port_range: '*', destination_address_prefix: '*', destination_port_range: port,
        })),
        resource('azurerm_subnet_network_security_group_association', 'this', { subnet_id: raw('azurerm_subnet.this.id'), network_security_group_id: raw('azurerm_network_security_group.this.id') }),
      ].join('\n'),
    }),
    ssh_key: () => ({ hcl: '', variables: block('variable', ['ssh_public_key'], { type: raw('string'), description: 'Public key allowed to log in to the virtual machines as azureuser.' }) }),
    workspace: (c) => ({
      hcl: resource('azurerm_log_analytics_workspace', 'this', { name: c.prefix, resource_group_name: GROUP, location: raw('var.region'), sku: 'PerGB2018', retention_in_days: 30 }),
    }),
    apps: (c) => ({
      hcl: resource('azurerm_container_app_environment', 'this', { name: c.prefix, resource_group_name: GROUP, location: raw('var.region'), log_analytics_workspace_id: raw('azurerm_log_analytics_workspace.this.id') }),
    }),
    client: () => ({ hcl: 'data "azurerm_client_config" "current" {}\n' }),
    domain: () => ({ hcl: '', variables: block('variable', ['domain'], { type: raw('string'), description: 'Domain whose DNS zone Azure hosts, like example.com.' }) }),
    publisher_email: () => ({ hcl: '', variables: block('variable', ['publisher_email'], { type: raw('string'), description: 'Address API Management sends its notifications to.' }) }),
  },
  vm: (c) => vm(c, vmSize(c.plan)),
  managed: {
    'api-gateway': (c) => (c.use('publisher_email'), {
      hcl: resource('azurerm_api_management', c.id, { name: c.name, ...placed(c), sku_name: 'Consumption_0', publisher_name: c.doc.name, publisher_email: raw('var.publisher_email') }),
      outputs: { [`${c.id}_url`]: { value: `azurerm_api_management.${c.id}.gateway_url`, description: `Gateway URL of ${c.node.name}` } },
    }),
    'load-balancer': (c) => {
      const at = placed(c)
      const lb = `azurerm_lb.${c.id}`
      return {
        hcl: [
          resource('azurerm_public_ip', c.id, { name: c.name, ...at, allocation_method: 'Static', sku: 'Standard' }),
          resource('azurerm_lb', c.id, {
            name: c.name, ...at, sku: 'Standard',
            frontend_ip_configuration: nested({ name: 'public', public_ip_address_id: raw(`azurerm_public_ip.${c.id}.id`) }),
          }),
          resource('azurerm_lb_backend_address_pool', c.id, { name: 'servers', loadbalancer_id: raw(`${lb}.id`) }),
          resource('azurerm_lb_probe', c.id, { name: 'http', loadbalancer_id: raw(`${lb}.id`), protocol: 'Tcp', port: c.port ?? 80 }),
          resource('azurerm_lb_rule', c.id, {
            name: 'http', loadbalancer_id: raw(`${lb}.id`), protocol: 'Tcp', frontend_port: 80, backend_port: c.port ?? 80,
            frontend_ip_configuration_name: 'public',
            backend_address_pool_ids: [raw(`azurerm_lb_backend_address_pool.${c.id}.id`)],
            probe_id: raw(`azurerm_lb_probe.${c.id}.id`),
          }),
        ].join('\n'),
        outputs: {
          [`${c.id}_ip`]: { value: `azurerm_public_ip.${c.id}.ip_address`, description: `Public IP of ${c.node.name}` },
          [`${c.id}_pool_id`]: { value: `azurerm_lb_backend_address_pool.${c.id}.id`, description: `Backend pool of ${c.node.name}. Add the servers' network interfaces to it` },
        },
      }
    },
    cdn: (c) => frontDoor(c, 'Standard'),
    waf: (c) => frontDoor(c, 'Premium', [
      resource('azurerm_cdn_frontdoor_firewall_policy', c.id, {
        name: c.name.replace(/-/g, ''), resource_group_name: GROUP, sku_name: 'Premium_AzureFrontDoor', mode: 'Prevention',
        managed_rule: [
          nested({ type: 'Microsoft_DefaultRuleSet', version: '2.1', action: 'Block' }),
          nested({ type: 'Microsoft_BotManagerRuleSet', version: '1.1', action: 'Block' }),
        ],
      }),
      resource('azurerm_cdn_frontdoor_security_policy', c.id, {
        name: c.name, cdn_frontdoor_profile_id: raw(`azurerm_cdn_frontdoor_profile.${c.id}.id`),
        security_policies: nested({
          firewall: nested({
            cdn_frontdoor_firewall_policy_id: raw(`azurerm_cdn_frontdoor_firewall_policy.${c.id}.id`),
            association: nested({ patterns_to_match: ['/*'], domain: nested({ cdn_frontdoor_domain_id: raw(`azurerm_cdn_frontdoor_endpoint.${c.id}.id`) }) }),
          }),
        }),
      }),
    ]),
    dns: (c) => (c.use('domain'), c.use('group'), {
      hcl: resource('azurerm_dns_zone', c.id, { name: raw('var.domain'), resource_group_name: GROUP }),
      outputs: { [`${c.id}_name_servers`]: { value: `azurerm_dns_zone.${c.id}.name_servers`, description: 'Name servers to set at your registrar' } },
    }),
    kubernetes: (c) => ({
      hcl: resource('azurerm_kubernetes_cluster', c.id, {
        name: c.name, ...placed(c), dns_prefix: capped(c, 54),
        default_node_pool: nested({ name: 'default', vm_size: 'Standard_D2s_v5', node_count: Math.max(2, c.replicas) }),
        identity: nested({ type: 'SystemAssigned' }),
        node_provisioning_profile: nested({ mode: 'Manual' }),
      }),
      outputs: { [`${c.id}_kubeconfig`]: { value: `azurerm_kubernetes_cluster.${c.id}.kube_config_raw`, description: `Kubeconfig for ${c.node.name}`, sensitive: true } },
    }),
    cron: (c) => {
      c.use('workspace')
      c.use('apps')
      return {
        hcl: resource('azurerm_container_app_job', c.id, {
          name: capped(c, 32), ...placed(c),
          container_app_environment_id: raw('azurerm_container_app_environment.this.id'),
          replica_timeout_in_seconds: seconds(String(c.node.config.timeout ?? '15m')),
          schedule_trigger_config: nested({ cron_expression: String(c.node.config.schedule ?? '0 * * * *') }),
          template: nested({ container: nested({ name: 'main', image: c.image, cpu: 0.5, memory: '1Gi' }) }),
        }),
      }
    },
    container: (c) => {
      c.use('workspace')
      c.use('apps')
      c.use('group')
      const web = c.port !== undefined && ['service', 'workflow'].includes(c.tech.id)
      return {
        hcl: resource('azurerm_container_app', c.id, {
          name: capped(c, 32), resource_group_name: GROUP,
          container_app_environment_id: raw('azurerm_container_app_environment.this.id'),
          revision_mode: 'Single',
          template: nested({ min_replicas: c.replicas, max_replicas: Math.max(c.replicas, 10), container: nested({ name: 'main', image: c.image, cpu: 0.5, memory: '1Gi' }) }),
          ingress: web ? nested({ external_enabled: true, target_port: c.port, traffic_weight: nested({ latest_revision: true, percentage: 100 }) }) : undefined,
        }),
        outputs: web ? { [`${c.id}_url`]: { value: `"https://\${azurerm_container_app.${c.id}.ingress[0].fqdn}"`, description: `Public URL of ${c.node.name}` } } : undefined,
      }
    },
    serverless: (c) => {
      const at = placed(c)
      const [runtime, version] = functionRuntime(String(c.node.config.runtime ?? 'node22'))
      const account = `azurerm_storage_account.${c.id}`
      return {
        hcl: [
          resource('azurerm_storage_account', c.id, { name: compact(c, 24), ...at, account_tier: 'Standard', account_replication_type: 'LRS', min_tls_version: 'TLS1_2' }),
          resource('azurerm_storage_container', c.id, { name: 'deployments', storage_account_id: raw(`${account}.id`) }),
          resource('azurerm_service_plan', c.id, { name: c.name, ...at, os_type: 'Linux', sku_name: 'FC1' }),
          resource('azurerm_function_app_flex_consumption', c.id, {
            name: c.name, ...at,
            service_plan_id: raw(`azurerm_service_plan.${c.id}.id`),
            storage_container_type: 'blobContainer',
            storage_container_endpoint: raw(`"\${${account}.primary_blob_endpoint}\${azurerm_storage_container.${c.id}.name}"`),
            storage_authentication_type: 'StorageAccountConnectionString',
            storage_access_key: raw(`${account}.primary_access_key`),
            runtime_name: runtime,
            runtime_version: version,
            instance_memory_in_mb: 2048,
            site_config: nested({}),
          }),
        ].join('\n'),
        outputs: { [`${c.id}_url`]: { value: `"https://\${azurerm_function_app_flex_consumption.${c.id}.default_hostname}"`, description: `URL of ${c.node.name}` } },
      }
    },
    postgres: postgres(),
    pgvector: postgres({ 'azure.extensions': 'VECTOR' }),
    timescaledb: postgres({ 'azure.extensions': 'TIMESCALEDB', shared_preload_libraries: 'timescaledb' }),
    mysql: (c) => {
      const at = placed(c)
      const server = `azurerm_mysql_flexible_server.${c.id}`
      return {
        hcl: [
          password(c),
          resource('azurerm_mysql_flexible_server', c.id, {
            name: c.name, ...at, version: '8.0.21', sku_name: 'B_Standard_B1ms',
            administrator_login: 'tessery',
            administrator_password: raw(`random_password.${c.id}.result`),
            backup_retention_days: 7,
          }),
          resource('azurerm_mysql_flexible_server_firewall_rule', c.id, { name: 'azure-services', resource_group_name: GROUP, server_name: raw(`${server}.name`), start_ip_address: '0.0.0.0', end_ip_address: '0.0.0.0' }),
        ].join('\n'),
        outputs: { [`${c.id}_uri`]: { value: `"mysql://tessery:\${random_password.${c.id}.result}@\${${server}.fqdn}:3306/mysql?ssl-mode=REQUIRED"`, description: `Connection string for ${c.node.name}`, sensitive: true } },
        random: true,
      }
    },
    mongodb: cosmos('EnableMongo', (c, a) => ({
      [`${c.id}_uri`]: { value: `${a}.primary_mongodb_connection_string`, description: `Connection string for ${c.node.name}`, sensitive: true },
    })),
    cassandra: cosmos('EnableCassandra', (c, a) => ({
      [`${c.id}_contact_point`]: { value: `"\${${a}.name}.cassandra.cosmos.azure.com:10350"`, description: `Contact point of ${c.node.name}. The user name is the account name` },
      [`${c.id}_password`]: { value: `${a}.primary_key`, description: `Password for ${c.node.name}`, sensitive: true },
    })),
    'graph-db': cosmos('EnableGremlin', (c, a) => ({
      [`${c.id}_endpoint`]: { value: `"wss://\${${a}.name}.gremlin.cosmos.azure.com:443/"`, description: `Gremlin endpoint of ${c.node.name}` },
      [`${c.id}_key`]: { value: `${a}.primary_key`, description: `Key for ${c.node.name}`, sensitive: true },
    })),
    timeseries: (c) => {
      const at = placed(c)
      const cluster = `azurerm_kusto_cluster.${c.id}`
      return {
        hcl: [
          resource('azurerm_kusto_cluster', c.id, { name: compact(c, 22), ...at, sku: nested({ name: 'Dev(No SLA)_Standard_E2a_v4', capacity: 1 }) }),
          resource('azurerm_kusto_database', c.id, { name: 'metrics', ...at, cluster_name: raw(`${cluster}.name`) }),
        ].join('\n'),
        outputs: {
          [`${c.id}_uri`]: { value: `${cluster}.uri`, description: `Query URI of ${c.node.name}` },
          [`${c.id}_ingest_uri`]: { value: `${cluster}.data_ingestion_uri`, description: `Ingestion URI of ${c.node.name}` },
        },
      }
    },
    'vector-db': search,
    search,
    redis: (c) => {
      const r = `azurerm_managed_redis.${c.id}`
      return {
        hcl: resource('azurerm_managed_redis', c.id, {
          name: c.name, ...placed(c), sku_name: 'Balanced_B0', high_availability_enabled: false,
          default_database: nested({ access_keys_authentication_enabled: true }),
        }),
        outputs: { [`${c.id}_url`]: { value: `"rediss://:\${${r}.default_database[0].primary_access_key}@\${${r}.hostname}:\${${r}.default_database[0].port}"`, description: `Connection URL for ${c.node.name}`, sensitive: true } },
      }
    },
    kafka: eventHubs,
    stream: eventHubs,
    queue: (c) => {
      const ns = `azurerm_servicebus_namespace.${c.id}`
      return {
        hcl: [
          resource('azurerm_servicebus_namespace', c.id, { name: c.name, ...placed(c), sku: 'Basic' }),
          resource('azurerm_servicebus_queue', c.id, { name: c.id, namespace_id: raw(`${ns}.id`), dead_lettering_on_message_expiration: c.node.config.dlq !== false }),
        ].join('\n'),
        outputs: {
          [`${c.id}_connection_string`]: { value: `${ns}.default_primary_connection_string`, description: `Connection string for ${c.node.name}`, sensitive: true },
          [`${c.id}_queue`]: { value: `azurerm_servicebus_queue.${c.id}.name`, description: `Queue name of ${c.node.name}` },
        },
      }
    },
    mqtt: (c) => {
      const ns = `azurerm_eventgrid_namespace.${c.id}`
      return {
        hcl: resource('azurerm_eventgrid_namespace', c.id, { name: c.name, ...placed(c), sku: 'Standard', capacity: 1, topic_spaces_configuration: nested({}) }),
        outputs: { [`${c.id}_mqtt_host`]: { value: `"\${${ns}.name}.\${${ns}.location}-1.ts.eventgrid.azure.net:8883"`, description: `MQTT broker address of ${c.node.name}` } },
      }
    },
    pubsub: (c) => ({
      hcl: resource('azurerm_eventgrid_topic', c.id, { name: c.name, ...placed(c) }),
      outputs: {
        [`${c.id}_endpoint`]: { value: `azurerm_eventgrid_topic.${c.id}.endpoint`, description: `Endpoint to publish events to ${c.node.name}` },
        [`${c.id}_key`]: { value: `azurerm_eventgrid_topic.${c.id}.primary_access_key`, description: `Access key for ${c.node.name}`, sensitive: true },
      },
    }),
    'object-storage': (c) => {
      const account = `azurerm_storage_account.${c.id}`
      const bucket = String(c.node.config.bucket ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
      const container = bucket.length >= 3 ? bucket : 'assets'
      const pub = c.node.config.publicRead === true
      return {
        hcl: [
          resource('azurerm_storage_account', c.id, {
            name: compact(c, 24), ...placed(c), account_tier: 'Standard', account_replication_type: 'LRS', min_tls_version: 'TLS1_2',
            allow_nested_items_to_be_public: pub,
            blob_properties: nested({ versioning_enabled: c.node.config.versioning !== false }),
          }),
          resource('azurerm_storage_container', c.id, { name: container, storage_account_id: raw(`${account}.id`), container_access_type: pub ? 'blob' : 'private' }),
        ].join('\n'),
        outputs: {
          [`${c.id}_endpoint`]: { value: `"\${${account}.primary_blob_endpoint}${container}"`, description: `Address of the ${c.node.name} container` },
          [`${c.id}_connection_string`]: { value: `${account}.primary_connection_string`, description: `Connection string for ${c.node.name}`, sensitive: true },
        },
      }
    },
    'block-storage': (c) => ({
      hcl: resource('azurerm_managed_disk', c.id, { name: c.name, ...placed(c), storage_account_type: 'StandardSSD_LRS', create_option: 'Empty', disk_size_gb: c.storageGb }),
      outputs: { [`${c.id}_id`]: { value: `azurerm_managed_disk.${c.id}.id`, description: `ID of ${c.node.name}, to attach to a virtual machine` } },
    }),
    llm: (c) => ({
      hcl: resource('azurerm_cognitive_account', c.id, { name: c.name, ...placed(c), kind: 'AIServices', sku_name: 'S0', custom_subdomain_name: c.name }),
      outputs: {
        [`${c.id}_endpoint`]: { value: `azurerm_cognitive_account.${c.id}.endpoint`, description: `Endpoint of ${c.node.name}. Deploy a model to it in the Foundry portal` },
        [`${c.id}_key`]: { value: `azurerm_cognitive_account.${c.id}.primary_access_key`, description: `API key for ${c.node.name}`, sensitive: true },
      },
    }),
    gpu: (c) => vm(c, 'Standard_NC24ads_A100_v4'),
    monitoring: insights,
    tracing: insights,
    logging: (c) => {
      c.use('group')
      c.use('workspace')
      return {
        hcl: '',
        outputs: {
          [`${c.id}_workspace_id`]: { value: 'azurerm_log_analytics_workspace.this.workspace_id', description: `Workspace ID that ${c.node.name} collects logs in` },
          [`${c.id}_workspace_key`]: { value: 'azurerm_log_analytics_workspace.this.primary_shared_key', description: `Shared key for sending logs to ${c.node.name}`, sensitive: true },
        },
      }
    },
    auth: 'Entra External ID tenants can\'t be created with Terraform. Create the tenant in the Entra admin center, or self-host the identity provider',
    secrets: (c) => {
      c.use('client')
      const vault = `azurerm_key_vault.${c.id}`
      return {
        hcl: [
          resource('azurerm_key_vault', c.id, {
            name: compact(c, 24), ...placed(c), sku_name: 'standard',
            tenant_id: raw('data.azurerm_client_config.current.tenant_id'),
            rbac_authorization_enabled: true,
            soft_delete_retention_days: 7,
          }),
          resource('azurerm_role_assignment', c.id, { scope: raw(`${vault}.id`), role_definition_name: 'Key Vault Secrets Officer', principal_id: raw('data.azurerm_client_config.current.object_id') }),
        ].join('\n'),
        outputs: { [`${c.id}_uri`]: { value: `${vault}.vault_uri`, description: `Address of the ${c.node.name} vault` } },
      }
    },
    email: (c) => {
      c.use('group')
      const location = raw(`lookup(${DATA_LOCATION}, ${c.region.expr}, "United States")`)
      const domain = `azurerm_email_communication_service_domain.${c.id}`
      return {
        hcl: [
          resource('azurerm_communication_service', c.id, { name: c.name, resource_group_name: GROUP, data_location: location }),
          resource('azurerm_email_communication_service', c.id, { name: c.name, resource_group_name: GROUP, data_location: location }),
          resource('azurerm_email_communication_service_domain', c.id, { name: 'AzureManagedDomain', email_service_id: raw(`azurerm_email_communication_service.${c.id}.id`), domain_management: 'AzureManaged' }),
          resource('azurerm_communication_service_email_domain_association', c.id, { communication_service_id: raw(`azurerm_communication_service.${c.id}.id`), email_service_domain_id: raw(`${domain}.id`) }),
        ].join('\n'),
        outputs: {
          [`${c.id}_connection_string`]: { value: `azurerm_communication_service.${c.id}.primary_connection_string`, description: `Connection string for ${c.node.name}`, sensitive: true },
          [`${c.id}_sender`]: { value: `"DoNotReply@\${${domain}.mail_from_sender_domain}"`, description: `Sender address ${c.node.name} sends from` },
        },
      }
    },
  },
}
