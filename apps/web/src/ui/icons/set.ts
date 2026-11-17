// Tessery's icon set. Every icon is drawn on a 20 by 20 grid with 1.5px rounded strokes in the current colour, so
// one drawing language covers the sidebar, the workspace and every technology a design can use. Values are the
// inner markup of the SVG; small solid details use fill="currentColor".

const dot = (x: number, y: number, r = 0.9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`
const cylinder = `<ellipse cx="10" cy="5" rx="6" ry="2.2"/><path d="M4 5v10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5"/>`
const band = (y: number) => `<path d="M4 ${y}c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2"/>`
const lens = `<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2 17 17"/>`

/** Sidebar and app destinations. */
export const NAV_ICONS: Record<string, string> = {
  projects: `<rect x="3" y="3" width="6" height="6" rx="1.6"/><rect x="11" y="3" width="6" height="6" rx="1.6"/><rect x="3" y="11" width="6" height="6" rx="1.6"/><rect x="11" y="11" width="6" height="6" rx="3"/>`,
  search: `<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>`,
  general: `<rect x="4" y="2.8" width="12" height="14.4" rx="2"/><path d="M7.5 6.5h1M11.5 6.5h1M7.5 9.5h1M11.5 9.5h1M8.5 17.2v-3.2h3v3.2"/>`,
  members: `<circle cx="7.5" cy="7" r="2.6"/><path d="M2.8 16.2c.4-2.6 2.3-4.2 4.7-4.2s4.3 1.6 4.7 4.2"/><circle cx="13.6" cy="6.4" r="2.1"/><path d="M14.4 11.1c1.6.3 2.6 1.6 2.9 3.6"/>`,
  teams: `<circle cx="10" cy="6" r="2.4"/><circle cx="4.6" cy="8.4" r="1.7"/><circle cx="15.4" cy="8.4" r="1.7"/><path d="M5.6 16c.4-2.6 2.2-4.2 4.4-4.2s4 1.6 4.4 4.2M2.4 14.6c.3-1.4 1.1-2.4 2.3-2.7M17.6 14.6c-.3-1.4-1.1-2.4-2.3-2.7"/>`,
  servers: `<rect x="3" y="3.2" width="14" height="5.6" rx="1.6"/><rect x="3" y="11.2" width="14" height="5.6" rx="1.6"/>${dot(6.2, 6)}${dot(6.2, 14)}<path d="M10 6h4M10 14h4"/>`,
  integrations: `<path d="M7 2.8v3.4M13 2.8v3.4"/><rect x="4.8" y="6.2" width="10.4" height="5.2" rx="2"/><path d="M10 11.4v2.4a3 3 0 0 1-3 3"/>`,
  roles: `<circle cx="6.8" cy="10" r="3.2"/><path d="M10 10h7.2M14.4 10v2.6M16.8 10v1.8"/>`,
  access: `<path d="M10 2.6l6 2.3v4.7c0 3.7-2.5 6.4-6 7.8-3.5-1.4-6-4.1-6-7.8V4.9z"/><path d="M7.4 9.8l1.8 1.8 3.5-3.6"/>`,
  audit: `<rect x="4" y="2.8" width="12" height="14.4" rx="2"/><path d="M7.2 6.8h5.6M7.2 9.8h5.6M7.2 12.8h3"/>`,
  users: `<circle cx="10" cy="6.8" r="3"/><path d="M4.4 16.6c.6-3 2.8-4.6 5.6-4.6s5 1.6 5.6 4.6"/>`,
  orgs: `<rect x="2.8" y="7" width="6" height="10.2" rx="1.4"/><rect x="8.8" y="2.8" width="8.4" height="14.4" rx="1.6"/><path d="M11.6 6.4h.8M14 6.4h.8M11.6 9.4h.8M14 9.4h.8M11.6 12.4h.8M14 12.4h.8M5.2 10.4h1.2M5.2 13.4h1.2"/>`,
  email: `<rect x="2.8" y="4.4" width="14.4" height="11.2" rx="2"/><path d="M3.4 5.8l6.6 5 6.6-5"/>`,
  github: `<circle cx="6" cy="4.8" r="1.8"/><circle cx="6" cy="15.2" r="1.8"/><circle cx="14" cy="6.8" r="1.8"/><path d="M6 6.6v6.8M14 8.6v.6c0 2-1.4 3.2-3.4 3.2H8.2c-1.2 0-2.2.7-2.2 1.6"/>`,
  settings: `<path d="M3.5 6h7.5M15.5 6h1"/><circle cx="13.2" cy="6" r="1.8"/><path d="M3.5 14h1.6M9.5 14h7"/><circle cx="7.3" cy="14" r="1.8"/>`,
  account: `<circle cx="10" cy="10" r="7.2"/><circle cx="10" cy="8.4" r="2.4"/><path d="M5.4 15.4c.9-1.9 2.6-2.9 4.6-2.9s3.7 1 4.6 2.9"/>`,
  collapse: `<rect x="2.8" y="3.6" width="14.4" height="12.8" rx="2"/><path d="M7.6 3.6v12.8M13.4 8l-2 2 2 2"/>`,
  expand: `<rect x="2.8" y="3.6" width="14.4" height="12.8" rx="2"/><path d="M7.6 3.6v12.8M11.4 8l2 2-2 2"/>`,
  design: `<circle cx="5" cy="5.4" r="2.2"/><circle cx="15" cy="10" r="2.2"/><circle cx="5" cy="14.6" r="2.2"/><path d="M7 6.3l5.9 2.8M7 13.7l5.9-2.8"/>`,
  api: `<path d="M7 3.4c-1.6 0-2.4.8-2.4 2.4v1.8c0 1.2-.6 1.9-1.8 2.4 1.2.5 1.8 1.2 1.8 2.4v1.8c0 1.6.8 2.4 2.4 2.4M13 3.4c1.6 0 2.4.8 2.4 2.4v1.8c0 1.2.6 1.9 1.8 2.4-1.2.5-1.8 1.2-1.8 2.4v1.8c0 1.6-.8 2.4-2.4 2.4"/>${dot(10, 10, 1)}`,
  database: `${cylinder}${band(10)}`,
  pages: `<rect x="2.8" y="3.6" width="14.4" height="12.8" rx="2"/><path d="M2.8 7.4h14.4M7.6 7.4v9"/>`,
  deploy: `<path d="M10 13V3.2M6.4 6.8 10 3.2l3.6 3.6"/><path d="M3.4 12.4v2.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2v-2.6"/>`,
  observe: `<path d="M2.6 10.4h3l2-4.6 3.6 8.6 2-4h4.2"/>`,
  activity: `<circle cx="10" cy="10" r="7.2"/><path d="M10 5.8V10l2.8 1.8"/>`,
  add: `<path d="M10 4v12M4 10h12"/>`,
}

/** One pictogram per technology a design can use. */
export const TECH_ICONS: Record<string, string> = {
  // Clients
  'web-app': `<rect x="2.6" y="3.8" width="14.8" height="12.4" rx="2"/><path d="M2.6 7.4h14.8"/>${dot(5.2, 5.6, .7)}${dot(7.3, 5.6, .7)}`,
  'mobile-app': `<rect x="5.6" y="2.4" width="8.8" height="15.2" rx="2.2"/><path d="M9 14.8h2"/>`,
  'desktop-app': `<rect x="2.6" y="3.4" width="14.8" height="10" rx="1.8"/><path d="M7.2 16.8h5.6M10 13.4v3.4"/>`,
  cli: `<rect x="2.6" y="3.8" width="14.8" height="12.4" rx="2"/><path d="M6 8.4l2.6 2.2L6 12.8M10.6 12.8h3.4"/>`,
  'iot-device': `<rect x="6" y="6" width="8" height="8" rx="1.6"/><path d="M8.2 3.2V6M11.8 3.2V6M8.2 14v2.8M11.8 14v2.8M3.2 8.2H6M3.2 11.8H6M14 8.2h2.8M14 11.8h2.8"/>${dot(10, 10, 1.1)}`,
  'third-party-client': `<rect x="10.4" y="3.6" width="6.8" height="12.8" rx="1.8"/><path d="M2.8 10h7.6M7.4 7l3 3-3 3"/>`,
  // Network and edge
  'api-gateway': `<path d="M4 17V9.4a6 6 0 0 1 12 0V17M2.4 17h15.2M8 17v-4.4a2 2 0 0 1 4 0V17"/>`,
  'graphql-gateway': `<path d="M10 2.6l6.4 3.7v7.4L10 17.4l-6.4-3.7V6.3z"/>${dot(10, 2.6)}${dot(16.4, 6.3)}${dot(16.4, 13.7)}${dot(10, 17.4)}${dot(3.6, 13.7)}${dot(3.6, 6.3)}<circle cx="10" cy="10" r="2"/>`,
  'load-balancer': `<circle cx="10" cy="4" r="1.6"/><path d="M10 5.6v3M10 8.6 4.8 13.4M10 8.6v4.8M10 8.6l5.2 4.8"/><circle cx="4.6" cy="15.2" r="1.6"/><circle cx="10" cy="15.2" r="1.6"/><circle cx="15.4" cy="15.2" r="1.6"/>`,
  'reverse-proxy': `<path d="M3 7h12M12.2 4.2 15 7l-2.8 2.8M17 13H5M7.8 10.2 5 13l2.8 2.8"/>`,
  cdn: `<circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c2 2.1 2.8 4.5 2.8 7.2s-.8 5.1-2.8 7.2c-2-2.1-2.8-4.5-2.8-7.2S8 4.9 10 2.8"/>`,
  dns: `<path d="M10 2.6v14.8M10 4h5.4l1.6 1.8-1.6 1.8H10M10 9.6H4.6L3 11.4l1.6 1.8H10M7 17.4h6"/>`,
  waf: `<rect x="2.8" y="3.8" width="14.4" height="12.4" rx="1.6"/><path d="M2.8 7.9h14.4M2.8 12.1h14.4M7.6 3.8v4.1M12.4 7.9v4.2M7.6 12.1v4.1"/>`,
  'service-mesh': `<circle cx="4.8" cy="4.8" r="1.7"/><circle cx="15.2" cy="4.8" r="1.7"/><circle cx="4.8" cy="15.2" r="1.7"/><circle cx="15.2" cy="15.2" r="1.7"/><circle cx="10" cy="10" r="1.7"/><path d="M6.5 4.8h7M6.5 15.2h7M4.8 6.5v7M15.2 6.5v7M6.1 6.1l2.7 2.7M13.9 6.1l-2.7 2.7M6.1 13.9l2.7-2.7M13.9 13.9l-2.7-2.7"/>`,
  // Compute
  service: `<path d="M10 2.6l6.4 3.6v7.6L10 17.4l-6.4-3.6V6.2z"/><path d="M3.6 6.2 10 9.8l6.4-3.6M10 9.8v7.6"/>`,
  worker: `<path d="M15.6 8a6 6 0 0 0-11-1.4M4.4 12a6 6 0 0 0 11 1.4"/><path d="M15.9 4.2v3.9H12M4.1 15.8v-3.9H8"/>`,
  cron: `<circle cx="10" cy="10.6" r="6.4"/><path d="M10 7.2v3.4l2.4 1.6M7.6 2.8h4.8"/>`,
  function: `<path d="M5.4 3.4h2.2l6.8 13.2h-1.2M10.6 9.6 6 16.6"/>`,
  'edge-function': `<path d="M11.2 2.6 4.8 11.2h4.6l-.6 6.2 6.4-8.6h-4.6z"/>`,
  workflow: `<rect x="2.8" y="2.8" width="5.6" height="5.6" rx="1.4"/><rect x="11.6" y="11.6" width="5.6" height="5.6" rx="1.4"/><path d="M8.4 5.6h3.4a2.6 2.6 0 0 1 2.6 2.6v3.4"/>`,
  batch: `<path d="M3 6.4 10 3.2l7 3.2-7 3.2z"/><path d="M3 10l7 3.2 7-3.2M3 13.6l7 3.2 7-3.2"/>`,
  // Databases
  postgres: `${cylinder}${band(8.6)}${band(12.2)}<path d="M16 13.2c1.3.2 2 1 2 2.1 0 .9-.6 1.5-1.4 1.5"/>`,
  mysql: `${cylinder}<path d="M5.6 11.4c1.2-1.2 2.4-1.2 3.6 0s2.4 1.2 3.6 0 2.4-1.2 3.2-.4"/>`,
  mariadb: `${cylinder}<path d="M12.6 9.2a2.8 2.8 0 1 0 0 4.4 2.2 2.2 0 1 1 0-4.4z"/>`,
  sqlite: `<path d="M5 2.8h6.8l3.6 3.6v10.8H5z"/><path d="M11.8 2.8v3.6h3.6M7.6 10.4c0 .8 1.1 1.4 2.4 1.4s2.4-.6 2.4-1.4M7.6 13.4c0 .8 1.1 1.4 2.4 1.4s2.4-.6 2.4-1.4"/>`,
  cockroachdb: `${cylinder}<path d="M7.2 14.4h5.6L10 9.8z" stroke-width="1.2"/>${dot(7.2, 14.4, 1.1)}${dot(12.8, 14.4, 1.1)}${dot(10, 9.8, 1.1)}`,
  mongodb: `<path d="M10 2.4c3 3 4.6 6 4.6 8.8 0 3-1.8 5-4.6 6.4-2.8-1.4-4.6-3.4-4.6-6.4C5.4 8.4 7 5.4 10 2.4z"/><path d="M10 6.4v11.2"/>`,
  cassandra: `<circle cx="10" cy="10" r="2"/>${dot(10, 3.4)}${dot(15.7, 6.7)}${dot(15.7, 13.3)}${dot(10, 16.6)}${dot(4.3, 13.3)}${dot(4.3, 6.7)}<circle cx="10" cy="10" r="6.6" stroke-dasharray="1.6 2.2"/>`,
  dynamodb: `<ellipse cx="8.4" cy="4.6" rx="5" ry="1.9"/><path d="M3.4 4.6v9.6c0 1 2.2 1.9 5 1.9 1 0 1.9-.1 2.6-.3M3.4 8.2c0 1 2.2 1.9 5 1.9M3.4 11.6c0 1 2.2 1.9 5 1.9M13.4 4.6V7"/><path d="M15 6.6l-3 4.6h2.6l-1.4 4.6 3.6-5.4H14.2z"/>`,
  clickhouse: `<path d="M4 16.6V5M7.6 16.6V3.4M11.2 16.6V7.6M14.8 16.6V10.4"/><path d="M2.8 16.6h14.4"/>`,
  timescaledb: `${cylinder}<circle cx="10" cy="12" r="2.6"/><path d="M10 10.8V12l.9.6"/>`,
  influxdb: `<path d="M3 16.8V3.2M3 16.8h14"/><path d="M5.4 12.6l3-3.4 2.6 2.2 4.6-5.2"/>`,
  neo4j: `<circle cx="5" cy="13.8" r="2"/><circle cx="15" cy="13.8" r="2"/><circle cx="10" cy="5" r="2"/><path d="M6 12.1 9 6.7M14 12.1 11 6.7M7 13.8h6"/>`,
  elasticsearch: `${lens}<path d="M6.4 7.4h4.2M6.4 9.6h3"/>`,
  meilisearch: `${lens}<path d="M15.6 3.4l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5z" fill="currentColor"/>`,
  typesense: `<path d="M11 3.6 6.8 10.6h3.6l-1.4 5.8 4.2-7h-3.6z"/>${dot(3.6, 5.2, .8)}${dot(5.4, 3.4, .7)}${dot(16.2, 4.6, .8)}${dot(14.6, 3, .6)}${dot(3.4, 13.4, .8)}${dot(4.8, 16.2, .7)}${dot(16.4, 14.8, .8)}${dot(14.8, 16.8, .6)}<path d="M3.6 5.2 5.4 3.4M16.2 4.6l-1.6-1.6M3.4 13.4l1.4 2.8M16.4 14.8l-1.6 2" stroke-width="1"/>`,
  qdrant: `<path d="M10 2.4l6.6 3.8v7.6L10 17.6l-6.6-3.8V6.2z"/><path d="M10 6.6l3.4 1.9v3.8L10 14.2l-3.4-1.9V8.5z"/><path d="M13.4 12.3v3.4M10 10.4l3.4-1.9M10 10.4v3.8M10 10.4 6.6 8.5" stroke-width="1.2"/>`,
  weaviate: `<path d="M4.4 3.6v9.8l3.6-3c1.2-1 2.8-1 4 0l3.6 3V3.6"/><path d="M4.4 13.4 7.2 16c1.6 1.4 4 1.4 5.6 0l2.8-2.6"/>`,
  pgvector: `${cylinder}<path d="M7 14.2 12.6 9.4M12.6 9.4H9.8M12.6 9.4v2.6"/>`,
  pinecone: `<path d="M7.6 6 10 3.6 12.4 6M10 3.6v4M7.6 10.6 10 8.2l2.4 2.4M10 8.2v4M3.2 9.4l.6-3.4 3.4.2M3.8 6l3.2 3.2M16.8 7.6l.4 3.4-3.4.8M17.2 11l-3.6-1.8M3.4 12.4l-.2 3.4 3.4.8M3.2 15.8l3.4-2.6M12.8 16.8l3.4-.2.6-3.4M16.2 16.6l-3-3.2"/>${dot(9.4, 17.2, 1.2)}`,
  supabase: `<path d="M10.4 2.6 3.6 11.4h6v6l6.8-8.8h-6z"/>`,
  firestore: `<path d="M10 2.6c.6 2.6 4.8 4.4 4.8 9a4.8 4.8 0 0 1-9.6 0c0-2.2 1.2-3.6 2.4-4.6 0 1.4.6 2.4 1.6 2.8-.6-2.6.2-5.2.8-7.2z"/>`,
  // Cache
  redis: `<path d="M10 3.4 16.6 6.2 10 9 3.4 6.2z"/><path d="M3.4 9.6 10 12.4l6.6-2.8M3.4 13 10 15.8l6.6-2.8"/>`,
  memcached: `<path d="M4.2 14.4 5 3.8h2.2L10 10l2.8-6.2H15l.8 10.6"/>${dot(8.4, 16.4, 1.1)}${dot(11.6, 16.4, 1.1)}`,
  // Messaging and events
  kafka: `<rect x="2.6" y="7.2" width="3.6" height="5.6" rx="1"/><rect x="7.4" y="7.2" width="3.6" height="5.6" rx="1"/><rect x="12.2" y="7.2" width="3.6" height="5.6" rx="1"/><path d="M15.8 10h1.8M2.6 4.4h12"/>`,
  rabbitmq: `<rect x="2.8" y="5.2" width="14.4" height="9.6" rx="1.8"/><path d="M3.4 6.2 10 10.6l6.6-4.4"/><path d="M6 17.4h8"/>`,
  nats: `<circle cx="10" cy="10" r="2.2"/><path d="M10 7.8V3.2M10 12.2v4.6M7.8 10H3.2M12.2 10h4.6"/>${dot(10, 3.2)}${dot(10, 16.8)}${dot(3.2, 10)}${dot(16.8, 10)}`,
  queue: `<rect x="3" y="4" width="10.4" height="3" rx="1"/><rect x="3" y="8.5" width="10.4" height="3" rx="1"/><rect x="3" y="13" width="10.4" height="3" rx="1"/><path d="M16.4 4v12M14.8 14.4l1.6 1.6 1.6-1.6"/>`,
  mqtt: `${dot(10, 14.4, 1.4)}<path d="M6.6 11a4.8 4.8 0 0 1 6.8 0M4 8.4a8.4 8.4 0 0 1 12 0"/>`,
  // Storage
  'object-storage': `<path d="M3.4 5.6h13.2l-1.4 11a1.6 1.6 0 0 1-1.6 1.4H6.4a1.6 1.6 0 0 1-1.6-1.4z"/><path d="M3 5.6c.6-1.6 3.4-2.8 7-2.8s6.4 1.2 7 2.8"/>`,
  'block-storage': `<rect x="2.8" y="4.4" width="14.4" height="11.2" rx="2"/><circle cx="10" cy="10" r="2.8"/>${dot(10, 10, .7)}${dot(5.4, 13.2, .7)}`,
  // AI and ML
  'llm-api': `<path d="M4.2 4h11.6A1.6 1.6 0 0 1 17.4 5.6v7.2a1.6 1.6 0 0 1-1.6 1.6H9l-3.6 2.8v-2.8H4.2a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 4.2 4z"/><path d="M10 6.4l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="currentColor"/>`,
  'llm-selfhosted': `<rect x="2.6" y="5" width="14.8" height="9" rx="1.6"/><circle cx="7.2" cy="9.5" r="2.2"/><circle cx="12.8" cy="9.5" r="2.2"/><path d="M4.4 14v2.6M15.6 14v2.6"/>`,
  embeddings: `${dot(4.6, 13.8)}${dot(6.8, 6.4)}${dot(9.6, 10.6)}${dot(13.4, 4.8)}${dot(15.4, 12.4)}${dot(11.8, 15.4)}<path d="M2.8 17.2h14.4M2.8 17.2V2.8" stroke-width="1.2"/>`,
  'ml-training': `<circle cx="4.4" cy="6" r="1.5"/><circle cx="4.4" cy="14" r="1.5"/><circle cx="10" cy="4" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="10" cy="16" r="1.5"/><circle cx="15.6" cy="10" r="1.5"/><path d="M5.8 5.6l2.8-1.2M5.8 6.6 8.6 9.4M5.8 13.4 8.6 10.6M5.8 14.4l2.8 1.2M11.4 4.6l3 4.4M11.5 10h2.6M11.4 15.4l3-4.4" stroke-width="1"/>`,
  // Observability
  'otel-collector': `<path d="M3 4h14l-5.2 6.4v5.2L8.2 17v-6.6z"/>`,
  prometheus: `<path d="M10 2.8c2.6 2.4 4.4 4.6 4.4 7.4a4.4 4.4 0 0 1-8.8 0c0-1.2.4-2.2 1.2-3.2.2 1.2.8 2 1.6 2.4C8 7 8.8 4.6 10 2.8z"/><path d="M5.8 17.2h8.4"/>`,
  grafana: `<path d="M3.4 14.2a6.6 6.6 0 1 1 13.2 0"/><path d="M10 14.2l3.2-4.6"/>${dot(10, 14.2, 1.1)}<path d="M5.2 9.8l.9.6M10 5.8v1M14.8 9.8l-.9.6"/>`,
  loki: `<path d="M3.4 5h2M7.6 5h9M3.4 8.4h2M7.6 8.4h6.4M3.4 11.8h2M7.6 11.8h8M3.4 15.2h2M7.6 15.2h4.6"/>`,
  tempo: `<path d="M3 4h7M5.4 8.2h8M8.4 12.4h5.6M10.6 16.6h6.4" stroke-width="2.2"/>`,
  sentry: `<path d="M10 3 17.4 16H2.6z"/><path d="M10 8.2v3.6"/>${dot(10, 13.6, .9)}`,
  datadog: `<rect x="2.6" y="2.6" width="14.8" height="14.8" rx="2.4"/><path d="M5.6 13.4 8 9.8l2.4 2 4-5.2"/>`,
  // Security and identity
  'auth-service': `<rect x="4.4" y="8.4" width="11.2" height="8.6" rx="2"/><path d="M7 8.4V6.2a3 3 0 0 1 6 0v2.2"/>${dot(10, 12.4, 1.1)}<path d="M10 13.4v1.4"/>`,
  secrets: `<rect x="2.8" y="3.4" width="14.4" height="13.2" rx="2"/><circle cx="10" cy="10" r="3"/><path d="M10 7v1M10 12v1M7 10h1M12 10h1M5 16.6v1.2M15 16.6v1.2"/>`,
  // External services
  payments: `<rect x="2.6" y="4.6" width="14.8" height="10.8" rx="2"/><path d="M2.6 8.2h14.8M5.6 12.4h3"/>`,
  email: `<rect x="2.8" y="4.4" width="14.4" height="11.2" rx="2"/><path d="M3.4 5.8l6.6 5 6.6-5"/>`,
  sms: `<path d="M4.2 3.8h11.6a1.6 1.6 0 0 1 1.6 1.6v7a1.6 1.6 0 0 1-1.6 1.6H9.4l-3.8 2.8V14H4.2a1.6 1.6 0 0 1-1.6-1.6v-7a1.6 1.6 0 0 1 1.6-1.6z"/>${dot(7, 8.9, .8)}${dot(10, 8.9, .8)}${dot(13, 8.9, .8)}`,
  maps: `<path d="M10 17.4c-3.4-3.6-5.2-6.4-5.2-8.8a5.2 5.2 0 0 1 10.4 0c0 2.4-1.8 5.2-5.2 8.8z"/><circle cx="10" cy="8.6" r="1.9"/>`,
  'external-api': `<circle cx="10" cy="10" r="7.2"/><path d="M7.6 12.4l4.8-4.8M8.6 7.6h3.8v3.8"/>`,
}

/** API styles and connection types, for operations and edges. */
export const API_ICONS: Record<string, string> = {
  rest: NAV_ICONS.api,
  graphql: TECH_ICONS['graphql-gateway'],
  grpc: `<path d="M3 7.4h11.4M11.6 4.6 14.4 7.4l-2.8 2.8M17 12.6H5.6M8.4 9.8 5.6 12.6l2.8 2.8"/>${dot(16.8, 7.4)}${dot(3.2, 12.6)}`,
  websocket: `<path d="M3 10h4M13 10h4"/><rect x="7" y="6.4" width="6" height="7.2" rx="1.6"/><path d="M9 6.4V4M11 6.4V4M9 13.6V16M11 13.6V16"/>`,
  trpc: `<path d="M10 2.8 16.4 14H3.6z"/><path d="M10 7.4v3.4M7.4 12.4 10 10.8l2.6 1.6"/>`,
  sse: `<path d="M10 2.8v10.4M6.4 9.6 10 13.2l3.6-3.6M4.4 16.8h11.2"/>`,
  webhook: `<circle cx="10" cy="5.6" r="2.4"/><circle cx="5" cy="14.2" r="2.4"/><circle cx="15" cy="14.2" r="2.4"/><path d="M8.8 7.7 6.2 12.1M11.2 7.7l2.6 4.4M7.4 14.2h5.2"/>`,
  soap: `<rect x="2.8" y="4.4" width="14.4" height="11.2" rx="2"/><path d="M7.4 8 5.4 10l2 2M12.6 8l2 2-2 2"/>`,
}
