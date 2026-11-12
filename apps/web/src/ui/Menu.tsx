import { ContextMenu as CM, DropdownMenu as DM, Menubar as MB } from 'radix-ui'
import { Check, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import s from './Popup.module.css'

export type MenuEntry =
  | { kind?: 'item'; label: ReactNode; onSelect?: () => void; icon?: ReactNode; shortcut?: string; disabled?: boolean; danger?: boolean; checked?: boolean }
  | { kind: 'sub'; label: ReactNode; icon?: ReactNode; items: MenuEntry[]; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'heading'; label: ReactNode }

type Prims = typeof DM | typeof CM | typeof MB

function Entries({ items, P }: { items: MenuEntry[]; P: Prims }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === 'separator') return <P.Separator key={i} className={s.sep} />
        if (it.kind === 'heading') return <P.Label key={i} className={s.heading}>{it.label}</P.Label>
        if (it.kind === 'sub')
          return (
            <P.Sub key={i}>
              <P.SubTrigger className={s.item} disabled={it.disabled}>
                <span className={s.itemIcon}>{it.icon}</span>
                <span className={s.itemLabel}>{it.label}</span>
                <span className={s.subArrow}><ChevronRight /></span>
              </P.SubTrigger>
              <P.Portal>
                <P.SubContent className={s.content} sideOffset={2} collisionPadding={8}>
                  <Entries items={it.items} P={P} />
                </P.SubContent>
              </P.Portal>
            </P.Sub>
          )
        return (
          <P.Item key={i} className={clsx(s.item, it.danger && s.danger)} disabled={it.disabled} onSelect={it.onSelect}>
            <span className={s.itemIcon}>{it.checked !== undefined ? (it.checked ? <Check /> : null) : it.icon}</span>
            <span className={s.itemLabel}>{it.label}</span>
            {it.shortcut && <span className={s.shortcut}>{it.shortcut}</span>}
          </P.Item>
        )
      })}
    </>
  )
}

export function DropdownMenu({ trigger, items, align = 'start', side = 'bottom' }: { trigger: ReactNode; items: MenuEntry[]; align?: 'start' | 'end' | 'center'; side?: 'bottom' | 'top' | 'right' | 'left' }) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={s.content} align={align} side={side} sideOffset={4} collisionPadding={8}>
          <Entries items={items} P={DM} />
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

export function ContextMenu({ children, items, disabled }: { children: ReactNode; items: MenuEntry[] | (() => MenuEntry[]); disabled?: boolean }) {
  return (
    <CM.Root modal={false}>
      <CM.Trigger asChild disabled={disabled}>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={s.content} collisionPadding={8}>
          <Entries items={typeof items === 'function' ? items() : items} P={CM} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  )
}

export function MenuBar({ menus, className }: { menus: { label: string; items: MenuEntry[] }[]; className?: string }) {
  return (
    <MB.Root className={className} style={{ display: 'flex', gap: 1 }}>
      {menus.map((m) => (
        <MB.Menu key={m.label}>
          <MB.Trigger className={s.menubarTrigger}>{m.label}</MB.Trigger>
          <MB.Portal>
            <MB.Content className={s.content} align="start" sideOffset={4} collisionPadding={8}>
              <Entries items={m.items} P={MB} />
            </MB.Content>
          </MB.Portal>
        </MB.Menu>
      ))}
    </MB.Root>
  )
}
