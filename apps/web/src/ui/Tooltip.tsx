import { Tooltip as T } from 'radix-ui'
import type { ReactNode } from 'react'
import { Kbd } from './Button'
import s from './Popup.module.css'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={450} skipDelayDuration={200}>{children}</T.Provider>
}

export function Tooltip({ content, shortcut, side = 'bottom', children }: { content: ReactNode; shortcut?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactNode }) {
  if (!content) return <>{children}</>
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content className={s.tooltip} side={side} sideOffset={6} collisionPadding={8}>
          {content}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
