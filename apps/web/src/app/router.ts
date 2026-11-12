import { useSyncExternalStore } from 'react'

const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())
window.addEventListener('popstate', notify)

if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1).replace(/^\/p\//, '/projects/'))
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb) } }
const read = () => window.location.pathname

export type Route =
  | { name: 'home' }
  | { name: 'project'; id: string }
  | { name: 'settings'; section: string }
  | { name: 'admin'; section: string }
  | { name: 'account' }

export function parse(path: string): Route {
  const [a, b] = path.split('/').filter(Boolean)
  if (a === 'projects' && b) return { name: 'project', id: b }
  if (a === 'settings') return { name: 'settings', section: b ?? 'general' }
  if (a === 'admin') return { name: 'admin', section: b ?? 'users' }
  if (a === 'account') return { name: 'account' }
  return { name: 'home' }
}

export function useRoute(): Route {
  return parse(useSyncExternalStore(subscribe, read))
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (path === window.location.pathname) return
  if (opts.replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  notify()
}
