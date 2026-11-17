import type { ReactNode } from 'react'
import { Skeleton } from '@/ui'
import { AppShell } from './AppShell'
import type { NavItem } from './nav'
import s from './PageLayout.module.css'

export type { NavItem }

/** A settings-style page in the app shell. Its sections are reached from the sidebar, so `nav` only names them. */
export function PageLayout({ children, busy }: { title: string; nav: NavItem[]; active: string; base: string; children: ReactNode; busy?: boolean }) {
  return (
    <AppShell busy={busy}>
      <div className={s.content}>{children}</div>
    </AppShell>
  )
}

/** The shape of a page while it loads: a title, a line of description and a block of content. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className={s.skeleton} aria-busy="true" aria-label="Loading">
      <Skeleton h={22} w={180} />
      <Skeleton h={12} w="min(520px, 80%)" />
      <div className={s.skeletonRows}>{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={40} r={8} />)}</div>
    </div>
  )
}

export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.titleRow}>
      <div>
        <h1 className={s.h1}>{title}</h1>
        {description && <p className={s.desc}>{description}</p>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </div>
  )
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className={s.card}>
      {(title || actions) && <header className={s.cardHead}><h2>{title}</h2>{actions}</header>}
      <div className={s.cardBody}>{children}</div>
    </section>
  )
}

export function Table({ head, children, empty, loading }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode; loading?: boolean }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className={s.tableWrap} aria-busy={loading || undefined}>
      <table className={s.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{loading && !hasRows
          ? [0, 1, 2].map((r) => <tr key={r}>{head.map((_, i) => <td key={i}><Skeleton h={12} w={i === 0 ? '70%' : i === head.length - 1 ? 24 : '55%'} /></td>)}</tr>)
          : hasRows ? children : <tr><td colSpan={head.length} className={s.emptyCell}>{empty ?? 'Nothing here yet'}</td></tr>}</tbody>
      </table>
    </div>
  )
}

export const muted = s.muted
export const mono = s.mono
