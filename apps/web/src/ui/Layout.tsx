import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import s from './Layout.module.css'

export function PanelHeader({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={s.panelHeader}>
      <span className={s.panelTitle}>{title}</span>
      {meta && <span className={s.panelMeta}>{meta}</span>}
      {actions && <span className={s.panelActions}>{actions}</span>}
    </div>
  )
}

const closedSections = new Set<string>()

export function Section({ title, children, actions, defaultOpen = true, id }: { title: ReactNode; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; id?: string }) {
  const key = id ?? (typeof title === 'string' ? title : '')
  const [open, setOpen] = useState(key ? !closedSections.has(key) && defaultOpen : defaultOpen)
  const toggle = () => {
    setOpen((o) => {
      if (key) (o ? closedSections.add(key) : closedSections.delete(key))
      return !o
    })
  }
  return (
    <section className={clsx(s.section, !open && s.closed)}>
      <div className={s.sectionHead}>
        <button className={s.sectionToggle} onClick={toggle}>
          <ChevronDown className={s.chev} />
          {title}
        </button>
        {actions && <span className={s.sectionActions}>{actions}</span>}
      </div>
      {open && <div className={s.sectionBody}>{children}</div>}
    </section>
  )
}

export function Field({ label, children, hint, wide }: { label: ReactNode; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <div className={clsx(s.field, wide && s.fieldWide)}>
      <span className={s.fieldLabel} title={typeof label === 'string' ? label : undefined}>{label}</span>
      <div className={s.fieldControl}>{children}</div>
      {hint && <span className={s.fieldHint}>{hint}</span>}
    </div>
  )
}

export function Stack({ children, gap = 4, row, align, wrap, className }: { children: ReactNode; gap?: number; row?: boolean; align?: 'center' | 'start' | 'end' | 'stretch'; wrap?: boolean; className?: string }) {
  return <div className={className} style={{ display: 'flex', flexDirection: row ? 'row' : 'column', gap, alignItems: align, flexWrap: wrap ? 'wrap' : undefined, minWidth: 0 }}>{children}</div>
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon && <div className={s.emptyIcon}>{icon}</div>}
      <div className={s.emptyTitle}>{title}</div>
      {children && <div className={s.emptyText}>{children}</div>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  )
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx(s.toolbar, className)}>{children}</div>
}

export function Spacer() { return <div style={{ flex: 1 }} /> }

export function Divider({ vertical }: { vertical?: boolean }) {
  return <div className={vertical ? s.vdiv : s.hdiv} />
}
