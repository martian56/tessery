import { envColor, envName } from '@/lib/envColor'
import type { Stage } from './status'
import s from './ProjectHome.module.css'

const SAY: Record<Stage['state'], string> = { live: 'live', waiting: 'waiting for approval', failed: 'release failed', deploying: 'deploying', none: 'not released' }

/** The pipeline as connected dots, one per environment in its colour: filled when live, hollow when empty. */
export function Pipeline({ stages }: { stages: Stage[] }) {
  return (
    <ol className={s.pipe} aria-label="Pipeline">
      {stages.map((st) => (
        <li key={st.env} className={s.stage} data-state={st.state} style={{ '--env': envColor(st.env) } as React.CSSProperties}
          title={`${envName(st.env)}: ${SAY[st.state]}${st.checkpoint ? `, checkpoint ${st.checkpoint}` : ''}`}>
          <span className={s.dot} />
          <span className="sr-only">{envName(st.env)}: {SAY[st.state]}</span>
        </li>
      ))}
    </ol>
  )
}
