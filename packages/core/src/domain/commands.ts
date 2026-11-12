export interface AgentPatch { summary: string; commands: AgentCommand[] }
export type AgentCommand =
  | { op: 'addNode'; ref: string; techId: string; name: string; near?: string; config?: Record<string, string | number | boolean> }
  | { op: 'link'; from: string; to: string }
  | { op: 'removeNode'; node: string }
  | { op: 'setReplicas'; node: string; replicas: number }
  | { op: 'setConfig'; node: string; key: string; value: string | number | boolean }
  | { op: 'setPlacement'; node: string; providerId: string; mode: 'managed' | 'self-hosted' | 'external' }
