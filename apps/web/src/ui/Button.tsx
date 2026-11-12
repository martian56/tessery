import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import s from './Button.module.css'

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'subtle'
export type ButtonSize = 'xs' | 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconRight?: ReactNode
  active?: boolean
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'sm', icon, iconRight, active, block, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(s.btn, s[variant], s[size], !children && s.iconOnly, active && s.active, block && s.block, className)}
      {...rest}
    >
      {icon && <span className={s.icon}>{icon}</span>}
      {children && <span className={s.label}>{children}</span>}
      {iconRight && <span className={s.icon}>{iconRight}</span>}
    </button>
  )
})

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>
}
