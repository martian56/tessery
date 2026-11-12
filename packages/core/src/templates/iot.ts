import { GraphBuilder, api, block, db, defaultObservability, env, op, page, project, table, uid } from '../domain/builders'

export function iotTemplate() {
  const g = new GraphBuilder('contabo', 'eu')
  const dev = g.add('iot-device', 'sensors', 0, 200, { config: { protocol: 'MQTT', devices: 50000, trafficRps: 4000 } })
  const mqtt = g.add('mqtt', 'broker', 280, 200, { mode: 'self-hosted' })
  const ingest = g.add('worker', 'ingest', 560, 120, { mode: 'self-hosted', config: { language: 'Go', concurrency: 64 }, replicas: 3 })
  const kafka = g.add('kafka', 'telemetry-log', 840, 120, { mode: 'self-hosted', config: { engine: 'Redpanda', partitions: 24 } })
  const stream = g.add('batch', 'stream-proc', 1120, 120, { mode: 'self-hosted', config: { engine: 'Flink' } })
  const ts = g.add('timescaledb', 'timeseries', 1400, 40, { mode: 'self-hosted', config: { storageGb: 1000 } })
  const ch = g.add('clickhouse', 'analytics', 1400, 230, { mode: 'self-hosted', provider: 'hetzner', region: 'fsn1' })
  const apiSvc = g.add('service', 'fleet-api', 840, 380, { mode: 'self-hosted', provider: 'hetzner', region: 'fsn1', config: { language: 'Kotlin', framework: 'Ktor', apiStyle: 'rest' } })
  const pg = g.add('postgres', 'registry', 1120, 400, { mode: 'self-hosted', provider: 'hetzner', region: 'fsn1' })
  const console_ = g.add('web-app', 'fleet-console', 560, 400, { config: { framework: 'React + Vite', rendering: 'SPA', trafficRps: 20 } })
  const graf = g.add('grafana', 'dashboards', 1680, 140, { mode: 'self-hosted', provider: 'hetzner', region: 'fsn1' })
  const alerts = g.add('function', 'alerting', 1400, 420, { provider: 'scaleway', region: 'fr-par' })
  g.link(dev, mqtt).link(mqtt, ingest, 'sub').link(ingest, kafka).link(kafka, stream, 'sub').link(stream, ts).link(stream, ch).link(stream, alerts)
    .link(console_, apiSvc).link(apiSvc, pg).link(apiSvc, ts).link(apiSvc, ch).link(graf, ts).link(graf, ch)
  const apis = {
    [apiSvc.id]: api(apiSvc.id, 'rest', 'Kotlin', 'Ktor', '/api', [
      op('GET /api/devices', 'listDevices', 'Device registry', 'user', ['auth.jwt', 'db.devices.page', 'respond 200']),
      op('POST /api/devices', 'registerDevice', 'Provision device + cert', 'admin', ['auth.jwt', 'validate Device', 'pki.issue', 'db.devices.insert', 'respond 201']),
      op('GET /api/devices/{id}/series', 'series', 'Time series for a device', 'user', ['auth.jwt', 'timeseries.query time_bucket(1m)', 'respond 200'], { cache: '15s' }),
      op('POST /api/devices/{id}/commands', 'command', 'Send command over MQTT', 'admin', ['auth.jwt', 'mqtt.publish devices/{id}/cmd', 'respond 202']),
    ]),
  }
  const schema = db(pg.id, [
    table('sites', 'id uuid pk, name text, timezone text default:UTC', 40, 40),
    table('devices', 'id uuid pk, site_id uuid ref:sites.id, serial text unique, model text, firmware text, last_seen timestamptz null, created_at timestamptz', 320, 40, ['site_id']),
    table('certificates', 'id uuid pk, device_id uuid ref:devices.id cascade, fingerprint text unique, expires_at timestamptz', 600, 40),
  ])
  const tsdb = db(ts.id, [table('readings', 'time timestamptz pk, device_id uuid pk, metric text pk, value float', 40, 40, ['device_id+time'])])
  return project({
    id: uid('p'), name: 'fleetwise-iot', icon: '◈', description: 'IoT telemetry: MQTT → Redpanda → Flink → TimescaleDB/ClickHouse, on Contabo and Hetzner VPSs.',
    nodes: g.nodes, edges: g.edges, apis, databases: { [pg.id]: schema, [ts.id]: tsdb },
    pages: [page(console_.id, 'Fleet', '/', [block('navbar', { brand: 'Fleetwise', links: 'Fleet, Sites, Alerts' }), block('stats', { items: 'Online:48,912, Offline:1,088, Msg/s:4,021' }), block('table', { title: 'Devices', source: `${apiSvc.id}:listDevices` })], { render: 'csr', access: 'user' })],
    environments: [env('dev', 'Development', 'self', 'onprem', { scale: 0.5, strategy: 'recreate', autoRollback: false }), env('prod', 'Production', 'contabo', 'eu', { strategy: 'rolling', secrets: ['MQTT_CA', 'CLICKHOUSE_URL'] })],
    observability: { ...defaultObservability(), sampling: 0.01, alerts: [{ id: uid('al'), nodeId: ingest.id, name: 'Ingest lag', expr: 'kafka_consumer_lag > 100k', severity: 'critical', channel: '#iot-oncall', enabled: true }] },
  })
}
