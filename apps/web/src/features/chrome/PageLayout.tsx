import type { ReactNode } from 'react'
import clsx from 'clsx'
import { navigate } from '@/app/router'
import { AppHeader } from './AppHeader'
import s from './PageLayout.module.css'

export interface NavItem { id: string; label: string; icon?: ReactNode }

export function PageLayout({ title, nav, active, base, children }: { title: string; nav: NavItem[]; active: string; base: string; children: ReactNode }) {
  return (
    <div className={s.shell}>
      <AppHeader />
      <div className={s.body}>
        <aside className={s.side}>
          <div className={s.sideTitle}>{title}</div>
          {nav.map((n) => (
            <button key={n.id} className={clsx(s.navItem, active === n.id && s.on)} onClick={() => navigate(`${base}/${n.id}`)}>
              {n.icon}{n.label}
            </button>
          ))}
        </aside>
        <main className={s.main}><div className={s.content}>{children}</div></main>
      </div>
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

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{hasRows ? children : <tr><td colSpan={head.length} className={s.emptyCell}>{empty ?? 'Nothing here yet'}</td></tr>}</tbody>
      </table>
    </div>
  )
}

export const muted = s.muted
export const mono = s.mono
