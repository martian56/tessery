import { useEffect, useRef } from 'react'
import { useCommands } from './commands'
import { bus } from '@/lib/bus'

function matches(shortcut: string, e: KeyboardEvent) {
  const parts = shortcut.toLowerCase().split('+')
  const key = parts[parts.length - 1]
  const want = { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') }
  const k = e.key.toLowerCase()
  const keyOk = key === 'del' ? k === 'delete' || k === 'backspace' || k === 'x' : key === k
  return keyOk && want.ctrl === (e.ctrlKey || e.metaKey) && want.alt === e.altKey && (want.shift === e.shiftKey || (key === '?' && e.shiftKey))
}

export function useGlobalShortcuts() {
  const commands = useCommands()
  const ref = useRef(commands)
  ref.current = commands
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, [contenteditable], [role="dialog"], [role="menu"], [role="listbox"]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); ref.current.find((c) => c.id === 'redo')?.run(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); bus.emit('focus-agent'); return }
      for (const c of ref.current) {
        if (!c.shortcut || !matches(c.shortcut, e)) continue
        if (c.enabled && !c.enabled()) return
        e.preventDefault()
        c.run()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
