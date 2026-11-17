import { Skeleton } from '@/ui'
import shell from './AppShell.module.css'
import s from './BootSkeleton.module.css'

/** The app shell's outline while Tessery starts: sidebar, then a page of placeholder cards. */
export function AppSkeleton() {
  return (
    <div className={shell.shell} aria-busy="true" aria-label="Loading Tessery">
      <div className={s.side}>
        <Skeleton h={40} r={6} />
        <Skeleton h={30} r={6} />
        <div className={s.stack}>{[70, 55, 62, 48, 66, 52].map((w, i) => <Skeleton key={i} h={14} w={`${w}%`} />)}</div>
      </div>
      <div className={shell.panel}>
        <div className={s.page}>
          <div className={s.head}><Skeleton h={22} w={140} /><Skeleton h={30} w={120} r={6} /></div>
          <div className={s.grid}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={196} r={10} />)}</div>
        </div>
      </div>
    </div>
  )
}

/** The project editor's outline while a project opens: top bar, library, canvas and inspector. */
export function WorkspaceSkeleton() {
  return (
    <div className={s.ws} aria-busy="true" aria-label="Opening the project">
      <div className={s.wsBar}><Skeleton h={16} w={120} /><Skeleton h={16} w={360} /><span className={s.grow} /><Skeleton h={26} w={90} r={6} /><Skeleton h={26} w={84} r={6} /></div>
      <div className={s.wsBody}>
        <div className={s.wsSide}><Skeleton h={28} r={6} />{[64, 52, 70, 46, 58, 66, 50].map((w, i) => <Skeleton key={i} h={12} w={`${w}%`} />)}</div>
        <div className={s.wsCanvas}>
          <div className={s.nodes}>{[0, 1, 2].map((i) => <Skeleton key={i} h={110} w={220} r={8} />)}</div>
        </div>
        <div className={s.wsSide}><Skeleton h={36} r={6} />{[80, 60, 72, 54].map((w, i) => <Skeleton key={i} h={12} w={`${w}%`} />)}</div>
      </div>
    </div>
  )
}
