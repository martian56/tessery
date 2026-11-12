import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from 'react-redux'
import type { RootState } from '@/store'
import { simulate, type SimResult } from '@tessery/core/domain/simulate'

type HistPoint = { rps: number; lat: number; err: number }
let result: SimResult | null = null
const history = new Map<string, HistPoint[]>()
const subs = new Set<() => void>()
let paused = false

export function pauseLive(on: boolean) {
  paused = on
}
const publish = (r: SimResult | null) => {
  result = r
  if (r) Object.entries(r.nodes).forEach(([id, n]) => { const h = history.get(id) ?? []; h.push({ rps: n.rps, lat: n.latency, err: n.errorRate }); if (h.length > 60) h.shift(); history.set(id, h) })
  else history.clear()
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }

export function useLiveSimulation() {
  const st = useStore<RootState>()
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const s = st.getState()
      if (!s.ui.live.on || !s.project.doc || paused) return
      publish(simulate(s.project.doc, { load: s.ui.live.load, down: s.ui.live.down }))
    }
    let wasOn = false
    const sync = () => {
      const on = st.getState().ui.live.on
      if (on && !wasOn) { tick(); timer = setInterval(tick, 1000) }
      if (!on && wasOn) { clearInterval(timer); publish(null) }
      wasOn = on
    }
    sync()
    const unsub = st.subscribe(sync)
    return () => { unsub(); clearInterval(timer); publish(null) }
  }, [st])
}

export const useLiveResult = () => useSyncExternalStore(subscribe, () => result)
export const useNodeHistory = (id: string) => { useLiveResult(); return history.get(id) ?? [] }
