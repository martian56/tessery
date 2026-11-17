import type { ReactNode } from 'react'
import s from './Auth.module.css'
import { TesseryMark } from '@/ui/TesseryMark'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.brand}>
          <TesseryMark size={22} />
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
