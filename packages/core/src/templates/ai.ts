import { GraphBuilder, api, block, db, defaultObservability, env, op, page, project, table, type, uid } from '../domain/builders'

export function aiTemplate() {
  const g = new GraphBuilder('gcp', 'europe-west1')
  const web = g.add('web-app', 'assistant-ui', 0, 180, { config: { framework: 'Next.js', rendering: 'SSR', trafficRps: 120 } })
  const ext = g.add('third-party-client', 'slack-bot', 0, 400, { config: { trafficRps: 20 } })
  const gw = g.add('load-balancer', 'lb', 270, 260)
  const chat = g.add('service', 'chat', 540, 140, { config: { language: 'Python', framework: 'FastAPI', apiStyle: 'sse', port: 8000, memory: '1Gi' } })
  const ingest = g.add('service', 'ingest-api', 540, 400, { config: { language: 'TypeScript', framework: 'Hono', apiStyle: 'rest' } })
  const llm = g.add('llm-api', 'claude', 860, 20, { mode: 'external', config: { model: 'claude-sonnet-5-5' } })
  const emb = g.add('embeddings', 'embedder', 860, 200, { mode: 'self-hosted', config: { model: 'bge-m3' } })
  const vec = g.add('qdrant', 'vectors', 1140, 200, { mode: 'self-hosted' })
  const pg = g.add('postgres', 'app-db', 860, 380)
  const q = g.add('queue', 'ingest-jobs', 860, 560)
  const worker = g.add('worker', 'chunker', 1140, 560, { config: { language: 'Python', concurrency: 4 } })
  const files = g.add('object-storage', 'documents', 1140, 400)
  const cache = g.add('redis', 'semantic-cache', 540, 600)
  g.link(web, gw).link(ext, gw).link(gw, chat).link(gw, ingest).link(chat, llm).link(chat, emb).link(chat, vec).link(chat, pg).link(chat, cache)
    .link(ingest, files).link(ingest, q).link(ingest, pg).link(q, worker, 'sub').link(worker, emb).link(worker, vec).link(worker, files)
  const apis = {
    [chat.id]: api(chat.id, 'sse', 'Python', 'FastAPI', '/v1', [
      op('POST /v1/chat', 'chat', 'Ask a question (streams tokens)', 'user', ['auth.session', 'cache.semantic lookup', 'embed query', 'vector.search top_k=8', 'rerank', 'llm.stream with citations', 'db.messages.insert'], { streaming: 'server', input: 'ChatRequest', output: 'stream<Token>' }),
      op('GET /v1/conversations', 'conversations', 'History', 'user', ['auth.session', 'db.conversations.list', 'respond 200']),
    ], [type('ChatRequest', 'conversationId: ID, message: String!, collections: [ID!]')]),
    [ingest.id]: api(ingest.id, 'rest', 'TypeScript', 'Hono', '/v1', [
      op('POST /v1/documents', 'upload', 'Upload a document', 'user', ['auth.session', 's3.put', 'db.documents.insert', 'queue.send ingest', 'respond 202']),
      op('GET /v1/documents/{id}', 'status', 'Ingest status', 'user', ['auth.session', 'db.documents.find', 'respond 200']),
    ]),
  }
  const schema = db(pg.id, [
    table('collections', 'id uuid pk, name text, owner_id uuid, created_at timestamptz', 40, 40),
    table('documents', 'id uuid pk, collection_id uuid ref:collections.id cascade, filename text, status enum(queued|chunking|embedded|failed) default:queued, chunks int default:0, created_at timestamptz', 320, 40, ['collection_id']),
    table('conversations', 'id uuid pk, user_id uuid, title text null, created_at timestamptz', 40, 260),
    table('messages', 'id uuid pk, conversation_id uuid ref:conversations.id cascade, role enum(user|assistant), content text, citations jsonb null, tokens int, created_at timestamptz', 320, 260, ['conversation_id']),
  ])
  return project({
    id: uid('p'), name: 'docs-assistant', icon: '✦', description: 'Retrieval-augmented assistant: streaming chat, document ingest, embeddings and vector search on GCP.',
    nodes: g.nodes, edges: g.edges, apis, databases: { [pg.id]: schema },
    pages: [page(web.id, 'Assistant', '/', [block('navbar', { brand: 'Docs Assistant', links: 'Chat, Collections' }), block('chat', { title: 'Ask anything about your docs', source: `${chat.id}:chat` })], { access: 'user' }), page(web.id, 'Collections', '/collections', [block('navbar', { brand: 'Docs Assistant' }), block('table', { title: 'Documents', source: `${ingest.id}:status` }), block('upload', { label: 'Drop PDFs, Markdown or HTML', action: `${ingest.id}:upload` })], { access: 'user' })],
    environments: [env('dev', 'Development', 'self', 'onprem', { scale: 0.5, strategy: 'recreate', autoRollback: false }), env('prod', 'Production', 'gcp', 'europe-west1', { strategy: 'canary', approval: true, secrets: ['ANTHROPIC_API_KEY'] })],
    observability: { ...defaultObservability(), traces: 'Cloud Trace', slos: [{ id: uid('slo'), nodeId: chat.id, name: 'Time to first token < 1.5s', metric: 'latency_p99', target: 1500, window: '7d' }] },
  })
}
