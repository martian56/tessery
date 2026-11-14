import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type Workspace = 'design' | 'api' | 'database' | 'pages' | 'deploy' | 'observe'
export type PageTool = 'select' | 'frame' | 'text' | 'button' | 'image' | 'video' | 'rect' | 'ellipse' | 'pen' | 'pencil' | 'embed'
export type DockTab = 'code' | 'terminal' | 'problems' | 'output'
export type Selection =
  | { kind: 'none' }
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'edge'; id: string }

export interface UiState {
  workspace: Workspace
  selection: Selection
  panels: { left: boolean; right: boolean; bottom: boolean; leftW: number; rightW: number; bottomH: number }
  dock: DockTab
  file: string | null
  envId: string
    api: { nodeId: string | null; opId: string | null; typeId: string | null; tab: 'operations' | 'types' | 'schema' }
  database: { nodeId: string | null; tableId: string | null; view: 'diagram' | 'data' | 'sql' | 'migrations' }
  pages: {
    pageId: string | null
    /** The selected element (the last one picked when several are). */
    blockId: string | null
    /** Every selected element, for grouping and deleting several at once. */
    selection: string[]
    device: 'desktop' | 'tablet' | 'mobile'
    tool: PageTool
    /** Edit the hover state instead of the resting style. */
    hover: boolean
  }
  observe: { tab: 'overview' | 'metrics' | 'logs' | 'traces' | 'slos' | 'alerts'; range: string; nodeId: string | null }
  live: { on: boolean; load: number; down: string[] }
  layer: 'all' | 'runtime' | 'data'
  showProviders: boolean
  commandOpen: boolean
}

const initialState: UiState = {
  workspace: 'design',
  selection: { kind: 'none' },
  panels: { left: true, right: true, bottom: true, leftW: 248, rightW: 320, bottomH: 220 },
  dock: 'code',
  file: null,
  envId: 'prod',
  api: { nodeId: null, opId: null, typeId: null, tab: 'operations' },
  database: { nodeId: null, tableId: null, view: 'diagram' },
  pages: { pageId: null, blockId: null, selection: [], device: 'desktop', tool: 'select', hover: false },
  observe: { tab: 'overview', range: '1h', nodeId: null },
  live: { on: false, load: 1, down: [] },
  layer: 'all',
  showProviders: true,
  commandOpen: false,
}

const slice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setWorkspace(s, a: PayloadAction<Workspace>) { s.workspace = a.payload },
    select(s, a: PayloadAction<Selection>) { s.selection = a.payload },
    togglePanel(s, a: PayloadAction<'left' | 'right' | 'bottom'>) { s.panels[a.payload] = !s.panels[a.payload] },
    resizePanel(s, a: PayloadAction<{ key: 'leftW' | 'rightW' | 'bottomH'; value: number }>) { s.panels[a.payload.key] = a.payload.value },
    setDock(s, a: PayloadAction<DockTab>) { s.dock = a.payload; s.panels.bottom = true },
    setFile(s, a: PayloadAction<string | null>) { s.file = a.payload },
    setEnv(s, a: PayloadAction<string>) { s.envId = a.payload },
    setApi(s, a: PayloadAction<Partial<UiState['api']>>) { Object.assign(s.api, a.payload) },
    setDatabase(s, a: PayloadAction<Partial<UiState['database']>>) { Object.assign(s.database, a.payload) },
    setPages(s, a: PayloadAction<Partial<UiState['pages']>>) {
      Object.assign(s.pages, a.payload)
      if ('blockId' in a.payload && !('selection' in a.payload)) s.pages.selection = a.payload.blockId ? [a.payload.blockId] : []
    },
    setObserve(s, a: PayloadAction<Partial<UiState['observe']>>) { Object.assign(s.observe, a.payload) },
    setLive(s, a: PayloadAction<Partial<UiState['live']>>) { Object.assign(s.live, a.payload) },
    toggleDown(s, a: PayloadAction<string>) { s.live.down = s.live.down.includes(a.payload) ? s.live.down.filter((x) => x !== a.payload) : [...s.live.down, a.payload]; s.live.on = true },
    setLayer(s, a: PayloadAction<UiState['layer']>) { s.layer = a.payload },
    toggleProviders(s) { s.showProviders = !s.showProviders },
    setCommandOpen(s, a: PayloadAction<boolean>) { s.commandOpen = a.payload },
    resetForProject(s) { Object.assign(s, { selection: { kind: 'none' }, api: initialState.api, database: initialState.database, pages: initialState.pages, live: initialState.live, file: null }) },
  },
})

export const ui = slice.actions
export default slice.reducer
