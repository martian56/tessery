/** After Tessery is updated, a tab opened before the update still points at the old build's files, which are gone.
 * Loading one of them fails; reloading picks up the new build. A short guard stops a reload loop. */
const KEY = 'tessery:reloaded-for-update'

export const isStaleBuild = (e: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(String((e as Error)?.message ?? e))

export function reloadForUpdate(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

export function watchForUpdates() {
  window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault() })
}
