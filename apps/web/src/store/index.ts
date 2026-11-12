import { configureStore, createListenerMiddleware, isAnyOf, type Middleware } from '@reduxjs/toolkit'
import { useDispatch, useSelector, useStore } from 'react-redux'
import { useCallback } from 'react'
import { baseApi } from '@/api/base'
import { projectsApi } from '@/api/endpoints/projects'
import { errorCode, errorMessage } from '@/api/types'
import { toast } from '@/ui/Toast'
import project, { projectActions, type EditPayload } from './projectSlice'
import uiReducer from './uiSlice'
import type { OpArgs, OpName, OpResult } from '@tessery/core/domain/ops'

const listener = createListenerMiddleware()

const blocksReadOnlyEdits: Middleware = (api) => (next) => (action) => {
  const st = api.getState() as { project: { readOnly: boolean } }
  if (st.project.readOnly && (projectActions.edited.match(action) || projectActions.undo.match(action) || projectActions.redo.match(action) || projectActions.replaced.match(action) || projectActions.checkpoint.match(action))) {
    if (projectActions.edited.match(action) && action.payload.history !== false) toast('You have read-only access to this project', 'warn')
    return undefined
  }
  return next(action)
}

export const store = configureStore({
  reducer: { project, ui: uiReducer, [baseApi.reducerPath]: baseApi.reducer },
  middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }).prepend(blocksReadOnlyEdits, listener.middleware).concat(baseApi.middleware),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

listener.startListening({
  matcher: isAnyOf(projectActions.edited, projectActions.undo, projectActions.redo, projectActions.replaced, projectActions.overwrite, projectActions.saveRequested),
  effect: async (a, api) => {
    api.cancelActiveListeners()
    if (!projectActions.saveRequested.match(a)) await api.delay(800)
    const { doc, revision, version, readOnly, conflict, dirty } = (api.getState() as RootState).project
    if (!doc || readOnly || conflict || !dirty) return
    api.dispatch(projectActions.saveStarted())
    const r = await api.dispatch(projectsApi.endpoints.saveProject.initiate({ id: doc.id, version, doc }))
    if ('data' in r && r.data) api.dispatch(projectActions.saveFinished({ revision, version: r.data.version }))
    else if (errorCode(r.error) === 'stale_version') {
      api.dispatch(projectActions.saveFinished({ revision, conflict: true }))
      toast('Someone else saved this project. Reload their version or overwrite it.', 'warn')
    } else api.dispatch(projectActions.saveFinished({ revision, error: errorMessage(r.error, 'Saving failed') }))
  },
})

export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector = <T,>(fn: (s: RootState) => T) => useSelector(fn)
export const useDoc = () => useAppSelector((s) => s.project.doc)!
export const useUi = <T,>(fn: (s: RootState['ui']) => T) => useAppSelector((s) => fn(s.ui))

export function useEdit() {
  const dispatch = useAppDispatch()
  const st = useStore<RootState>()
  return useCallback(<K extends OpName>(op: K, args: OpArgs<K>, opts: Omit<EditPayload, 'op' | 'args'> = {}): OpResult<K> => {
    dispatch(projectActions.edited({ op, args, ...opts }))
    return st.getState().project.lastResult as OpResult<K>
  }, [dispatch, st])
}
