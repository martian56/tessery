const DEV = ['dev', 'development', 'local', 'test']
const STAGING = ['staging', 'stage', 'qa', 'preview', 'uat']
const PROD = ['prod', 'production', 'live']

/** The colour an environment wears everywhere, from its key: development cyan, staging violet, production green. */
export function envColor(key: string): string {
  const k = key.toLowerCase()
  if (DEV.includes(k)) return 'var(--env-dev)'
  if (STAGING.includes(k)) return 'var(--env-staging)'
  if (PROD.includes(k)) return 'var(--env-prod)'
  return 'var(--env-other)'
}

const ORDER = [...DEV, ...STAGING, ...PROD]
/** Sorts environment keys in pipeline order: development, then staging, then production, then the rest by name. */
export const envRank = (key: string) => { const i = ORDER.indexOf(key.toLowerCase()); return i < 0 ? ORDER.length : i }

const NAMES: Record<string, string> = { dev: 'Development', prod: 'Production' }
/** A readable name for an environment key. */
export const envName = (key: string) => NAMES[key.toLowerCase()] ?? key.charAt(0).toUpperCase() + key.slice(1)
