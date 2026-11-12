import { GraphBuilder, api, block, db, defaultObservability, env, op, page, project, table, type } from '../domain/builders'
import { uid } from '../domain/builders'

export function saasTemplate() {
  const g = new GraphBuilder('aws', 'eu-central-1')
  const web = g.add('web-app', 'dashboard', 0, 160, { config: { framework: 'Next.js', rendering: 'SSR', trafficRps: 350 } })
  const cli = g.add('cli', 'sdk-cli', 0, 380, { config: { language: 'Go', trafficRps: 40 } })
  const cdn = g.add('cdn', 'edge', 270, 20, { provider: 'cloudflare' })
  const gw = g.add('api-gateway', 'gateway', 290, 230, { config: { engine: 'Envoy', auth: 'OAuth2 / OIDC' } })
  const gql = g.add('service', 'graph-api', 600, 120, { config: { language: 'TypeScript', framework: 'Apollo Server', apiStyle: 'graphql', port: 4000, cpu: '1', memory: '1Gi' }, replicas: 3 })
  const rest = g.add('service', 'public-api', 600, 330, { config: { language: 'Go', framework: 'chi', apiStyle: 'rest', port: 8080 } })
  const billing = g.add('service', 'billing', 600, 540, { config: { language: 'Python', framework: 'FastAPI', apiStyle: 'webhook', port: 8000 } })
  const idp = g.add('auth-service', 'identity', 290, 470, { config: { engine: 'Zitadel' } })
  const pg = g.add('postgres', 'core-db', 940, 120, { config: { highAvailability: true, storageGb: 200 } })
  const cache = g.add('redis', 'cache', 940, 330)
  const q = g.add('queue', 'jobs', 940, 520)
  const worker = g.add('worker', 'job-runner', 1210, 520, { config: { language: 'Python', concurrency: 16 } })
  const files = g.add('object-storage', 'uploads', 1210, 300, { config: { bucket: 'tenant-uploads' } })
  const mail = g.add('email', 'mailer', 1460, 470, { mode: 'external', config: { provider: 'Postmark' } })
  const pay = g.add('payments', 'stripe', 940, 700, { mode: 'external' })
  const otel = g.add('otel-collector', 'telemetry', 1210, 80)
  g.link(web, gw).link(cli, gw).link(web, cdn).link(gw, gql).link(gw, rest).link(gw, billing).link(gw, idp)
    .link(gql, pg).link(gql, cache).link(gql, q).link(gql, files).link(rest, pg).link(rest, cache).link(billing, pay).link(billing, pg)
    .link(q, worker, 'sub').link(worker, mail).link(worker, files).link(worker, pg).link(gql, otel).link(rest, otel)

  const types = [
    type('Workspace', 'id: ID!, name: String!, slug: String!, plan: Plan!, members: [Member!]!, projects: [Project!]!'),
    type('Member', 'id: ID!, user: User!, role: Role!'),
    type('User', 'id: ID!, email: String!, name: String'),
    type('Project', 'id: ID!, name: String!, tasks: [Task!]!, createdAt: DateTime!'),
    type('Task', 'id: ID!, title: String!, status: TaskStatus!, assignee: User, due: DateTime'),
    type('Plan', 'FREE: _, TEAM: _, ENTERPRISE: _', 'enum'),
    type('TaskStatus', 'TODO: _, DOING: _, DONE: _', 'enum'),
    type('Role', 'OWNER: _, ADMIN: _, MEMBER: _', 'enum'),
    type('CreateTaskInput', 'projectId: ID!, title: String!, assigneeId: ID, due: DateTime', 'input'),
  ]
  const apis = {
    [gql.id]: api(gql.id, 'graphql', 'TypeScript', 'Apollo Server', '/graphql', [
      op('query', 'workspace', 'Workspace by slug', 'user', ['auth.session', 'policy member', 'dataloader workspaces', 'return'], { input: 'slug: String!', output: 'Workspace' }),
      op('query', 'projects', 'Projects in a workspace', 'user', ['auth.session', 'cache.get projects:{ws}', 'db.projects.list', 'return'], { input: 'workspaceId: ID!', output: '[Project!]!' }),
      op('mutation', 'createTask', 'Create a task', 'user', ['auth.session', 'validate CreateTaskInput', 'db.tasks.insert', 'queue.send task.created', 'return'], { input: 'input: CreateTaskInput!', output: 'Task' }),
      op('mutation', 'inviteMember', 'Invite by email', 'admin', ['auth.session', 'policy admin', 'db.invites.insert', 'queue.send invite.email', 'return'], { input: 'email: String!, role: Role!', output: 'Member' }),
      op('subscription', 'taskUpdated', 'Live task changes', 'user', ['auth.session', 'pubsub.subscribe tasks:{project}'], { input: 'projectId: ID!', output: 'Task', streaming: 'server' }),
    ], types),
    [rest.id]: api(rest.id, 'rest', 'Go', 'chi', '/v1', [
      op('GET /v1/projects', 'listProjects', 'List projects', 'api-key', ['auth.apiKey', 'rate.limit 600/min', 'db.projects.list', 'respond 200'], { output: 'Project[]', cache: '30s' }),
      op('POST /v1/projects/{id}/tasks', 'createTask', 'Create task', 'api-key', ['auth.apiKey', 'validate CreateTask', 'db.tasks.insert', 'respond 201'], { input: 'CreateTask', output: 'Task' }),
      op('GET /v1/tasks/{id}', 'getTask', 'Get task', 'api-key', ['auth.apiKey', 'db.tasks.find', 'respond 200'], { output: 'Task' }),
    ]),
    [billing.id]: api(billing.id, 'webhook', 'Python', 'FastAPI', '/webhooks', [
      op('POST /webhooks/stripe', 'stripeEvent', 'Stripe events', 'service', ['verify signature', 'switch event.type', 'db.subscriptions.upsert', 'respond 200']),
      op('POST /billing/portal', 'portalSession', 'Customer portal link', 'admin', ['auth.session', 'stripe.billingPortal.create', 'respond 200']),
    ]),
  }
  const schema = db(pg.id, [
    table('workspaces', 'id uuid pk, name text, slug text unique, plan enum(free|team|enterprise) default:free, created_at timestamptz', 40, 40),
    table('users', 'id uuid pk, email text unique, name text null, created_at timestamptz', 40, 280),
    table('memberships', 'workspace_id uuid pk ref:workspaces.id cascade, user_id uuid pk ref:users.id cascade, role enum(owner|admin|member)', 340, 160),
    table('projects', 'id uuid pk, workspace_id uuid ref:workspaces.id cascade, name text, created_at timestamptz', 340, 0, ['workspace_id']),
    table('tasks', 'id uuid pk, project_id uuid ref:projects.id cascade, title text, status enum(todo|doing|done) default:todo, assignee_id uuid null ref:users.id setnull, due timestamptz null, created_at timestamptz', 640, 40, ['project_id+status']),
    table('subscriptions', 'id uuid pk, workspace_id uuid ref:workspaces.id unique, stripe_customer text unique, status text, current_period_end timestamptz', 640, 330),
  ])
  const pages = [
    page(web.id, 'Overview', '/[workspace]', [block('navbar', { brand: 'Taskline', links: 'Projects, Members, Settings' }), block('stats', { items: 'Open tasks:128, Due this week:23, Members:14' }), block('table', { title: 'Recent tasks', source: `${gql.id}:projects` })]),
    page(web.id, 'Project', '/[workspace]/p/[id]', [block('navbar', { brand: 'Taskline' }), block('kanban', { columns: 'Todo, Doing, Done', source: `${gql.id}:projects` })]),
    page(web.id, 'Settings', '/[workspace]/settings', [block('navbar', { brand: 'Taskline' }), block('form', { title: 'Workspace', fields: 'Name, Slug', submit: 'Save', action: `${gql.id}:inviteMember` })], { access: 'admin' }),
    page(web.id, 'Pricing', '/pricing', [block('navbar', { brand: 'Taskline' }), block('hero', { headline: 'Plan less. Ship more.', sub: 'Projects, tasks and docs for teams that move fast.', cta: 'Start free' }), block('pricing', { tiers: 'Free:$0, Team:$12, Enterprise:Contact' })], { render: 'ssg' }),
  ]
  return project({
    id: uid('p'), name: 'taskline', icon: '◆', description: 'Multi-tenant project-management SaaS with a GraphQL API, public REST API and Stripe billing.',
    nodes: g.nodes, edges: g.edges, apis, databases: { [pg.id]: schema }, pages,
    environments: [
      env('dev', 'Development', 'self', 'onprem', { scale: 0.5, strategy: 'recreate', autoRollback: false }),
      env('staging', 'Staging', 'aws', 'eu-central-1', { secrets: ['STRIPE_SECRET', 'POSTMARK_TOKEN'] }),
      env('prod', 'Production', 'aws', 'eu-central-1', { scale: 2, strategy: 'canary', approval: true, secrets: ['STRIPE_SECRET', 'POSTMARK_TOKEN'] }),
    ],
    observability: { ...defaultObservability(), slos: [{ id: uid('slo'), nodeId: gql.id, name: 'GraphQL availability', metric: 'availability', target: 99.9, window: '30d' }, { id: uid('slo'), nodeId: gql.id, name: 'GraphQL p99 < 300ms', metric: 'latency_p99', target: 300, window: '7d' }],
      alerts: [{ id: uid('al'), nodeId: gql.id, name: 'High error rate', expr: 'error_rate > 2% for 5m', severity: 'critical', channel: '#oncall', enabled: true }, { id: uid('al'), nodeId: pg.id, name: 'DB connections saturated', expr: 'pg_connections / max > 0.9', severity: 'warning', channel: '#platform', enabled: true }] },
  })
}
