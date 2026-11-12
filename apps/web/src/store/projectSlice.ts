import { createSlice, current, type PayloadAction } from '@reduxjs/toolkit'
import type { ProjectDoc } from '@tessery/core/domain/types'
import { runOp, type OpName } from '@tessery/core/domain/ops'

const HISTORY = 150
const COALESCE_MS = 900

export interface ProjectState {
  doc: ProjectDoc | null
  past: ProjectDoc[]
  future: ProjectDoc[]
  dirty: boolean
  saving: boolean
  savedAt: number | null
  lastResult: unknown
  lastLabel: string
  coalesceKey: string | null
  coalesceAt: number
  revision: number
  version: number
  orgId: string | null
  readOnly: boolean
  conflict: boolean
  saveError: string | null
}

const initialState: ProjectState = {
  doc: null, past: [], future: [], dirty: false, saving: false, savedAt: null, lastResult: undefined, lastLabel: '', coalesceKey: null, coalesceAt: 0, revision: 0,
  version: 0, orgId: null, readOnly: false, conflict: false, saveError: null,
}

export interface LoadedPayload { doc: ProjectDoc; version: number; orgId: string; readOnly: boolean }

export interface EditPayload { op: OpName; args: unknown; coalesce?: string; history?: boolean }

const slice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    loaded(state, a: PayloadAction<LoadedPayload>) {
      Object.assign(state, initialState, { ...a.payload, savedAt: Date.now() })
    },
    setReadOnly(state, a: PayloadAction<boolean>) { state.readOnly = a.payload },
    closed() { return initialState },
    edited(state, a: PayloadAction<EditPayload>) {
      if (!state.doc) return
      const { op, args, coalesce, history = true } = a.payload
      const now = Date.now()
      const merge = coalesce && coalesce === state.coalesceKey && now - state.coalesceAt < COALESCE_MS
      if (history && !merge) {
        state.past.push(current(state.doc) as ProjectDoc)
        if (state.past.length > HISTORY) state.past.shift()
      }
      if (history) state.future = []
      state.coalesceKey = coalesce ?? null
      state.coalesceAt = now
      state.lastResult = runOp(state.doc as ProjectDoc, op, args as never)
      state.lastLabel = op
      state.dirty = true
      state.revision++
    },
    checkpoint(state) {
      if (!state.doc) return
      state.past.push(current(state.doc) as ProjectDoc)
      if (state.past.length > HISTORY) state.past.shift()
      state.future = []
      state.coalesceKey = null
    },
    dropCheckpoint(state) { state.past.pop() },
    undo(state) {
      const prev = state.past.pop()
      if (!prev || !state.doc) return
      state.future.push(current(state.doc) as ProjectDoc)
      state.doc = prev
      state.dirty = true
      state.coalesceKey = null
      state.revision++
    },
    redo(state) {
      const next = state.future.pop()
      if (!next || !state.doc) return
      state.past.push(current(state.doc) as ProjectDoc)
      state.doc = next
      state.dirty = true
      state.coalesceKey = null
      state.revision++
    },
    replaced(state, a: PayloadAction<ProjectDoc>) {
      if (state.doc) state.past.push(current(state.doc) as ProjectDoc)
      state.future = []
      state.doc = a.payload
      state.dirty = true
      state.revision++
    },
    serverUpdated(state, a: PayloadAction<{ doc: ProjectDoc; version: number }>) {
      if (!state.doc || state.dirty || state.saving || a.payload.version <= state.version) return
      state.past.push(current(state.doc) as ProjectDoc)
      if (state.past.length > HISTORY) state.past.shift()
      state.future = []
      state.doc = a.payload.doc
      state.version = a.payload.version
      state.savedAt = Date.now()
      state.coalesceKey = null
    },
    saveRequested() {},
    saveStarted(state) { state.saving = true },
    saveFinished(state, a: PayloadAction<{ revision: number; version?: number; conflict?: boolean; error?: string }>) {
      state.saving = false
      const { revision, version, conflict, error } = a.payload
      if (version !== undefined) {
        state.version = version
        state.savedAt = Date.now()
        state.saveError = null
        if (revision === state.revision) state.dirty = false
      }
      if (conflict) state.conflict = true
      if (error) state.saveError = error
    },
    rebased(state, a: PayloadAction<{ doc: ProjectDoc; version: number }>) {
      if (state.doc) state.past.push(current(state.doc) as ProjectDoc)
      state.doc = a.payload.doc
      state.version = a.payload.version
      state.conflict = false
      state.dirty = false
      state.revision++
    },
        overwrite(state, a: PayloadAction<{ version: number }>) {
      state.version = a.payload.version
      state.conflict = false
      state.dirty = true
      state.revision++
    },
  },
})

export const projectActions = slice.actions
export default slice.reducer
