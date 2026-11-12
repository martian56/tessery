import { GraphBuilder, api, block, db, defaultObservability, env, op, page, project, table, type, uid } from '../domain/builders'

export function commerceTemplate() {
  const g = new GraphBuilder('digitalocean', 'fra1')
  const web = g.add('web-app', 'storefront', 0, 160, { config: { framework: 'Next.js', rendering: 'ISR', trafficRps: 500 } })
  const mob = g.add('mobile-app', 'shop-app', 0, 380, { config: { framework: 'React Native', trafficRps: 200 } })
  const cdn = g.add('cdn', 'cdn', 270, 0)
  const gw = g.add('api-gateway', 'gateway', 290, 250, { config: { engine: 'Kong' } })
  const catalog = g.add('service', 'catalog', 590, 60, { config: { language: 'TypeScript', framework: 'Fastify', apiStyle: 'rest' } })
  const orders = g.add('service', 'orders', 590, 280, { config: { language: 'Go', framework: 'grpc-go', apiStyle: 'grpc', port: 50051 }, replicas: 3 })
  const users = g.add('service', 'accounts', 590, 500, { config: { language: 'Java', framework: 'Spring Boot', apiStyle: 'rest' } })
  const pg = g.add('postgres', 'shop-db', 900, 160, { config: { highAvailability: true } })
  const cache = g.add('redis', 'cache', 900, 340)
  const search = g.add('elasticsearch', 'product-search', 900, 0)
  const kafka = g.add('kafka', 'events', 900, 500)
  const mail = g.add('worker', 'notifier', 1180, 500, { config: { language: 'Python' } })
  const pay = g.add('payments', 'payments', 1180, 280, { mode: 'external' })
  const assets = g.add('object-storage', 'images', 270, 470)
  g.link(web, gw).link(mob, gw).link(web, cdn).link(cdn, assets).link(gw, catalog).link(gw, orders).link(gw, users)
    .link(catalog, pg).link(catalog, cache).link(catalog, search).link(orders, pg).link(orders, kafka).link(orders, pay).link(users, pg).link(users, cache).link(kafka, mail, 'sub')
  const apis = {
    [catalog.id]: api(catalog.id, 'rest', 'TypeScript', 'Fastify', '/v1', [
      op('GET /v1/products', 'listProducts', 'List products', 'public', ['cache.get products:{q}', 'search.query', 'respond 200'], { cache: '60s', output: 'Product[]' }),
      op('GET /v1/products/{slug}', 'getProduct', 'Product detail', 'public', ['cache.get product:{slug}', 'db.products.bySlug', 'respond 200'], { output: 'Product' }),
      op('POST /v1/products', 'createProduct', 'Create product', 'admin', ['auth.jwt', 'validate ProductInput', 'db.products.insert', 'search.index', 'respond 201']),
    ]),
    [orders.id]: api(orders.id, 'grpc', 'Go', 'grpc-go', 'shop.orders.v1.OrderService', [
      op('rpc', 'CreateOrder', 'Place an order', 'user', ['validate', 'db.tx', 'reserve stock', 'payments.intent', 'kafka.publish order.created'], { input: 'CreateOrderRequest', output: 'Order' }),
      op('rpc', 'GetOrder', 'Fetch order', 'user', ['db.orders.find'], { input: 'GetOrderRequest', output: 'Order' }),
      op('rpc', 'WatchOrder', 'Status updates', 'user', ['subscribe order.{id}'], { input: 'GetOrderRequest', output: 'OrderStatus', streaming: 'server' }),
    ], [type('Order', 'id: string!, user_id: string!, status: OrderStatus!, total_cents: int64!, items: [OrderItem!]!'), type('OrderItem', 'product_id: string!, qty: int32!, unit_cents: int64!'), type('CreateOrderRequest', 'items: [OrderItem!]!, address_id: string!', 'input'), type('GetOrderRequest', 'id: string!', 'input'), type('OrderStatus', 'PENDING: _, PAID: _, SHIPPED: _, CANCELLED: _', 'enum')]),
    [users.id]: api(users.id, 'rest', 'Java', 'Spring Boot', '/v1', [
      op('POST /v1/auth/login', 'login', 'Issue tokens', 'public', ['validate', 'db.users.byEmail', 'verify argon2', 'sign jwt', 'respond 200']),
      op('GET /v1/me', 'me', 'Current user', 'user', ['auth.jwt', 'cache.get user:{sub}', 'db.users.find', 'respond 200']),
    ]),
  }
  const schema = db(pg.id, [
    table('users', 'id uuid pk, email text unique, name text, password_hash text, created_at timestamptz', 40, 40),
    table('products', 'id uuid pk, slug text unique, title text, price_cents int, stock int default:0, images text[]', 340, 40),
    table('orders', 'id uuid pk, user_id uuid ref:users.id, status enum(pending|paid|shipped|cancelled) default:pending, total_cents int, created_at timestamptz', 40, 280, ['user_id', 'status']),
    table('order_items', 'order_id uuid pk ref:orders.id cascade, product_id uuid pk ref:products.id, qty int, unit_cents int', 340, 280),
  ])
  return project({
    id: uid('p'), name: 'northwind-store', icon: '◇', description: 'Online store: REST catalog, gRPC orders, Kafka events, on DigitalOcean.',
    nodes: g.nodes, edges: g.edges, apis, databases: { [pg.id]: schema },
    pages: [
      page(web.id, 'Home', '/', [block('banner', { text: 'Free shipping over $100' }), block('navbar', { brand: 'Northwind', links: 'New, Men, Women' }), block('hero', { headline: 'Built to outlast the season.', sub: 'Considered essentials, made in small batches.', cta: 'Shop new arrivals' }), block('grid', { title: 'New arrivals', columns: 4, source: `${catalog.id}:listProducts` }), block('footer', { text: '© 2026 Northwind' })], { render: 'isr' }),
      page(web.id, 'Product', '/p/[slug]', [block('navbar', { brand: 'Northwind' }), block('detail', { source: `${catalog.id}:getProduct`, cta: 'Add to cart' })]),
      page(web.id, 'Cart', '/cart', [block('navbar', { brand: 'Northwind' }), block('cart', { action: `${orders.id}:CreateOrder`, cta: 'Checkout' })], { render: 'csr' }),
    ],
    environments: [env('dev', 'Development', 'self', 'onprem', { scale: 0.5, strategy: 'recreate', autoRollback: false }), env('staging', 'Staging', 'digitalocean', 'fra1'), env('prod', 'Production', 'digitalocean', 'fra1', { scale: 2, strategy: 'canary', approval: true, secrets: ['STRIPE_SECRET', 'JWT_SECRET'] })],
    observability: defaultObservability(),
  })
}
