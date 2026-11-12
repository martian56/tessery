import { useEffect, useState } from 'react'
import clsx from 'clsx'
import s from './Toast.module.css'

type Tone = 'info' | 'ok' | 'warn' | 'err'
interface ToastMsg { id: number; text: string; tone: Tone }

let seq = 0
const listeners = new Set<(t: ToastMsg) => void>()

export function toast(text: string, tone: Tone = 'info') {
  const t = { id: ++seq, text, tone }
  listeners.forEach((l) => l(t))
}

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([])
  useEffect(() => {
    const add = (t: ToastMsg) => {
      setItems((xs) => [...xs.slice(-3), t])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 2600)
    }
    listeners.add(add)
    return () => { listeners.delete(add) }
  }, [])
  return (
    <div className={s.stack} role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={clsx(s.toast, s[t.tone])}>{t.text}</div>)}
    </div>
  )
}
