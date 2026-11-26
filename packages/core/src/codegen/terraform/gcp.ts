import { block, nested, raw, resource, type Body } from './hcl'
import type { Generated, NodeCtx, SharedCtx, TfProvider } from './types'

const SERVICES = [
  'aiplatform', 'apigateway', 'artifactregistry', 'bigtableadmin', 'cloudscheduler', 'cloudtasks', 'cloudtrace', 'compute', 'container', 'discoveryengine', 'dns', 'firestore',
  'identitytoolkit', 'logging', 'managedkafka', 'monitoring', 'pubsub', 'redis', 'run', 'secretmanager', 'servicecontrol', 'servicemanagement', 'spanner', 'sqladmin',
] as const
type Service = (typeof SERVICES)[number]

/** Most Google Cloud names must start with a letter and stay under a length limit. */
const gname = (s: string, max = 63) => (/^[a-z]/.test(s) ? s : `t-${s}`).slice(0, max).replace(/-+$/, '')

/** The shared VPC, whose network waits for the Compute API. */
const network = (c: NodeCtx) => (c.use('network'), apis(c, 'compute'))

const zone = (c: NodeCtx) => raw(`"\${${c.region.expr}}-a"`)

/** Turns on the APIs a resource needs and returns them for its depends_on. */
function apis(c: NodeCtx, ...names: Service[]) {
  names.forEach((n) => c.use(`api_${n}`))
  return names.map((n) => raw(`google_project_service.${n}`))
}

/** Cloud Run only pulls from Artifact Registry and Docker Hub, so built images go through a remote repository in front of var.image_registry. */
function image(c: NodeCtx) {
  if (c.tech.image !== 'build' && c.tech.id !== 'function') return c.image
  c.use('registry')
  apis(c, 'artifactregistry')
  return raw(`"\${local.images}/${c.node.name}:\${var.image_tag}"`)
}

function seconds(v: unknown, fallback: number): string {
  const m = /^(\d+)\s*([smh]?)$/.exec(String(v ?? ''))
  return `${m ? Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600 }[m[2]] ?? 1) : fallback}s`
}

const container = (c: NodeCtx, port = c.port): Body => ({
  image: image(c),
  ports: port !== undefined ? nested({ container_port: port }) : undefined,
  resources: nested({ limits: { cpu: '1', memory: '512Mi' } }),
})

function runService(c: NodeCtx): Generated {
  return {
    hcl: resource('google_cloud_run_v2_service', c.id, {
      name: gname(c.name, 49),
      location: c.region,
      invoker_iam_disabled: true,
      template: nested({
        scaling: nested({ min_instance_count: 0, max_instance_count: Math.max(2, c.replicas * 2) }),
        containers: nested(container(c)),
      }),
      depends_on: apis(c, 'run'),
    }),
    outputs: { [`${c.id}_url`]: { value: `google_cloud_run_v2_service.${c.id}.uri`, description: `Public URL of ${c.node.name}` } },
  }
}

const runJob = (c: NodeCtx) => resource('google_cloud_run_v2_job', c.id, {
  name: gname(c.name, 49),
  location: c.region,
  template: nested({ template: nested({ timeout: seconds(c.node.config.timeout, 3600), max_retries: 1, containers: nested(container(c, undefined)) }) }),
  depends_on: apis(c, 'run'),
})

function scheduledJob(c: NodeCtx): Generated {
  const account = gname(`${c.id.replace(/_/g, '-')}-cron`, 30)
  return {
    hcl: [
      runJob(c),
      resource('google_service_account', c.id, { account_id: account.length < 6 ? `${account}-job` : account, display_name: `Starts ${c.node.name} on its schedule` }),
      resource('google_cloud_run_v2_job_iam_member', c.id, {
        name: raw(`google_cloud_run_v2_job.${c.id}.name`),
        location: raw(`google_cloud_run_v2_job.${c.id}.location`),
        role: 'roles/run.invoker',
        member: raw(`"serviceAccount:\${google_service_account.${c.id}.email}"`),
      }),
      resource('google_cloud_scheduler_job', c.id, {
        name: gname(c.name),
        region: c.region,
        schedule: String(c.node.config.schedule ?? '0 * * * *'),
        time_zone: 'Etc/UTC',
        http_target: nested({
          http_method: 'POST',
          uri: raw(`"https://run.googleapis.com/v2/\${google_cloud_run_v2_job.${c.id}.id}:run"`),
          oauth_token: nested({ service_account_email: raw(`google_service_account.${c.id}.email`) }),
        }),
        depends_on: apis(c, 'cloudscheduler'),
      }),
    ].join('\n'),
  }
}

const workerPool = (c: NodeCtx): Generated => ({
  hcl: resource('google_cloud_run_v2_worker_pool', c.id, {
    name: gname(c.name, 49),
    location: c.region,
    launch_stage: 'GA',
    scaling: nested({ scaling_mode: 'MANUAL', manual_instance_count: c.replicas }),
    template: nested({ containers: nested(container(c, undefined)) }),
    depends_on: apis(c, 'run'),
  }),
})

function sql(c: NodeCtx, version: string): Generated {
  const scheme = version.startsWith('POSTGRES') ? 'postgresql' : 'mysql'
  const instance = `google_sql_database_instance.${c.id}`
  return {
    hcl: [
      resource('random_password', c.id, { length: 24, special: false }),
      resource('google_sql_database_instance', c.id, {
        name: gname(c.name, 80),
        region: c.region,
        database_version: version,
        settings: nested({ tier: 'db-f1-micro', edition: 'ENTERPRISE', disk_size: Math.max(10, c.storageGb), backup_configuration: nested({ enabled: true }) }),
        depends_on: apis(c, 'sqladmin'),
      }),
      resource('google_sql_database', c.id, { name: 'app', instance: raw(`${instance}.name`) }),
      resource('google_sql_user', c.id, { name: 'app', instance: raw(`${instance}.name`), password: raw(`random_password.${c.id}.result`) }),
    ].join('\n'),
    random: true,
    outputs: {
      [`${c.id}_connection_name`]: { value: `${instance}.connection_name`, description: `Instance connection name of ${c.node.name}, for the Cloud SQL connectors` },
      [`${c.id}_url`]: {
        value: `"${scheme}://app:\${random_password.${c.id}.result}@\${${instance}.public_ip_address}/app"`,
        description: `Connection string for ${c.node.name}. Connect through the Cloud SQL Auth Proxy or add an authorized network`,
        sensitive: true,
      },
    },
  }
}

function instance(c: NodeCtx, machineType: string, diskGb: number, extra: Body = {}): Generated {
  network(c)
  c.use('ssh_key')
  const userData = c.cloudInit ? `, { user-data = file("${c.cloudInit}") }` : ''
  return {
    hcl: resource('google_compute_instance', c.id, {
      name: gname(c.name),
      machine_type: machineType,
      zone: zone(c),
      tags: [gname(c.prefix)],
      labels: { project: gname(c.prefix) },
      metadata: raw(`merge(var.ssh_public_key == null ? {} : { ssh-keys = "ubuntu:\${var.ssh_public_key}" }${userData})`),
      boot_disk: nested({ initialize_params: nested({ image: 'ubuntu-os-cloud/ubuntu-2404-lts-amd64', size: diskGb, type: 'pd-balanced' }) }),
      network_interface: nested({ subnetwork: raw('google_compute_subnetwork.this.id'), access_config: nested({}) }),
      ...extra,
      depends_on: apis(c, 'compute'),
    }),
    outputs: { [`${c.id}_ip`]: { value: `google_compute_instance.${c.id}.network_interface[0].access_config[0].nat_ip`, description: `Public IPv4 address of ${c.node.name}` } },
  }
}

/** The address, URL map, proxy and forwarding rule of a global external load balancer. */
function frontend(c: NodeCtx, backend: string, scheme?: string): string {
  return [
    resource('google_compute_global_address', c.id, { name: gname(c.name), depends_on: apis(c, 'compute') }),
    resource('google_compute_url_map', c.id, { name: gname(c.name), default_service: raw(backend) }),
    resource('google_compute_target_http_proxy', c.id, { name: gname(c.name), url_map: raw(`google_compute_url_map.${c.id}.id`) }),
    resource('google_compute_global_forwarding_rule', c.id, {
      name: gname(c.name),
      load_balancing_scheme: scheme,
      ip_address: raw(`google_compute_global_address.${c.id}.address`),
      port_range: '80',
      target: raw(`google_compute_target_http_proxy.${c.id}.id`),
    }),
  ].join('\n')
}

const ipOutput = (c: NodeCtx) => ({ [`${c.id}_ip`]: { value: `google_compute_global_address.${c.id}.address`, description: `Public IP of ${c.node.name}` } })

const bigtable = (c: NodeCtx): Generated => ({
  hcl: resource('google_bigtable_instance', c.id, {
    name: gname(c.name, 33),
    cluster: nested({ cluster_id: gname(c.name, 30), zone: zone(c), num_nodes: 1, storage_type: 'SSD' }),
    depends_on: apis(c, 'bigtableadmin'),
  }),
  outputs: { [`${c.id}_instance`]: { value: `google_bigtable_instance.${c.id}.name`, description: `Bigtable instance of ${c.node.name}` } },
})

function firestore(c: NodeCtx, mongo: boolean): Generated {
  const db = `google_firestore_database.${c.id}`
  return {
    hcl: resource('google_firestore_database', c.id, {
      name: gname(c.name), location_id: c.region, type: 'FIRESTORE_NATIVE', database_edition: mongo ? 'ENTERPRISE' : undefined, depends_on: apis(c, 'firestore'),
    }),
    outputs: {
      [`${c.id}_database`]: { value: `${db}.name`, description: `Database ID of ${c.node.name}` },
      ...(mongo ? { [`${c.id}_host`]: { value: `"\${${db}.uid}.\${${db}.location_id}.firestore.goog"`, description: `MongoDB host of ${c.node.name}, on port 443 with TLS` } } : {}),
    },
  }
}

const sharedApis: Record<string, (c: SharedCtx) => Generated> = Object.fromEntries(
  SERVICES.map((s) => [`api_${s}`, () => ({ hcl: resource('google_project_service', s, { service: `${s}.googleapis.com`, disable_on_destroy: false }) })]),
)

const BETA = raw('google-beta')

export const gcp: TfProvider = {
  id: 'gcp',
  name: 'Google Cloud',
  local: 'google',
  source: 'hashicorp/google',
  version: '~> 8.12',
  variables: [
    block('variable', ['project'], { type: raw('string'), description: 'ID of the Google Cloud project to create everything in.' }),
    block('variable', ['credentials'], { type: raw('string'), default: raw('null'), sensitive: true, description: 'Service account key as a file path or JSON. Leave it unset to use the gcloud application default credentials.' }),
  ].join('\n'),
  provider: block('provider', ['google'], { project: raw('var.project'), region: raw('var.region'), credentials: raw('var.credentials') }),
  shared: {
    ...sharedApis,
    network: (c) => {
      const network = raw('google_compute_network.this.id')
      return {
        hcl: [
          resource('google_compute_network', 'this', { name: gname(c.prefix), auto_create_subnetworks: false, depends_on: [raw('google_project_service.compute')] }),
          resource('google_compute_subnetwork', 'this', { name: gname(c.prefix), network, region: raw('var.region'), ip_cidr_range: '10.0.0.0/20', private_ip_google_access: true }),
          resource('google_compute_firewall', 'internal', {
            name: gname(`${c.prefix}-internal`), network, source_ranges: ['10.0.0.0/8'],
            allow: [nested({ protocol: 'tcp' }), nested({ protocol: 'udp' }), nested({ protocol: 'icmp' })],
          }),
          resource('google_compute_firewall', 'web', {
            name: gname(`${c.prefix}-web`), network, source_ranges: ['0.0.0.0/0'], target_tags: [gname(c.prefix)],
            allow: nested({ protocol: 'tcp', ports: ['22', '80', '443'] }),
          }),
          resource('google_compute_firewall', 'health_checks', {
            name: gname(`${c.prefix}-health-checks`), network, source_ranges: ['130.211.0.0/22', '35.191.0.0/16'], target_tags: [gname(c.prefix)],
            allow: nested({ protocol: 'tcp' }),
          }),
        ].join('\n'),
      }
    },
    ssh_key: () => ({
      hcl: '',
      variables: block('variable', ['ssh_public_key'], { type: raw('string'), default: raw('null'), description: 'Public key allowed to log in to the VMs as ubuntu. Leave it unset to use OS Login.' }),
    }),
    registry: (c) => ({
      hcl: [
        resource('google_artifact_registry_repository', 'images', {
          repository_id: gname(`${c.prefix}-images`),
          location: raw('var.region'),
          format: 'DOCKER',
          mode: 'REMOTE_REPOSITORY',
          description: 'Mirror of var.image_registry for Cloud Run.',
          remote_repository_config: nested({ docker_repository: nested({ custom_repository: nested({ uri: raw('"https://${split("/", var.image_registry)[0]}"') }) }) }),
          depends_on: [raw('google_project_service.artifactregistry')],
        }),
        block('locals', [], {
          images: raw('"${google_artifact_registry_repository.images.location}-docker.pkg.dev/${var.project}/${google_artifact_registry_repository.images.repository_id}/${join("/", slice(split("/", var.image_registry), 1, length(split("/", var.image_registry))))}"'),
        }),
      ].join('\n'),
    }),
    beta: () => ({
      hcl: block('provider', ['google-beta'], { project: raw('var.project'), region: raw('var.region'), credentials: raw('var.credentials') }),
      requires: { 'google-beta': { source: 'hashicorp/google-beta', version: '~> 8.12' } },
    }),
    domain: () => ({ hcl: '', variables: block('variable', ['domain'], { type: raw('string'), description: 'Domain Cloud DNS hosts, like example.com.' }) }),
    alert_email: () => ({ hcl: '', variables: block('variable', ['alert_email'], { type: raw('string'), description: 'Address that gets monitoring alerts.' }) }),
  },
  vm: (c) => instance(c, c.plan, Math.max(20, c.storageGb)),
  managed: {
    container: (c) => {
      if (c.tech.id === 'cron') return scheduledJob(c)
      if (c.tech.id === 'batch') return { hcl: runJob(c) }
      if (c.tech.id === 'worker' || c.port === undefined) return workerPool(c)
      return runService(c)
    },
    serverless: runService,
    kubernetes: (c) => {
      network(c)
      return {
        hcl: resource('google_container_cluster', c.id, {
          name: gname(c.name, 40),
          location: c.region,
          enable_autopilot: true,
          network: raw('google_compute_network.this.id'),
          subnetwork: raw('google_compute_subnetwork.this.id'),
          depends_on: apis(c, 'container'),
        }),
        outputs: {
          [`${c.id}_name`]: { value: `google_container_cluster.${c.id}.name`, description: `Name of ${c.node.name}, for gcloud container clusters get-credentials` },
          [`${c.id}_endpoint`]: { value: `google_container_cluster.${c.id}.endpoint`, description: `API server address of ${c.node.name}`, sensitive: true },
        },
      }
    },
    postgres: (c) => sql(c, `POSTGRES_${['13', '14', '15', '16', '17'].includes(c.version ?? '') ? c.version : '17'}`),
    mysql: (c) => sql(c, (c.version ?? '').startsWith('8.0') ? 'MYSQL_8_0' : 'MYSQL_8_4'),
    firestore: (c) => firestore(c, false),
    mongodb: (c) => firestore(c, true),
    cassandra: bigtable,
    timeseries: bigtable,
    'graph-db': (c) => ({
      hcl: [
        resource('google_spanner_instance', c.id, {
          name: gname(c.name, 30), display_name: gname(c.name, 30), config: raw(`"regional-\${${c.region.expr}}"`), processing_units: 100, edition: 'ENTERPRISE',
          depends_on: apis(c, 'spanner'),
        }),
        resource('google_spanner_database', c.id, { instance: raw(`google_spanner_instance.${c.id}.name`), name: 'graph' }),
      ].join('\n'),
      outputs: { [`${c.id}_database`]: { value: `google_spanner_database.${c.id}.id`, description: `Spanner database of ${c.node.name}` } },
    }),
    'vector-db': (c) => {
      const deps = apis(c, 'aiplatform')
      return {
        hcl: [
          resource('google_vertex_ai_index', c.id, {
            display_name: c.name,
            region: c.region,
            index_update_method: 'STREAM_UPDATE',
            metadata: nested({
              config: nested({
                dimensions: Number(c.node.config.dimensions ?? 768),
                approximate_neighbors_count: 150,
                distance_measure_type: 'DOT_PRODUCT_DISTANCE',
                algorithm_config: nested({ tree_ah_config: nested({}) }),
              }),
            }),
            depends_on: deps,
          }),
          resource('google_vertex_ai_index_endpoint', c.id, { display_name: c.name, region: c.region, public_endpoint_enabled: true, depends_on: deps }),
          resource('google_vertex_ai_index_endpoint_deployed_index', c.id, {
            index_endpoint: raw(`google_vertex_ai_index_endpoint.${c.id}.id`),
            index: raw(`google_vertex_ai_index.${c.id}.id`),
            deployed_index_id: c.id.slice(0, 64),
            automatic_resources: nested({ min_replica_count: 1, max_replica_count: 1 }),
          }),
        ].join('\n'),
        outputs: {
          [`${c.id}_endpoint`]: { value: `google_vertex_ai_index_endpoint.${c.id}.public_endpoint_domain_name`, description: `Query address of ${c.node.name}` },
          [`${c.id}_index`]: { value: `google_vertex_ai_index.${c.id}.id`, description: `Index of ${c.node.name}, for upserting vectors` },
        },
      }
    },
    search: (c) => ({
      hcl: [
        resource('google_discovery_engine_data_store', c.id, {
          data_store_id: gname(c.name), display_name: c.name, location: 'global', industry_vertical: 'GENERIC', content_config: 'NO_CONTENT', solution_types: ['SOLUTION_TYPE_SEARCH'],
          depends_on: apis(c, 'discoveryengine'),
        }),
        resource('google_discovery_engine_search_engine', c.id, {
          engine_id: gname(c.name), display_name: c.name, location: 'global', collection_id: 'default_collection',
          data_store_ids: [raw(`google_discovery_engine_data_store.${c.id}.data_store_id`)],
          search_engine_config: nested({ search_tier: 'SEARCH_TIER_STANDARD' }),
        }),
      ].join('\n'),
      outputs: { [`${c.id}_engine`]: { value: `google_discovery_engine_search_engine.${c.id}.name`, description: `Search app of ${c.node.name}` } },
    }),
    redis: (c) => {
      network(c)
      const redis = `google_redis_instance.${c.id}`
      return {
        hcl: resource('google_redis_instance', c.id, {
          name: gname(c.name, 40), region: c.region, tier: 'BASIC', memory_size_gb: 1, redis_version: 'REDIS_7_2', auth_enabled: true,
          authorized_network: raw('google_compute_network.this.id'),
          depends_on: apis(c, 'redis'),
        }),
        outputs: {
          [`${c.id}_address`]: { value: `"\${${redis}.host}:\${${redis}.port}"`, description: `Address of ${c.node.name} inside the VPC` },
          [`${c.id}_auth`]: { value: `${redis}.auth_string`, description: `Password of ${c.node.name}`, sensitive: true },
        },
      }
    },
    kafka: (c) => {
      network(c)
      return {
        hcl: resource('google_managed_kafka_cluster', c.id, {
          cluster_id: gname(c.name),
          location: c.region,
          capacity_config: nested({ vcpu_count: '3', memory_bytes: '3221225472' }),
          gcp_config: nested({ access_config: nested({ network_configs: nested({ subnet: raw('google_compute_subnetwork.this.id') }) }) }),
          depends_on: apis(c, 'managedkafka'),
        }),
        outputs: { [`${c.id}_bootstrap`]: { value: `google_managed_kafka_cluster.${c.id}.bootstrap_address`, description: `Bootstrap address of ${c.node.name} inside the VPC` } },
      }
    },
    queue: (c) => ({
      hcl: resource('google_cloud_tasks_queue', c.id, { name: gname(c.name, 100), location: c.region, retry_config: nested({ max_attempts: 5 }), depends_on: apis(c, 'cloudtasks') }),
      outputs: { [`${c.id}_queue`]: { value: `google_cloud_tasks_queue.${c.id}.id`, description: `Cloud Tasks queue of ${c.node.name}` } },
    }),
    pubsub: (c) => ({
      hcl: [
        resource('google_pubsub_topic', c.id, { name: gname(c.name, 255), depends_on: apis(c, 'pubsub') }),
        resource('google_pubsub_subscription', c.id, { name: gname(c.name, 255), topic: raw(`google_pubsub_topic.${c.id}.id`), ack_deadline_seconds: 30 }),
      ].join('\n'),
      outputs: {
        [`${c.id}_topic`]: { value: `google_pubsub_topic.${c.id}.id`, description: `Topic to publish to for ${c.node.name}` },
        [`${c.id}_subscription`]: { value: `google_pubsub_subscription.${c.id}.id`, description: `Subscription to pull from for ${c.node.name}` },
      },
    }),
    'object-storage': (c) => ({
      hcl: resource('google_storage_bucket', c.id, { name: c.name, location: c.region, uniform_bucket_level_access: true, public_access_prevention: 'enforced' }),
      outputs: { [`${c.id}_bucket`]: { value: `google_storage_bucket.${c.id}.url`, description: `Address of the ${c.node.name} bucket` } },
    }),
    'block-storage': (c) => ({
      hcl: resource('google_compute_disk', c.id, { name: gname(c.name), zone: zone(c), size: Math.max(10, c.storageGb), type: 'pd-balanced', depends_on: apis(c, 'compute') }),
      outputs: { [`${c.id}_disk`]: { value: `google_compute_disk.${c.id}.id`, description: `Disk of ${c.node.name}, to attach to a VM` } },
    }),
    cdn: (c) => ({
      hcl: [
        resource('google_storage_bucket', c.id, { name: `${c.name}-origin`, location: c.region, uniform_bucket_level_access: true }),
        resource('google_compute_backend_bucket', c.id, {
          name: gname(c.name), bucket_name: raw(`google_storage_bucket.${c.id}.name`), enable_cdn: true,
          cdn_policy: nested({ cache_mode: 'CACHE_ALL_STATIC', default_ttl: parseInt(seconds(c.node.config.ttl, 3600)) }),
        }),
        frontend(c, `google_compute_backend_bucket.${c.id}.id`),
      ].join('\n'),
      outputs: { ...ipOutput(c), [`${c.id}_origin`]: { value: `google_storage_bucket.${c.id}.name`, description: `Bucket ${c.node.name} serves files from` } },
    }),
    'load-balancer': (c) => {
      network(c)
      return {
        hcl: [
          resource('google_compute_health_check', c.id, {
            name: gname(c.name),
            http_health_check: nested({ port: c.port ?? 80, request_path: String(c.node.config.healthPath ?? '/healthz') }),
            depends_on: apis(c, 'compute'),
          }),
          resource('google_compute_backend_service', c.id, {
            name: gname(c.name), protocol: 'HTTP', port_name: 'http', load_balancing_scheme: 'EXTERNAL_MANAGED', health_checks: [raw(`google_compute_health_check.${c.id}.id`)],
          }),
          frontend(c, `google_compute_backend_service.${c.id}.id`, 'EXTERNAL_MANAGED'),
        ].join('\n'),
        outputs: ipOutput(c),
      }
    },
    'api-gateway': (c) => {
      c.use('beta')
      const id = gname(c.name, 50)
      const spec = JSON.stringify({
        swagger: '2.0',
        info: { title: c.node.name, version: '1.0.0' },
        schemes: ['https'],
        'x-google-backend': { address: '@backend', path_translation: 'APPEND_PATH_TO_ADDRESS' },
        'x-google-allow': 'all',
        paths: { '/': { get: { operationId: 'root', responses: { 200: { description: 'OK' } } } } },
      }).replace('"@backend"', `var.${c.id}_backend`)
      return {
        hcl: [
          resource('google_api_gateway_api', c.id, { provider: BETA, api_id: id, depends_on: apis(c, 'apigateway', 'servicecontrol', 'servicemanagement') }),
          resource('google_api_gateway_api_config', c.id, {
            provider: BETA,
            api: raw(`google_api_gateway_api.${c.id}.api_id`),
            api_config_id_prefix: `${id.slice(0, 40)}-`,
            openapi_documents: nested({ document: nested({ path: 'openapi.json', contents: raw(`base64encode(jsonencode(${spec}))`) }) }),
            lifecycle: nested({ create_before_destroy: true }),
          }),
          resource('google_api_gateway_gateway', c.id, { provider: BETA, gateway_id: id, region: c.region, api_config: raw(`google_api_gateway_api_config.${c.id}.id`) }),
        ].join('\n'),
        variables: block('variable', [`${c.id}_backend`], { type: raw('string'), description: `HTTPS address ${c.node.name} forwards requests to, like the URL of a Cloud Run service.` }),
        outputs: { [`${c.id}_url`]: { value: `"https://\${google_api_gateway_gateway.${c.id}.default_hostname}"`, description: `Public URL of ${c.node.name}` } },
      }
    },
    dns: (c) => (c.use('domain'), {
      hcl: resource('google_dns_managed_zone', c.id, { name: gname(c.name), dns_name: raw('"${var.domain}."'), depends_on: apis(c, 'dns') }),
      outputs: { [`${c.id}_name_servers`]: { value: `google_dns_managed_zone.${c.id}.name_servers`, description: 'Name servers to set at your registrar' } },
    }),
    waf: (c) => ({
      hcl: resource('google_compute_security_policy', c.id, {
        name: gname(c.name),
        description: `OWASP rules for ${c.node.name}. Set it as the security_policy of a backend service to apply it.`,
        rule: [
          ...['sqli', 'xss', 'lfi', 'rce'].map((r, i) => nested({
            action: 'deny(403)',
            priority: 1000 + i,
            match: nested({ expr: nested({ expression: `evaluatePreconfiguredWaf('${r}-v33-stable')` }) }),
          })),
          nested({ action: 'allow', priority: 2147483647, description: 'Allow everything else', match: nested({ versioned_expr: 'SRC_IPS_V1', config: nested({ src_ip_ranges: ['*'] }) }) }),
        ],
        depends_on: apis(c, 'compute'),
      }),
      outputs: { [`${c.id}_policy`]: { value: `google_compute_security_policy.${c.id}.self_link`, description: `Cloud Armor policy of ${c.node.name}` } },
    }),
    llm: (c) => (apis(c, 'aiplatform'), {
      hcl: '',
      outputs: {
        [`${c.id}_endpoint`]: {
          value: `"https://\${${c.region.expr}}-aiplatform.googleapis.com/v1/projects/\${var.project}/locations/\${${c.region.expr}}"`,
          description: `Vertex AI endpoint for ${c.node.name}. Turn on the models you use in Model Garden`,
        },
      },
    }),
    gpu: (c) => instance(c, 'g2-standard-4', 100, {
      guest_accelerator: nested({ type: 'nvidia-l4', count: 1 }),
      scheduling: nested({ on_host_maintenance: 'TERMINATE', automatic_restart: true }),
    }),
    monitoring: (c) => {
      c.use('alert_email')
      return {
        hcl: [
          resource('google_monitoring_notification_channel', c.id, {
            display_name: `${c.prefix} alerts`, type: 'email', labels: { email_address: raw('var.alert_email') }, depends_on: apis(c, 'monitoring'),
          }),
          resource('google_monitoring_alert_policy', c.id, {
            display_name: `${c.prefix}: CPU above 80%`,
            combiner: 'OR',
            notification_channels: [raw(`google_monitoring_notification_channel.${c.id}.name`)],
            conditions: nested({
              display_name: 'VM CPU above 80% for 5 minutes',
              condition_threshold: nested({
                filter: 'resource.type = "gce_instance" AND metric.type = "compute.googleapis.com/instance/cpu/utilization"',
                comparison: 'COMPARISON_GT',
                threshold_value: 0.8,
                duration: '300s',
                aggregations: nested({ alignment_period: '60s', per_series_aligner: 'ALIGN_MEAN' }),
              }),
            }),
          }),
        ].join('\n'),
      }
    },
    logging: (c) => ({
      hcl: [
        resource('google_logging_project_bucket_config', c.id, { project: raw('var.project'), location: 'global', bucket_id: gname(c.name, 100), retention_days: 30, depends_on: apis(c, 'logging') }),
        resource('google_logging_project_sink', c.id, {
          name: gname(c.name, 100),
          destination: raw(`"logging.googleapis.com/\${google_logging_project_bucket_config.${c.id}.id}"`),
          filter: 'resource.type = ("cloud_run_revision" OR "cloud_run_job" OR "gce_instance" OR "k8s_container")',
        }),
      ].join('\n'),
      outputs: { [`${c.id}_bucket`]: { value: `google_logging_project_bucket_config.${c.id}.id`, description: `Log bucket of ${c.node.name}` } },
    }),
    tracing: (c) => (apis(c, 'cloudtrace'), {
      hcl: '',
      outputs: { [`${c.id}_endpoint`]: { value: '"https://telemetry.googleapis.com"', description: `OTLP endpoint that sends traces from ${c.node.name} to Cloud Trace` } },
    }),
    auth: (c) => ({
      hcl: resource('google_identity_platform_config', c.id, {
        sign_in: nested({ email: nested({ enabled: true, password_required: true }) }),
        depends_on: apis(c, 'identitytoolkit'),
      }),
      outputs: { [`${c.id}_auth_domain`]: { value: '"${var.project}.firebaseapp.com"', description: `Sign-in domain of ${c.node.name}` } },
    }),
    secrets: (c) => ({
      hcl: resource('google_secret_manager_secret', c.id, { secret_id: gname(c.name, 255), replication: nested({ auto: nested({}) }), depends_on: apis(c, 'secretmanager') }),
      outputs: { [`${c.id}_secret`]: { value: `google_secret_manager_secret.${c.id}.id`, description: `Secret of ${c.node.name}. Add versions with gcloud or the console` } },
    }),
  },
}
