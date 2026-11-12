import type { ProjectDoc } from '../domain/types'
import { aiTemplate } from './ai'
import { blankTemplate } from './blank'
import { chatTemplate } from './chat'
import { commerceTemplate } from './commerce'
import { iotTemplate } from './iot'
import { saasTemplate } from './saas'
import { tasksTemplate } from './tasks'

export interface TemplateInfo { id: string; name: string; description: string; build: () => ProjectDoc }

export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank', name: 'Blank', description: 'Start from an empty canvas.', build: () => blankTemplate() },
  { id: 'tasks', name: 'Task tracker', description: 'Sign-in, projects and tasks in Postgres, pages bound to the API. Works on the first deploy.', build: () => tasksTemplate() },
  { id: 'saas', name: 'B2B SaaS', description: 'GraphQL + REST, multi-tenant Postgres, billing, jobs on AWS.', build: saasTemplate },
  { id: 'chat', name: 'Realtime chat', description: 'WebSockets, Cassandra, NATS, self-hosted on Hetzner VPSs.', build: chatTemplate },
  { id: 'iot', name: 'IoT telemetry', description: 'MQTT, Kafka, Flink and time-series storage on Contabo and Hetzner.', build: iotTemplate },
  { id: 'ai', name: 'AI assistant (RAG)', description: 'Streaming LLM chat, embeddings, vector DB on GCP.', build: aiTemplate },
  { id: 'commerce', name: 'Online store', description: 'REST + gRPC services, Kafka events on DigitalOcean.', build: commerceTemplate },
]
