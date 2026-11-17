import type { ProjectSummary } from '@/api/types'
import { envName, envRank } from '@/lib/envColor'

export type Latest = ProjectSummary['latest'][number]
export type StageState = 'live' | 'waiting' | 'failed' | 'deploying' | 'none'

export interface Stage { env: string; state: StageState; checkpoint?: number; latest?: Latest }

const IN_FLIGHT = ['queued', 'deploying']

/** Each environment in pipeline order, with what runs there or what its newest release is doing. */
export function stages(p: ProjectSummary): Stage[] {
  const keys = p.envKeys.length ? p.envKeys : [...new Set([...p.running.map((r) => r.env), ...p.latest.map((l) => l.env)])].sort((a, b) => envRank(a) - envRank(b))
  return keys.map((env) => {
    const running = p.running.find((r) => r.env === env)
    const latest = p.latest.find((l) => l.env === env)
    const state: StageState = latest?.status === 'pending' ? 'waiting' : latest?.status === 'failed' ? 'failed' : latest && IN_FLIGHT.includes(latest.status) ? 'deploying' : running ? 'live' : 'none'
    return { env, state, checkpoint: running?.checkpoint ?? latest?.checkpoint, latest }
  })
}

/** The one sentence a project card leads with: the most important thing happening in its pipeline. */
export function headline(list: Stage[]): { text: string; tone: 'ok' | 'warn' | 'err' | 'busy' | 'idle' } {
  const failed = list.find((x) => x.state === 'failed')
  if (failed) return { text: `${envName(failed.env)} release failed`, tone: 'err' }
  const waiting = list.find((x) => x.state === 'waiting')
  if (waiting) return { text: `${envName(waiting.env)} is waiting for approval`, tone: 'warn' }
  const busy = list.find((x) => x.state === 'deploying')
  if (busy) return { text: `Deploying to ${envName(busy.env)}`, tone: 'busy' }
  const live = [...list].reverse().find((x) => x.state === 'live')
  if (live) return { text: `Live on ${envName(live.env)}, checkpoint ${live.checkpoint}`, tone: 'ok' }
  return { text: 'Not released yet', tone: 'idle' }
}

/** Releases across projects for the activity rail: waiting for approval first, then newest first. */
export function activity(projects: ProjectSummary[]) {
  return projects
    .flatMap((p) => p.latest.map((l) => ({ project: p, release: l })))
    .sort((a, b) => Number(b.release.status === 'pending') - Number(a.release.status === 'pending') || b.release.at.localeCompare(a.release.at))
}

export const releaseWords = (l: Latest) => ({
  pending: 'waiting for approval', queued: 'queued', deploying: 'deploying', released: 'released', failed: 'failed', rejected: 'rejected', cancelled: 'cancelled',
}[l.status] ?? l.status)
