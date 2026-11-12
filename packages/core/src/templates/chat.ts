import { GraphBuilder, api, block, db, defaultObservability, env, op, page, project, table, type, uid } from '../domain/builders'

export function chatTemplate() {
  const g = new GraphBuilder('hetzner', 'fsn1')
  const mobile = g.add('mobile-app', 'chat-mobile', 0, 120, { config: { framework: 'Flutter', trafficRps: 600 } })
  const web = g.add('web-app', 'chat-web', 0, 340, { config: { framework: 'SvelteKit', rendering: 'SPA', trafficRps: 250 } })
  const proxy = g.add('reverse-proxy', 'edge-proxy', 280, 230, { mode: 'self-hosted' })
  const rt = g.add('service', 'realtime', 560, 100, { mode: 'self-hosted', config: { language: 'Elixir', framework: 'Phoenix', apiStyle: 'websocket', port: 4000, memory: '2Gi' }, replicas: 3 })
  const apiSvc = g.add('service', 'chat-api', 560, 330, { mode: 'self-hosted', config: { language: 'Rust', framework: 'Axum', apiStyle: 'rest', port: 8080 } })
  const nats = g.add('nats', 'bus', 860, 60, { mode: 'self-hosted' })
  const presence = g.add('redis', 'presence', 860, 220, { mode: 'self-hosted', config: { engine: 'Valkey' } })
  const msgs = g.add('cassandra', 'messages', 860, 380, { mode: 'self-hosted' })
  const pg = g.add('postgres', 'accounts-db', 860, 560, { mode: 'self-hosted' })
  const media = g.add('object-storage', 'media', 560, 560, { mode: 'managed', config: { bucket: 'chat-media' } })
  const push = g.add('worker', 'push-notifier', 1140, 60, { mode: 'self-hosted', config: { language: 'Go' } })
  const search = g.add('meilisearch', 'msg-search', 1140, 300, { mode: 'self-hosted' })
  g.link(mobile, proxy).link(web, proxy).link(proxy, rt).link(proxy, apiSvc).link(rt, nats).link(rt, presence).link(rt, msgs)
    .link(apiSvc, msgs).link(apiSvc, pg).link(apiSvc, media).link(apiSvc, search).link(nats, push, 'sub').link(rt, mobile, 'out', 'push').link(rt, web, 'out', 'push')
  const apis = {
    [rt.id]: api(rt.id, 'websocket', 'Elixir', 'Phoenix', '/socket', [
      op('join room:{id}', 'joinRoom', 'Join a conversation', 'user', ['auth.token', 'policy member', 'presence.track', 'reply ok']),
      op('push message:new', 'sendMessage', 'Send a message', 'user', ['validate Message', 'db.messages.insert', 'bus.publish msg.{room}', 'broadcast']),
      op('push typing', 'typing', 'Typing indicator', 'user', ['throttle 2s', 'broadcast_from']),
      op('event presence_diff', 'presence', 'Who is online', 'user', ['presence.diff'], { streaming: 'server' }),
    ], [type('Message', 'id: ID!, roomId: ID!, author: ID!, body: String!, sentAt: DateTime!')]),
    [apiSvc.id]: api(apiSvc.id, 'rest', 'Rust', 'Axum', '/v1', [
      op('GET /v1/rooms', 'listRooms', 'My rooms', 'user', ['auth.jwt', 'db.rooms.forUser', 'respond 200'], { output: 'Room[]' }),
      op('GET /v1/rooms/{id}/messages', 'history', 'Message history (paged)', 'user', ['auth.jwt', 'policy member', 'db.messages.page', 'respond 200'], { output: 'Message[]', cache: 'none' }),
      op('POST /v1/media', 'upload', 'Presigned upload URL', 'user', ['auth.jwt', 's3.presign PUT', 'respond 201']),
      op('GET /v1/search', 'search', 'Search messages', 'user', ['auth.jwt', 'search.query', 'respond 200']),
    ]),
  }
  const schema = db(pg.id, [
    table('accounts', 'id uuid pk, handle text unique, display_name text, avatar_url text null, created_at timestamptz', 40, 40),
    table('rooms', 'id uuid pk, kind enum(dm|group|channel), title text null, created_at timestamptz', 340, 40),
    table('room_members', 'room_id uuid pk ref:rooms.id cascade, account_id uuid pk ref:accounts.id cascade, role enum(owner|member), muted boolean default:false', 190, 260),
    table('devices', 'id uuid pk, account_id uuid ref:accounts.id cascade, platform enum(ios|android|web), push_token text', 490, 260, ['account_id']),
  ])
  return project({
    id: uid('p'), name: 'relay-chat', icon: '◉', description: 'Realtime chat (WebSockets + REST) self-hosted on Hetzner VPSs.',
    nodes: g.nodes, edges: g.edges, apis, databases: { [pg.id]: schema },
    pages: [page(web.id, 'Chat', '/', [block('chat', { title: 'Relay', source: `${apiSvc.id}:history` })], { render: 'csr', access: 'user' }), page(web.id, 'Sign in', '/login', [block('form', { title: 'Sign in', fields: 'Handle, Password', submit: 'Continue' })], { render: 'csr' })],
    environments: [env('dev', 'Development', 'self', 'onprem', { scale: 0.5, strategy: 'recreate', autoRollback: false }), env('prod', 'Production', 'hetzner', 'fsn1', { strategy: 'rolling', secrets: ['SECRET_KEY_BASE', 'APNS_KEY', 'FCM_KEY'] })],
    observability: { ...defaultObservability(), slos: [{ id: uid('slo'), nodeId: rt.id, name: 'Message delivery p99 < 150ms', metric: 'latency_p99', target: 150, window: '7d' }], alerts: [{ id: uid('al'), nodeId: rt.id, name: 'Socket errors', expr: 'error_rate > 1% for 5m', severity: 'critical', channel: 'pagerduty', enabled: true }] },
  })
}
