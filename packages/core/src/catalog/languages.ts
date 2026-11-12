import type { ApiStyle, Language } from '../domain/types'

const fw = (id: string, name: string, styles: ApiStyle[]) => ({ id, name, styles })

export const LANGUAGES: Language[] = [
  { id: 'TypeScript', name: 'TypeScript', ext: 'ts', frameworks: [fw('fastify', 'Fastify', ['rest', 'websocket', 'sse', 'webhook']), fw('hono', 'Hono', ['rest', 'sse', 'webhook']), fw('nestjs', 'NestJS', ['rest', 'graphql', 'websocket', 'grpc']), fw('express', 'Express', ['rest', 'webhook']), fw('apollo', 'Apollo Server', ['graphql']), fw('yoga', 'GraphQL Yoga', ['graphql']), fw('trpc', 'tRPC', ['trpc']), fw('connect', 'Connect-ES', ['grpc']), fw('uws', 'uWebSockets.js', ['websocket'])] },
  { id: 'Go', name: 'Go', ext: 'go', frameworks: [fw('chi', 'chi', ['rest', 'sse', 'webhook']), fw('gin', 'Gin', ['rest']), fw('echo', 'Echo', ['rest', 'websocket']), fw('grpc-go', 'grpc-go', ['grpc']), fw('connect-go', 'Connect-Go', ['grpc', 'rest']), fw('gqlgen', 'gqlgen', ['graphql']), fw('gorilla-ws', 'gorilla/websocket', ['websocket'])] },
  { id: 'Python', name: 'Python', ext: 'py', frameworks: [fw('fastapi', 'FastAPI', ['rest', 'websocket', 'sse', 'webhook']), fw('django', 'Django REST', ['rest']), fw('flask', 'Flask', ['rest']), fw('strawberry', 'Strawberry', ['graphql']), fw('grpcio', 'grpcio', ['grpc']), fw('litestar', 'Litestar', ['rest', 'websocket'])] },
  { id: 'Rust', name: 'Rust', ext: 'rs', frameworks: [fw('axum', 'Axum', ['rest', 'websocket', 'sse']), fw('actix', 'Actix Web', ['rest', 'websocket']), fw('tonic', 'Tonic', ['grpc']), fw('async-graphql', 'async-graphql', ['graphql'])] },
  { id: 'Java', name: 'Java', ext: 'java', frameworks: [fw('spring', 'Spring Boot', ['rest', 'graphql', 'websocket', 'grpc', 'soap']), fw('quarkus', 'Quarkus', ['rest', 'graphql', 'grpc']), fw('micronaut', 'Micronaut', ['rest', 'grpc'])] },
  { id: 'Kotlin', name: 'Kotlin', ext: 'kt', frameworks: [fw('ktor', 'Ktor', ['rest', 'websocket', 'sse']), fw('spring-kt', 'Spring Boot', ['rest', 'graphql', 'grpc'])] },
  { id: 'C#', name: 'C#', ext: 'cs', frameworks: [fw('aspnet', 'ASP.NET Core', ['rest', 'grpc', 'websocket', 'sse']), fw('hotchocolate', 'Hot Chocolate', ['graphql']), fw('signalr', 'SignalR', ['websocket'])] },
  { id: 'Elixir', name: 'Elixir', ext: 'ex', frameworks: [fw('phoenix', 'Phoenix', ['rest', 'websocket']), fw('absinthe', 'Absinthe', ['graphql'])] },
  { id: 'Ruby', name: 'Ruby', ext: 'rb', frameworks: [fw('rails', 'Rails', ['rest', 'websocket']), fw('graphql-ruby', 'graphql-ruby', ['graphql']), fw('sinatra', 'Sinatra', ['rest'])] },
  { id: 'PHP', name: 'PHP', ext: 'php', frameworks: [fw('laravel', 'Laravel', ['rest', 'websocket']), fw('symfony', 'Symfony', ['rest', 'soap']), fw('lighthouse', 'Lighthouse', ['graphql'])] },
  { id: 'Scala', name: 'Scala', ext: 'scala', frameworks: [fw('http4s', 'http4s', ['rest', 'websocket']), fw('caliban', 'Caliban', ['graphql'])] },
  { id: 'Swift', name: 'Swift', ext: 'swift', frameworks: [fw('vapor', 'Vapor', ['rest', 'websocket'])] },
  { id: 'C++', name: 'C++', ext: 'cpp', frameworks: [fw('drogon', 'Drogon', ['rest', 'websocket']), fw('grpc-cpp', 'gRPC C++', ['grpc'])] },
  { id: 'Zig', name: 'Zig', ext: 'zig', frameworks: [fw('zap', 'Zap', ['rest'])] },
]
export const LANGUAGE_BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l]))

export const API_STYLE_META: Record<ApiStyle, { label: string; port: 'http' | 'graphql' | 'grpc' | 'ws'; color: string }> = {
  rest: { label: 'REST', port: 'http', color: 'var(--c-network)' },
  graphql: { label: 'GraphQL', port: 'graphql', color: '#e535ab' },
  grpc: { label: 'gRPC', port: 'grpc', color: '#4aa3df' },
  websocket: { label: 'WebSocket', port: 'ws', color: 'var(--c-client)' },
  trpc: { label: 'tRPC', port: 'http', color: '#398ccb' },
  sse: { label: 'Server-Sent Events', port: 'http', color: 'var(--c-client)' },
  webhook: { label: 'Webhooks', port: 'http', color: 'var(--c-external)' },
  soap: { label: 'SOAP', port: 'http', color: 'var(--tx-3)' },
}

export function frameworksFor(language: string, style: ApiStyle) {
  return (LANGUAGE_BY_ID[language]?.frameworks ?? []).filter((f) => f.styles.includes(style))
}
