import type { ReactNode } from 'react'
import s from './Auth.module.css'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>
          <svg width="22" height="22" viewBox="0 0 16 16"><path d="M2 14 L8 2 L14 14" fill="none" stroke="var(--acc)" strokeWidth="2" /><path d="M5 10 H11" stroke="var(--tx-1)" strokeWidth="1.6" /></svg>
          Tessery
        </div>
        <h1 className={s.title}>{title}</h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}

export function FormError({ message }: { message?: string | null }) {
  return message ? <div className={s.error} role="alert">{message}</div> : null
}
