// Logos for technologies that are a specific product, from Simple Icons (CC0). Each is a single 24 by 24 path that
// Tessery draws in one colour, so branded and generic technologies read as one set. Generic technologies, such as a
// web app or a managed queue, keep the pictograms in set.ts.
import {
  siApachecassandra, siApachekafka, siClickhouse, siCockroachlabs, siDatadog, siElasticsearch, siFirebase, siGrafana, siGraphql,
  siInfluxdb, siJaeger, siMariadb, siMeilisearch, siMongodb, siMqtt, siMysql, siNatsdotio, siNeo4j, siOpentelemetry, siPostgresql,
  siPrometheus, siRabbitmq, siRedis, siSentry, siSqlite, siSupabase, siTimescale,
} from 'simple-icons'

/** The logo path for each technology id that has one. */
export const BRAND_PATHS: Record<string, string> = {
  postgres: siPostgresql.path,
  pgvector: siPostgresql.path,
  mysql: siMysql.path,
  mariadb: siMariadb.path,
  sqlite: siSqlite.path,
  cockroachdb: siCockroachlabs.path,
  mongodb: siMongodb.path,
  cassandra: siApachecassandra.path,
  clickhouse: siClickhouse.path,
  timescaledb: siTimescale.path,
  influxdb: siInfluxdb.path,
  neo4j: siNeo4j.path,
  elasticsearch: siElasticsearch.path,
  meilisearch: siMeilisearch.path,
  supabase: siSupabase.path,
  firestore: siFirebase.path,
  redis: siRedis.path,
  kafka: siApachekafka.path,
  rabbitmq: siRabbitmq.path,
  nats: siNatsdotio.path,
  mqtt: siMqtt.path,
  'otel-collector': siOpentelemetry.path,
  prometheus: siPrometheus.path,
  grafana: siGrafana.path,
  tempo: siJaeger.path,
  sentry: siSentry.path,
  datadog: siDatadog.path,
  'graphql-gateway': siGraphql.path,
}

/** The GraphQL mark, for the GraphQL API style. */
export const GRAPHQL_PATH = siGraphql.path
