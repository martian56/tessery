import { useCallback } from 'react'
import { useStore } from 'react-redux'
import { useCreateCheckpointMutation } from '@/api/endpoints/delivery'
import { errorMessage } from '@/api/types'
import type { Checkpoint } from '@/api/types'
import { projectActions } from '@/store/projectSlice'
import type { RootState } from '@/store'
import { toast } from '@/ui'

type ProjectState = RootState['project']

function whenSaved(store: ReturnType<typeof useStore<RootState>>): Promise<ProjectState> {
  const settled = (p: ProjectState) => !p.dirty && !p.saving
  const failed = (p: ProjectState) => p.conflict || !!p.saveError || p.readOnly
  return new Promise((resolve, reject) => {
    const check = () => {
      const p = store.getState().project
      if (failed(p)) { stop(); reject(new Error(p.conflict ? 'Resolve the save conflict first' : p.readOnly ? 'You have read-only access' : p.saveError ?? 'Saving failed')) }
      else if (settled(p)) { stop(); resolve(p) }
    }
    const timer = setTimeout(() => { stop(); reject(new Error('Saving took too long')) }, 15_000)
    const unsubscribe = store.subscribe(check)
    const stop = () => { clearTimeout(timer); unsubscribe() }
    if (store.getState().project.dirty) store.dispatch(projectActions.saveRequested())
    check()
  })
}

export function useCreateCheckpoint() {
  const store = useStore<RootState>()
  const [create, state] = useCreateCheckpointMutation()
  const run = useCallback(async (name: string, message = ''): Promise<Checkpoint | null> => {
    try {
      const p = await whenSaved(store)
      const doc = p.doc!
      const r = await create({ pid: doc.id, name, message, version: p.version })
      if ('error' in r) { toast(errorMessage(r.error, 'Could not create the checkpoint'), 'err'); return null }
      toast(`Checkpoint ${r.data.seq} created: ${r.data.files} files committed`, 'ok')
      return r.data
    } catch (e) {
      toast((e as Error).message, 'err')
      return null
    }
  }, [store, create])
  return [run, state] as const
}
