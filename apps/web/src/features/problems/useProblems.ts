import { useDeferredValue, useMemo } from 'react'
import { useDoc, useUi } from '@/store'
import { useLiveResult } from '@/features/live/useLiveSimulation'
import { analyze, type Problem } from '@tessery/core/analysis'

export { analyze, type Problem }

export function useProblems() {
  const doc = useDeferredValue(useDoc())
  const envId = useUi((u) => u.envId)
  const env = doc.environments.find((e) => e.id === envId)
  const sim = useDeferredValue(useLiveResult())
  return useMemo(() => analyze(doc, env, sim), [doc, env, sim])
}
