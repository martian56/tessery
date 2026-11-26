import { block, data, nested, raw, resource, type Body } from './hcl'
import type { Generated, NodeCtx, TfProvider } from './types'

const SUBNETS = raw('aws_subnet.this[*].id')
const FIRST_SUBNET = raw('[aws_subnet.this[0].id]')
const SG = raw('[aws_security_group.this.id]')
const ARCHIVE = { archive: { source: 'hashicorp/archive', version: '~> 2.7' } }

const short = (s: string, n: number) => s.slice(0, n).replace(/-+$/, '')
const isArm = (type: string) => /^[a-z]+\d+g[a-z]*\./.test(type)
const inRegion = (c: NodeCtx, host: string) => `"${host.replace('{region}', `\${${c.region.expr}}`)}"`

function assume(service: string) {
  return raw(`jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "${service}" } }]
  })`)
}

const password = (c: NodeCtx, length = 32) => resource('random_password', c.id, { length, special: false })

function ami(arch: 'arm64' | 'amd64'): Generated {
  return {
    hcl: data('aws_ami', `ubuntu_${arch}`, {
      most_recent: true,
      owners: ['099720108477'],
      filter: nested({ name: 'name', values: [`ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${arch}-server-*`] }),
    }),
  }
}

function instance(c: NodeCtx, type: string, image: 'ami_arm64' | 'ami_amd64' | 'ami_gpu', diskGb: number): Generated {
  c.use('network')
  c.use('ssh_key')
  c.use(image)
  const ref = { ami_arm64: 'ubuntu_arm64', ami_amd64: 'ubuntu_amd64', ami_gpu: 'gpu' }[image]
  return {
    hcl: resource('aws_instance', c.id, {
      ami: raw(`data.aws_ami.${ref}.id`),
      instance_type: type,
      subnet_id: raw('aws_subnet.this[0].id'),
      vpc_security_group_ids: SG,
      key_name: raw('aws_key_pair.this.key_name'),
      user_data: c.cloudInit ? raw(`file("${c.cloudInit}")`) : undefined,
      tags: { Name: c.name },
      root_block_device: nested({ volume_size: diskGb, volume_type: 'gp3' }),
    }),
    outputs: { [`${c.id}_ip`]: { value: `aws_instance.${c.id}.public_ip`, description: `Public IPv4 address of ${c.node.name}` } },
  }
}

function rds(engine: string, scheme: string, versions: string[]): (c: NodeCtx) => Generated {
  return (c) => {
    c.use('network')
    c.use('db_subnets')
    return {
      hcl: [
        password(c),
        resource('aws_db_instance', c.id, {
          identifier: c.name,
          engine,
          engine_version: versions.includes(c.version ?? '') ? c.version : versions[0],
          instance_class: 'db.t4g.micro',
          allocated_storage: Math.max(20, c.storageGb),
          storage_type: 'gp3',
          storage_encrypted: true,
          db_name: 'app',
          username: 'app',
          password: raw(`random_password.${c.id}.result`),
          db_subnet_group_name: raw('aws_db_subnet_group.this.name'),
          vpc_security_group_ids: SG,
          multi_az: c.node.config.highAvailability === true,
          backup_retention_period: c.node.config.backups === 'off' ? 0 : 7,
          skip_final_snapshot: true,
        }),
      ].join('\n'),
      outputs: { [`${c.id}_uri`]: { value: `"${scheme}://app:\${random_password.${c.id}.result}@\${aws_db_instance.${c.id}.endpoint}/app"`, description: `Connection string for ${c.node.name} inside the VPC`, sensitive: true } },
      random: true,
    }
  }
}

function opensearch(c: NodeCtx): Generated {
  c.use('network')
  return {
    hcl: [
      resource('aws_opensearch_domain', c.id, {
        domain_name: short(c.name, 28),
        engine_version: 'OpenSearch_2.19',
        cluster_config: nested({ instance_type: 't3.small.search', instance_count: 1 }),
        ebs_options: nested({ ebs_enabled: true, volume_type: 'gp3', volume_size: Math.min(100, Math.max(10, c.storageGb)) }),
        vpc_options: nested({ subnet_ids: FIRST_SUBNET, security_group_ids: SG }),
        domain_endpoint_options: nested({ enforce_https: true, tls_security_policy: 'Policy-Min-TLS-1-2-2019-07' }),
      }),
      resource('aws_opensearch_domain_policy', c.id, {
        domain_name: raw(`aws_opensearch_domain.${c.id}.domain_name`),
        access_policies: raw(`jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { AWS = "*" }, Action = "es:*", Resource = "\${aws_opensearch_domain.${c.id}.arn}/*" }]
  })`),
      }),
    ].join('\n'),
    outputs: { [`${c.id}_url`]: { value: `"https://\${aws_opensearch_domain.${c.id}.endpoint}"`, description: `Address of ${c.node.name} inside the VPC` } },
  }
}

function taskDefinition(c: NodeCtx): string {
  c.use('network')
  c.use('ecs')
  const ports = c.port === undefined ? '' : `\n    portMappings = [{ containerPort = ${c.port}, protocol = "tcp" }]`
  return resource('aws_ecs_task_definition', c.id, {
    family: c.name,
    requires_compatibilities: ['FARGATE'],
    network_mode: 'awsvpc',
    cpu: '256',
    memory: '512',
    execution_role_arn: raw('aws_iam_role.ecs_execution.arn'),
    container_definitions: raw(`jsonencode([{
    name      = "${c.node.name}"
    image     = ${c.image.expr}
    essential = true${ports}
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = ${c.region.expr}
        "awslogs-stream-prefix" = "${c.node.name}"
      }
    }
  }])`),
  })
}

/** EventBridge Scheduler wants six fields, a `?` in day of month or day of week, and Sunday as 1. */
function awsCron(schedule: string): string {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return '0 * * * ? *'
  const [min, hour, dom, mon, dow] = parts.map((p, i) => p.replace(/^\*\//, i < 2 ? '0/' : '1/'))
  if (dow === '*') return `${min} ${hour} ${dom} ${mon} ? *`
  return `${min} ${hour} ? ${mon} ${dow.replace(/\d/g, (d) => String((Number(d) % 7) + 1))} *`
}

const RETENTION = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653]
const retentionDays = (v: unknown, def: number) => {
  const n = parseInt(String(v ?? ''), 10)
  return RETENTION.find((d) => d >= (Number.isFinite(n) ? n : def)) ?? 3653
}

const LAMBDA: Record<string, { runtime: string; handler: string; file: string; code: string }> = {
  node22: { runtime: 'nodejs22.x', handler: 'index.handler', file: 'index.mjs', code: 'export const handler = async () => ({ statusCode: 200, body: "ok" })\n' },
  'python3.13': { runtime: 'python3.13', handler: 'main.handler', file: 'main.py', code: 'def handler(event, context):\n    return {"statusCode": 200, "body": "ok"}\n' },
  'go1.24': { runtime: 'provided.al2023', handler: 'bootstrap', file: 'README', code: 'Replace with the compiled bootstrap binary.\n' },
  rust: { runtime: 'provided.al2023', handler: 'bootstrap', file: 'README', code: 'Replace with the compiled bootstrap binary.\n' },
  java21: { runtime: 'java21', handler: 'example.Handler::handleRequest', file: 'README', code: 'Replace with the built jar.\n' },
  dotnet9: { runtime: 'dotnet8', handler: 'Function::Function.Handler::Handle', file: 'README', code: 'Replace with the published function.\n' },
}

export const aws: TfProvider = {
  id: 'aws',
  name: 'AWS',
  local: 'aws',
  source: 'hashicorp/aws',
  version: '~> 6.74',
  variables: [
    block('variable', ['aws_access_key'], { type: raw('string'), default: raw('null'), sensitive: true, description: 'Access key ID. Leave unset to use the AWS CLI profile or environment variables.' }),
    block('variable', ['aws_secret_key'], { type: raw('string'), default: raw('null'), sensitive: true, description: 'Secret access key that goes with aws_access_key.' }),
  ].join('\n'),
  provider: block('provider', ['aws'], {
    region: raw('var.region'),
    access_key: raw('var.aws_access_key'),
    secret_key: raw('var.aws_secret_key'),
    default_tags: nested({ tags: { managed_by: 'tessery' } }),
  }),
  shared: {
    network: (c) => ({
      hcl: [
        data('aws_availability_zones', 'available', { state: 'available' }),
        resource('aws_vpc', 'this', { cidr_block: '10.0.0.0/16', enable_dns_support: true, enable_dns_hostnames: true, tags: { Name: c.prefix } }),
        resource('aws_internet_gateway', 'this', { vpc_id: raw('aws_vpc.this.id'), tags: { Name: c.prefix } }),
        resource('aws_subnet', 'this', {
          count: 2,
          vpc_id: raw('aws_vpc.this.id'),
          cidr_block: raw('cidrsubnet(aws_vpc.this.cidr_block, 8, count.index)'),
          availability_zone: raw('data.aws_availability_zones.available.names[count.index]'),
          map_public_ip_on_launch: true,
          tags: { Name: raw(`"${c.prefix}-\${count.index}"`) },
        }),
        resource('aws_route_table', 'this', {
          vpc_id: raw('aws_vpc.this.id'),
          tags: { Name: c.prefix },
          route: nested({ cidr_block: '0.0.0.0/0', gateway_id: raw('aws_internet_gateway.this.id') }),
        }),
        resource('aws_route_table_association', 'this', { count: 2, subnet_id: raw('aws_subnet.this[count.index].id'), route_table_id: raw('aws_route_table.this.id') }),
        resource('aws_security_group', 'this', {
          name: c.prefix,
          description: 'Traffic inside the VPC, plus SSH and web traffic from anywhere',
          vpc_id: raw('aws_vpc.this.id'),
          ingress: [
            nested({ description: 'Inside the VPC', from_port: 0, to_port: 0, protocol: '-1', cidr_blocks: ['10.0.0.0/16'] }),
            ...[22, 80, 443].map((port) => nested({ description: `Port ${port}`, from_port: port, to_port: port, protocol: 'tcp', cidr_blocks: ['0.0.0.0/0'] })),
          ],
          egress: nested({ from_port: 0, to_port: 0, protocol: '-1', cidr_blocks: ['0.0.0.0/0'] }),
        }),
      ].join('\n'),
    }),
    ssh_key: (c) => ({
      hcl: resource('aws_key_pair', 'this', { key_name: c.prefix, public_key: raw('var.ssh_public_key') }),
      variables: block('variable', ['ssh_public_key'], { type: raw('string'), description: 'Public key allowed to log in to the instances as ubuntu.' }),
    }),
    ami_arm64: () => ami('arm64'),
    ami_amd64: () => ami('amd64'),
    ami_gpu: () => ({
      hcl: data('aws_ami', 'gpu', {
        most_recent: true,
        owners: ['amazon'],
        filter: nested({ name: 'name', values: ['Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04) *'] }),
      }),
    }),
    db_subnets: (c) => ({ hcl: resource('aws_db_subnet_group', 'this', { name: c.prefix, subnet_ids: SUBNETS }) }),
    cache_subnets: (c) => ({ hcl: resource('aws_elasticache_subnet_group', 'this', { name: c.prefix, subnet_ids: SUBNETS }) }),
    ecs: (c) => ({
      hcl: [
        resource('aws_ecs_cluster', 'this', { name: c.prefix }),
        resource('aws_cloudwatch_log_group', 'ecs', { name: `/ecs/${c.prefix}`, retention_in_days: 30 }),
        resource('aws_iam_role', 'ecs_execution', { name: `${c.prefix}-ecs-execution`, assume_role_policy: assume('ecs-tasks.amazonaws.com') }),
        resource('aws_iam_role_policy_attachment', 'ecs_execution', { role: raw('aws_iam_role.ecs_execution.name'), policy_arn: 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy' }),
      ].join('\n'),
    }),
    scheduler: (c) => ({
      hcl: [
        resource('aws_iam_role', 'scheduler', { name: `${c.prefix}-scheduler`, assume_role_policy: assume('scheduler.amazonaws.com') }),
        resource('aws_iam_role_policy', 'scheduler', {
          name: 'run-tasks',
          role: raw('aws_iam_role.scheduler.id'),
          policy: raw(`jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecs:RunTask", Resource = "*" },
      { Effect = "Allow", Action = "iam:PassRole", Resource = aws_iam_role.ecs_execution.arn },
    ]
  })`),
        }),
      ].join('\n'),
    }),
    lambda: (c) => ({
      hcl: [
        resource('aws_iam_role', 'lambda', { name: `${c.prefix}-lambda`, assume_role_policy: assume('lambda.amazonaws.com') }),
        resource('aws_iam_role_policy_attachment', 'lambda', { role: raw('aws_iam_role.lambda.name'), policy_arn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }),
      ].join('\n'),
    }),
    alerts: (c) => ({
      hcl: [
        resource('aws_sns_topic', 'alerts', { name: `${c.prefix}-alerts` }),
        resource('aws_sns_topic_subscription', 'alerts', { topic_arn: raw('aws_sns_topic.alerts.arn'), protocol: 'email', endpoint: raw('var.alert_email') }),
      ].join('\n'),
      variables: block('variable', ['alert_email'], { type: raw('string'), description: 'Address that gets monitoring alerts. AWS sends it a confirmation link first.' }),
      outputs: { alerts_topic_arn: { value: 'aws_sns_topic.alerts.arn', description: 'SNS topic to send CloudWatch alarms to' } },
    }),
    domain: () => ({ hcl: '', variables: block('variable', ['domain'], { type: raw('string'), description: 'Domain the project uses, like example.com.' }) }),
  },
  vm: (c) => instance(c, c.plan, isArm(c.plan) ? 'ami_arm64' : 'ami_amd64', Math.max(20, c.storageGb)),
  managed: {
    'api-gateway': (c) => ({
      hcl: [
        resource('aws_apigatewayv2_api', c.id, { name: c.name, protocol_type: 'HTTP' }),
        resource('aws_apigatewayv2_stage', c.id, { api_id: raw(`aws_apigatewayv2_api.${c.id}.id`), name: '$default', auto_deploy: true }),
      ].join('\n'),
      outputs: { [`${c.id}_url`]: { value: `aws_apigatewayv2_api.${c.id}.api_endpoint`, description: `Public URL of ${c.node.name}` } },
    }),
    'load-balancer': (c) => {
      c.use('network')
      const name = short(c.name, 32)
      return {
        hcl: [
          resource('aws_lb', c.id, { name, load_balancer_type: 'application', subnets: SUBNETS, security_groups: SG }),
          resource('aws_lb_target_group', c.id, {
            name, port: c.port ?? 80, protocol: 'HTTP', target_type: 'ip', vpc_id: raw('aws_vpc.this.id'),
            health_check: nested({ path: String(c.node.config.healthPath ?? '/') }),
          }),
          resource('aws_lb_listener', c.id, {
            load_balancer_arn: raw(`aws_lb.${c.id}.arn`), port: 80, protocol: 'HTTP',
            default_action: nested({ type: 'forward', target_group_arn: raw(`aws_lb_target_group.${c.id}.arn`) }),
          }),
        ].join('\n'),
        outputs: {
          [`${c.id}_dns_name`]: { value: `aws_lb.${c.id}.dns_name`, description: `Public address of ${c.node.name}` },
          [`${c.id}_target_group_arn`]: { value: `aws_lb_target_group.${c.id}.arn`, description: `Target group to register the ${c.node.name} backends in` },
        },
      }
    },
    cdn: (c) => ({
      hcl: resource('aws_cloudfront_distribution', c.id, {
        enabled: true,
        comment: c.name,
        price_class: 'PriceClass_100',
        origin: nested({
          domain_name: raw(`var.${c.id}_origin`),
          origin_id: 'origin',
          custom_origin_config: nested({ http_port: 80, https_port: 443, origin_protocol_policy: 'https-only', origin_ssl_protocols: ['TLSv1.2'] }),
        }),
        default_cache_behavior: nested({
          target_origin_id: 'origin',
          viewer_protocol_policy: 'redirect-to-https',
          allowed_methods: ['GET', 'HEAD', 'OPTIONS'],
          cached_methods: ['GET', 'HEAD'],
          cache_policy_id: '658327ea-f89d-4fab-a63d-7e88639e58f6',
        }),
        restrictions: nested({ geo_restriction: nested({ restriction_type: 'none' }) }),
        viewer_certificate: nested({ cloudfront_default_certificate: true }),
      }),
      variables: block('variable', [`${c.id}_origin`], { type: raw('string'), description: `Domain ${c.node.name} fetches content from, like api.example.com or a load balancer address.` }),
      outputs: { [`${c.id}_domain`]: { value: `aws_cloudfront_distribution.${c.id}.domain_name`, description: `CloudFront address of ${c.node.name}` } },
    }),
    dns: (c) => (c.use('domain'), {
      hcl: resource('aws_route53_zone', c.id, { name: raw('var.domain') }),
      outputs: { [`${c.id}_name_servers`]: { value: `aws_route53_zone.${c.id}.name_servers`, description: 'Name servers to set at your registrar' } },
    }),
    waf: (c) => {
      const visibility = (metric: string) => nested({ cloudwatch_metrics_enabled: true, metric_name: metric, sampled_requests_enabled: true })
      const managedRule = (name: string, priority: number) => nested({
        name, priority,
        override_action: nested({ none: nested({}) }),
        statement: nested({ managed_rule_group_statement: nested({ name, vendor_name: 'AWS' }) }),
        visibility_config: visibility(`${c.id}_${name}`),
      })
      const rules = [managedRule('AWSManagedRulesCommonRuleSet', 1), managedRule('AWSManagedRulesAmazonIpReputationList', 2)]
      if (c.node.config.botProtection === true) rules.push(managedRule('AWSManagedRulesBotControlRuleSet', 3))
      return {
        hcl: resource('aws_wafv2_web_acl', c.id, {
          name: c.name,
          scope: 'REGIONAL',
          default_action: nested({ allow: nested({}) }),
          rule: rules,
          visibility_config: visibility(c.id),
        }),
        outputs: { [`${c.id}_arn`]: { value: `aws_wafv2_web_acl.${c.id}.arn`, description: `Web ACL to attach to a load balancer or API with ${c.node.name}` } },
      }
    },
    kubernetes: (c) => {
      c.use('network')
      const nodes = Math.max(2, c.replicas)
      return {
        hcl: [
          resource('aws_iam_role', `${c.id}_cluster`, { name: `${c.name}-cluster`, assume_role_policy: assume('eks.amazonaws.com') }),
          resource('aws_iam_role_policy_attachment', `${c.id}_cluster`, { role: raw(`aws_iam_role.${c.id}_cluster.name`), policy_arn: 'arn:aws:iam::aws:policy/AmazonEKSClusterPolicy' }),
          resource('aws_eks_cluster', c.id, {
            name: c.name,
            role_arn: raw(`aws_iam_role.${c.id}_cluster.arn`),
            vpc_config: nested({ subnet_ids: SUBNETS }),
            access_config: nested({ authentication_mode: 'API', bootstrap_cluster_creator_admin_permissions: true }),
            depends_on: [raw(`aws_iam_role_policy_attachment.${c.id}_cluster`)],
          }),
          resource('aws_iam_role', `${c.id}_nodes`, { name: `${c.name}-nodes`, assume_role_policy: assume('ec2.amazonaws.com') }),
          resource('aws_iam_role_policy_attachment', `${c.id}_nodes`, {
            for_each: raw('toset(["AmazonEKSWorkerNodePolicy", "AmazonEKS_CNI_Policy", "AmazonEC2ContainerRegistryReadOnly"])'),
            role: raw(`aws_iam_role.${c.id}_nodes.name`),
            policy_arn: raw('"arn:aws:iam::aws:policy/${each.value}"'),
          }),
          resource('aws_eks_node_group', c.id, {
            cluster_name: raw(`aws_eks_cluster.${c.id}.name`),
            node_group_name: 'default',
            node_role_arn: raw(`aws_iam_role.${c.id}_nodes.arn`),
            subnet_ids: SUBNETS,
            instance_types: ['t4g.medium'],
            ami_type: 'AL2023_ARM_64_STANDARD',
            scaling_config: nested({ desired_size: nodes, min_size: 1, max_size: nodes + 2 }),
            depends_on: [raw(`aws_iam_role_policy_attachment.${c.id}_nodes`)],
          }),
        ].join('\n'),
        outputs: {
          [`${c.id}_endpoint`]: { value: `aws_eks_cluster.${c.id}.endpoint`, description: `API server of ${c.node.name}` },
          [`${c.id}_kubeconfig_command`]: { value: `"aws eks update-kubeconfig --region \${${c.region.expr}} --name \${aws_eks_cluster.${c.id}.name}"`, description: `Command that writes a kubeconfig for ${c.node.name}` },
        },
      }
    },
    'service-mesh': 'a service mesh is installed into a Kubernetes cluster, not created as a cloud resource. Add a Kubernetes node and install the mesh there',
    container: (c) => ({
      hcl: [
        taskDefinition(c),
        resource('aws_ecs_service', c.id, {
          name: c.name,
          cluster: raw('aws_ecs_cluster.this.id'),
          task_definition: raw(`aws_ecs_task_definition.${c.id}.arn`),
          desired_count: c.replicas,
          launch_type: 'FARGATE',
          network_configuration: nested({ subnets: SUBNETS, security_groups: SG, assign_public_ip: true }),
        }),
      ].join('\n'),
      outputs: { [`${c.id}_service`]: { value: `aws_ecs_service.${c.id}.name`, description: `ECS service running ${c.node.name}` } },
    }),
    cron: (c) => {
      c.use('scheduler')
      return {
        hcl: [
          taskDefinition(c),
          resource('aws_scheduler_schedule', c.id, {
            name: short(c.name, 64),
            schedule_expression: `cron(${awsCron(String(c.node.config.schedule ?? '0 * * * *'))})`,
            flexible_time_window: nested({ mode: 'OFF' }),
            target: nested({
              arn: raw('aws_ecs_cluster.this.arn'),
              role_arn: raw('aws_iam_role.scheduler.arn'),
              ecs_parameters: nested({
                task_definition_arn: raw(`aws_ecs_task_definition.${c.id}.arn`),
                launch_type: 'FARGATE',
                network_configuration: nested({ subnets: SUBNETS, security_groups: SG, assign_public_ip: true }),
              }),
            }),
          }),
        ].join('\n'),
      }
    },
    serverless: (c) => {
      c.use('lambda')
      const rt = LAMBDA[String(c.node.config.runtime ?? 'node22')] ?? LAMBDA.node22
      const fn = raw(`aws_lambda_function.${c.id}.function_name`)
      return {
        hcl: [
          data('archive_file', c.id, {
            type: 'zip',
            output_path: raw(`"\${path.module}/.build/${c.node.name}.zip"`),
            source: nested({ filename: rt.file, content: rt.code }),
          }),
          resource('aws_lambda_function', c.id, {
            function_name: short(c.name, 64),
            role: raw('aws_iam_role.lambda.arn'),
            runtime: rt.runtime,
            handler: rt.handler,
            memory_size: Number(c.node.config.memoryMb ?? 256),
            timeout: Number(c.node.config.timeoutS ?? 10),
            filename: raw(`data.archive_file.${c.id}.output_path`),
            source_code_hash: raw(`data.archive_file.${c.id}.output_base64sha256`),
            lifecycle: nested({ ignore_changes: [raw('filename'), raw('source_code_hash')] }),
          }),
          resource('aws_lambda_function_url', c.id, { function_name: fn, authorization_type: 'NONE' }),
          resource('aws_lambda_permission', `${c.id}_url`, { statement_id: 'FunctionUrlAllowPublicAccess', action: 'lambda:InvokeFunctionUrl', function_name: fn, principal: '*', function_url_auth_type: 'NONE' }),
          resource('aws_lambda_permission', `${c.id}_invoke`, { statement_id: 'FunctionUrlAllowInvoke', action: 'lambda:InvokeFunction', function_name: fn, principal: '*', invoked_via_function_url: true }),
        ].join('\n'),
        outputs: { [`${c.id}_url`]: { value: `aws_lambda_function_url.${c.id}.function_url`, description: `Public URL of ${c.node.name}. Your pipeline deploys the real code` } },
        requires: ARCHIVE,
      }
    },
    'edge-functions': (c) => ({
      hcl: resource('aws_cloudfront_function', c.id, {
        name: short(c.name, 64),
        runtime: 'cloudfront-js-2.0',
        publish: true,
        code: 'function handler(event) {\n  return event.request\n}\n',
      }),
      outputs: { [`${c.id}_arn`]: { value: `aws_cloudfront_function.${c.id}.arn`, description: `Function to attach to a CloudFront cache behavior for ${c.node.name}` } },
    }),
    postgres: rds('postgres', 'postgresql', ['17', '16', '15']),
    mysql: rds('mysql', 'mysql', ['8.4', '8.0']),
    mariadb: rds('mariadb', 'mysql', ['11.4', '10.11']),
    mongodb: (c) => {
      c.use('network')
      c.use('db_subnets')
      return {
        hcl: [
          password(c),
          resource('aws_docdb_cluster', c.id, {
            cluster_identifier: c.name,
            engine: 'docdb',
            engine_version: '5.0.0',
            master_username: 'app',
            master_password: raw(`random_password.${c.id}.result`),
            db_subnet_group_name: raw('aws_db_subnet_group.this.name'),
            vpc_security_group_ids: SG,
            storage_encrypted: true,
            skip_final_snapshot: true,
          }),
          resource('aws_docdb_cluster_instance', c.id, { identifier: `${short(c.name, 61)}-1`, cluster_identifier: raw(`aws_docdb_cluster.${c.id}.id`), instance_class: 'db.t4g.medium' }),
        ].join('\n'),
        outputs: { [`${c.id}_uri`]: { value: `"mongodb://app:\${random_password.${c.id}.result}@\${aws_docdb_cluster.${c.id}.endpoint}:27017/?tls=true&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false"`, description: `Connection string for ${c.node.name} inside the VPC`, sensitive: true } },
        random: true,
      }
    },
    cassandra: (c) => ({
      hcl: resource('aws_keyspaces_keyspace', c.id, { name: c.name.replace(/-/g, '_').slice(0, 48) }),
      outputs: { [`${c.id}_endpoint`]: { value: inRegion(c, 'cassandra.{region}.amazonaws.com:9142'), description: `Contact point for ${c.node.name}, over TLS with IAM or service credentials` } },
    }),
    dynamodb: (c) => {
      const provisioned = c.node.config.billing === 'provisioned'
      return {
        hcl: resource('aws_dynamodb_table', c.id, {
          name: c.name,
          billing_mode: provisioned ? 'PROVISIONED' : 'PAY_PER_REQUEST',
          read_capacity: provisioned ? 5 : undefined,
          write_capacity: provisioned ? 5 : undefined,
          hash_key: 'pk',
          range_key: 'sk',
          attribute: [nested({ name: 'pk', type: 'S' }), nested({ name: 'sk', type: 'S' })],
          point_in_time_recovery: nested({ enabled: true }),
        }),
        outputs: { [`${c.id}_table`]: { value: `aws_dynamodb_table.${c.id}.name`, description: `Table name of ${c.node.name}` } },
      }
    },
    timeseries: (c) => {
      c.use('network')
      return {
        hcl: [
          password(c),
          resource('aws_timestreaminfluxdb_db_instance', c.id, {
            name: short(c.name, 40),
            db_instance_type: 'db.influx.medium',
            db_storage_type: 'InfluxIOIncludedT1',
            allocated_storage: Math.max(20, c.storageGb),
            username: 'app',
            password: raw(`random_password.${c.id}.result`),
            organization: 'app',
            bucket: 'metrics',
            vpc_subnet_ids: FIRST_SUBNET,
            vpc_security_group_ids: SG,
            publicly_accessible: false,
          }),
        ].join('\n'),
        outputs: {
          [`${c.id}_url`]: { value: `"https://\${aws_timestreaminfluxdb_db_instance.${c.id}.endpoint}:8086"`, description: `InfluxDB address of ${c.node.name} inside the VPC` },
          [`${c.id}_password`]: { value: `random_password.${c.id}.result`, description: `Password of the app user on ${c.node.name}`, sensitive: true },
        },
        random: true,
      }
    },
    'graph-db': (c) => {
      c.use('network')
      c.use('db_subnets')
      return {
        hcl: [
          resource('aws_neptune_cluster', c.id, {
            cluster_identifier: c.name,
            engine: 'neptune',
            neptune_subnet_group_name: raw('aws_db_subnet_group.this.name'),
            vpc_security_group_ids: SG,
            storage_encrypted: true,
            skip_final_snapshot: true,
          }),
          resource('aws_neptune_cluster_instance', c.id, { identifier: `${short(c.name, 61)}-1`, cluster_identifier: raw(`aws_neptune_cluster.${c.id}.id`), instance_class: 'db.t4g.medium', engine: 'neptune' }),
        ].join('\n'),
        outputs: { [`${c.id}_url`]: { value: `"wss://\${aws_neptune_cluster.${c.id}.endpoint}:8182/gremlin"`, description: `Gremlin address of ${c.node.name} inside the VPC` } },
      }
    },
    'vector-db': opensearch,
    search: opensearch,
    redis: (c) => {
      c.use('network')
      c.use('cache_subnets')
      return {
        hcl: resource('aws_elasticache_replication_group', c.id, {
          replication_group_id: short(c.name, 40),
          description: `${c.node.name} for ${c.prefix}`,
          engine: 'valkey',
          engine_version: '8.0',
          node_type: 'cache.t4g.micro',
          num_cache_clusters: 1,
          port: 6379,
          subnet_group_name: raw('aws_elasticache_subnet_group.this.name'),
          security_group_ids: SG,
          at_rest_encryption_enabled: true,
          transit_encryption_enabled: true,
        }),
        outputs: { [`${c.id}_url`]: { value: `"rediss://\${aws_elasticache_replication_group.${c.id}.primary_endpoint_address}:6379"`, description: `Address of ${c.node.name} inside the VPC` } },
      }
    },
    memcached: (c) => {
      c.use('network')
      c.use('cache_subnets')
      return {
        hcl: resource('aws_elasticache_cluster', c.id, {
          cluster_id: short(c.name, 40),
          engine: 'memcached',
          node_type: 'cache.t4g.micro',
          num_cache_nodes: 1,
          port: 11211,
          subnet_group_name: raw('aws_elasticache_subnet_group.this.name'),
          security_group_ids: SG,
        }),
        outputs: { [`${c.id}_endpoint`]: { value: `aws_elasticache_cluster.${c.id}.configuration_endpoint`, description: `Address of ${c.node.name} inside the VPC` } },
      }
    },
    kafka: (c) => {
      c.use('network')
      return {
        hcl: resource('aws_msk_cluster', c.id, {
          cluster_name: c.name,
          kafka_version: '3.9.x',
          number_of_broker_nodes: 2,
          broker_node_group_info: nested({
            client_subnets: SUBNETS,
            instance_type: 'kafka.t3.small',
            security_groups: SG,
            storage_info: nested({ ebs_storage_info: nested({ volume_size: Math.max(10, c.storageGb) }) }),
          }),
          encryption_info: nested({ encryption_in_transit: nested({ client_broker: 'TLS' }) }),
        }),
        outputs: { [`${c.id}_bootstrap`]: { value: `aws_msk_cluster.${c.id}.bootstrap_brokers_tls`, description: `Bootstrap servers of ${c.node.name}, over TLS` } },
      }
    },
    rabbitmq: (c) => {
      c.use('network')
      return {
        hcl: [
          password(c, 24),
          resource('aws_mq_broker', c.id, {
            broker_name: short(c.name, 50),
            engine_type: 'RabbitMQ',
            engine_version: '3.13',
            host_instance_type: 'mq.t3.micro',
            deployment_mode: 'SINGLE_INSTANCE',
            auto_minor_version_upgrade: true,
            publicly_accessible: false,
            subnet_ids: FIRST_SUBNET,
            security_groups: SG,
            user: nested({ username: 'app', password: raw(`random_password.${c.id}.result`) }),
          }),
        ].join('\n'),
        outputs: { [`${c.id}_uri`]: { value: `replace(aws_mq_broker.${c.id}.instances[0].endpoints[0], "amqps://", "amqps://app:\${random_password.${c.id}.result}@")`, description: `AMQP connection string for ${c.node.name} inside the VPC`, sensitive: true } },
        random: true,
      }
    },
    queue: (c) => {
      const dlq = c.node.config.dlq !== false
      const visibility = parseInt(String(c.node.config.visibilityTimeout ?? '30'), 10) || 30
      return {
        hcl: [
          dlq ? resource('aws_sqs_queue', `${c.id}_dlq`, { name: `${short(c.name, 76)}-dlq`, message_retention_seconds: 1209600 }) : '',
          resource('aws_sqs_queue', c.id, {
            name: short(c.name, 80),
            visibility_timeout_seconds: visibility,
            redrive_policy: dlq ? raw(`jsonencode({ deadLetterTargetArn = aws_sqs_queue.${c.id}_dlq.arn, maxReceiveCount = 5 })`) : undefined,
          }),
        ].filter(Boolean).join('\n'),
        outputs: { [`${c.id}_url`]: { value: `aws_sqs_queue.${c.id}.url`, description: `Queue URL of ${c.node.name}` } },
      }
    },
    pubsub: (c) => ({
      hcl: resource('aws_sns_topic', c.id, { name: c.name }),
      outputs: { [`${c.id}_arn`]: { value: `aws_sns_topic.${c.id}.arn`, description: `Topic ARN of ${c.node.name}` } },
    }),
    'object-storage': (c) => {
      const pub = c.node.config.publicRead === true
      const bucket = raw(`aws_s3_bucket.${c.id}.id`)
      return {
        hcl: [
          resource('aws_s3_bucket', c.id, { bucket_prefix: `${short(c.name, 36)}-` }),
          c.node.config.versioning !== false ? resource('aws_s3_bucket_versioning', c.id, { bucket, versioning_configuration: nested({ status: 'Enabled' }) }) : '',
          resource('aws_s3_bucket_public_access_block', c.id, { bucket, block_public_acls: true, ignore_public_acls: true, block_public_policy: !pub, restrict_public_buckets: !pub }),
          pub ? resource('aws_s3_bucket_policy', c.id, {
            bucket,
            policy: raw(`jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = "*", Action = "s3:GetObject", Resource = "\${aws_s3_bucket.${c.id}.arn}/*" }]
  })`),
            depends_on: [raw(`aws_s3_bucket_public_access_block.${c.id}`)],
          }) : '',
        ].filter(Boolean).join('\n'),
        outputs: {
          [`${c.id}_bucket`]: { value: `aws_s3_bucket.${c.id}.id`, description: `Bucket name of ${c.node.name}` },
          [`${c.id}_endpoint`]: { value: `"https://\${aws_s3_bucket.${c.id}.bucket_regional_domain_name}"`, description: `Address of the ${c.node.name} bucket` },
        },
      }
    },
    'block-storage': (c) => (c.use('network'), {
      hcl: resource('aws_ebs_volume', c.id, {
        availability_zone: raw('data.aws_availability_zones.available.names[0]'),
        size: Math.max(1, Number(c.node.config.sizeGb ?? c.storageGb)),
        type: 'gp3',
        encrypted: true,
        tags: { Name: c.name },
      }),
      outputs: { [`${c.id}_id`]: { value: `aws_ebs_volume.${c.id}.id`, description: `Volume ID of ${c.node.name}, in the zone of the first subnet` } },
    }),
    llm: (c) => ({ hcl: '', outputs: { [`${c.id}_endpoint`]: { value: inRegion(c, 'https://bedrock-runtime.{region}.amazonaws.com'), description: `Bedrock runtime endpoint for ${c.node.name}. Turn on model access in the Bedrock console` } } }),
    gpu: (c) => instance(c, 'g6.xlarge', 'ami_gpu', 100),
    monitoring: (c) => {
      c.use('alerts')
      const widget = (y: number, title: string, search: string) =>
        `{ type = "metric", x = 0, y = ${y}, width = 12, height = 6, properties = { title = "${title}", region = ${c.region.expr}, period = 300, metrics = [[{ expression = "SEARCH('${search}', 'Average', 300)", id = "e${y}" }]] } }`
      return {
        hcl: resource('aws_cloudwatch_dashboard', c.id, {
          dashboard_name: c.name,
          dashboard_body: raw(`jsonencode({
    widgets = [
      ${widget(0, 'EC2 CPU', '{AWS/EC2,InstanceId} MetricName=\\"CPUUtilization\\"')},
      ${widget(6, 'ECS CPU', '{AWS/ECS,ClusterName,ServiceName} MetricName=\\"CPUUtilization\\"')},
    ]
  })`),
        }),
      }
    },
    prometheus: (c) => ({
      hcl: resource('aws_prometheus_workspace', c.id, { alias: c.name }),
      outputs: { [`${c.id}_endpoint`]: { value: `aws_prometheus_workspace.${c.id}.prometheus_endpoint`, description: `Remote write and query endpoint of ${c.node.name}` } },
    }),
    logging: (c) => ({
      hcl: resource('aws_cloudwatch_log_group', c.id, { name: `/${c.prefix}/${c.node.name}`, retention_in_days: retentionDays(c.node.config.retention, 14) }),
      outputs: { [`${c.id}_log_group`]: { value: `aws_cloudwatch_log_group.${c.id}.name`, description: `Log group for ${c.node.name}` } },
    }),
    tracing: (c) => ({
      hcl: resource('aws_xray_sampling_rule', c.id, {
        rule_name: short(c.name, 32),
        priority: 1000,
        version: 1,
        fixed_rate: 0.05,
        reservoir_size: 1,
        service_name: '*',
        service_type: '*',
        host: '*',
        http_method: '*',
        url_path: '*',
        resource_arn: '*',
      }),
      outputs: { [`${c.id}_endpoint`]: { value: inRegion(c, 'https://xray.{region}.amazonaws.com'), description: `X-Ray endpoint for ${c.node.name}. Send OTLP traces through the ADOT collector` } },
    }),
    auth: (c) => {
      const mfa = c.node.config.mfa !== false
      const pool: Body = {
        name: c.name,
        username_attributes: ['email'],
        auto_verified_attributes: ['email'],
        mfa_configuration: mfa ? 'OPTIONAL' : 'OFF',
        software_token_mfa_configuration: mfa ? nested({ enabled: true }) : undefined,
      }
      return {
        hcl: [
          resource('aws_cognito_user_pool', c.id, pool),
          resource('aws_cognito_user_pool_client', c.id, {
            name: c.node.name,
            user_pool_id: raw(`aws_cognito_user_pool.${c.id}.id`),
            explicit_auth_flows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
          }),
        ].join('\n'),
        outputs: {
          [`${c.id}_issuer`]: { value: `"https://\${aws_cognito_user_pool.${c.id}.endpoint}"`, description: `OIDC issuer of ${c.node.name}` },
          [`${c.id}_client_id`]: { value: `aws_cognito_user_pool_client.${c.id}.id`, description: `App client ID for ${c.node.name}` },
        },
      }
    },
    secrets: (c) => ({
      hcl: resource('aws_secretsmanager_secret', c.id, { name: c.name, recovery_window_in_days: 7 }),
      outputs: { [`${c.id}_arn`]: { value: `aws_secretsmanager_secret.${c.id}.arn`, description: `Secret ARN of ${c.node.name}` } },
    }),
    email: (c) => (c.use('domain'), {
      hcl: resource('aws_sesv2_email_identity', c.id, { email_identity: raw('var.domain') }),
      outputs: {
        [`${c.id}_dkim_tokens`]: { value: `aws_sesv2_email_identity.${c.id}.dkim_signing_attributes[0].tokens`, description: 'Add a CNAME for each token: <token>._domainkey.<domain> pointing to <token>.dkim.amazonses.com' },
        [`${c.id}_smtp_host`]: { value: inRegion(c, 'email-smtp.{region}.amazonaws.com'), description: `SMTP host for ${c.node.name}` },
      },
    }),
  },
}
