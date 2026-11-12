import { useMemo } from 'react'
import { useStore } from 'react-redux'
import type { RootState } from '@/store'
import { useAppDispatch, useEdit } from '@/store'
import { projectActions } from '@/store/projectSlice'
import { ui, type Workspace } from '@/store/uiSlice'
import { navigate } from '@/app/router'
import { toast, useDialogs } from '@/ui'
import { exportProjectZip, downloadText } from '@/features/codegen/exportZip'
import { bus } from '@/lib/bus'
import { clipboard } from '@/lib/clipboard'
import { useProjectPermissions } from '@/app/useProjectPermissions'

export interface Command { id: string; label: string; group: string; shortcut?: string; run: () => void; enabled?: () => boolean; keywords?: string }

export const WORKSPACE_ORDER: Workspace[] = ['design', 'api', 'database', 'pages', 'deploy', 'observe']

export function useCommands(): Command[] {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const st = useStore<RootState>()
  const dialogs = useDialogs()
  const perms = useProjectPermissions()
  const canEdit = perms.can('project:edit')
  const canDeploy = perms.can('deployment:run')
  return useMemo(() => {
    const S = () => st.getState()
    const doc = () => S().project.doc!
    const selNodes = () => { const sel = S().ui.selection; return sel.kind === 'nodes' ? sel.ids : [] }
    const cmds: Command[] = [
      { id: 'home', group: 'File', label: 'All projects', run: () => navigate('/') },
      { id: 'save', group: 'File', label: 'Save now', shortcut: 'Ctrl+S', enabled: () => canEdit, run: () => { if (S().project.conflict) toast('Resolve the save conflict first', 'warn'); else dispatch(projectActions.saveRequested()) } },
      { id: 'checkpoint', group: 'File', label: 'New checkpoint…', shortcut: 'Ctrl+Shift+S', enabled: () => canEdit, run: () => bus.emit('new-checkpoint') },
      { id: 'history', group: 'File', label: 'History and checkpoints…', run: () => bus.emit('open-history') },
      { id: 'repository', group: 'File', label: 'Git repository…', run: () => bus.emit('open-repository') },
      { id: 'rename', group: 'File', label: 'Rename project…', enabled: () => canEdit, run: async () => { const v = await dialogs.prompt({ title: 'Project settings', fields: [{ name: 'name', label: 'Name', value: doc().name }, { name: 'description', label: 'Description', value: doc().description }], ok: 'Save' }); if (v) edit('renameProject', v) } },
      { id: 'export', group: 'File', label: 'Export project (.zip)', shortcut: 'Ctrl+E', run: () => { const n = exportProjectZip(doc()); toast(`Exported ${n} files`, 'ok') } },
      { id: 'export-json', group: 'File', label: 'Export design (.tessery.json)', run: () => downloadText(`${doc().name}.tessery.json`, JSON.stringify(doc(), null, 2)) },

      { id: 'undo', group: 'Edit', label: 'Undo', shortcut: 'Ctrl+Z', run: () => dispatch(projectActions.undo()), enabled: () => S().project.past.length > 0 },
      { id: 'redo', group: 'Edit', label: 'Redo', shortcut: 'Ctrl+Shift+Z', run: () => dispatch(projectActions.redo()), enabled: () => S().project.future.length > 0 },
      { id: 'copy', group: 'Edit', label: 'Copy', shortcut: 'Ctrl+C', enabled: () => selNodes().length > 0, run: () => { const ids = new Set(selNodes()); clipboard.set({ nodes: doc().nodes.filter((n) => ids.has(n.id)), edges: doc().edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }); toast(`Copied ${ids.size} node(s)`) } },
      { id: 'paste', group: 'Edit', label: 'Paste', shortcut: 'Ctrl+V', enabled: () => !!clipboard.get(), run: () => { const c = clipboard.get(); if (!c) return; dispatch(ui.setWorkspace('design')); const ids = edit('pasteNodes', { ...c }); dispatch(ui.select({ kind: 'nodes', ids })) } },
      { id: 'duplicate', group: 'Edit', label: 'Duplicate', shortcut: 'Shift+D', enabled: () => selNodes().length > 0, run: () => { const ids = edit('duplicateNodes', { ids: selNodes() }); if (ids) dispatch(ui.select({ kind: 'nodes', ids })) } },
      { id: 'delete', group: 'Edit', label: 'Delete selection', shortcut: 'Del', enabled: () => S().ui.selection.kind !== 'none', run: () => { const sel = S().ui.selection; if (sel.kind === 'nodes') edit('removeNodes', { ids: sel.ids }); if (sel.kind === 'edge') edit('removeEdges', { ids: [sel.id] }); dispatch(ui.select({ kind: 'none' })) } },
      { id: 'select-all', group: 'Edit', label: 'Select all nodes', shortcut: 'Ctrl+A', run: () => { dispatch(ui.setWorkspace('design')); dispatch(ui.select({ kind: 'nodes', ids: doc().nodes.map((n) => n.id) })) } },

      { id: 'frame', group: 'View', label: 'Frame all', shortcut: 'Home', run: () => bus.emit('frame') },
      { id: 'layout', group: 'View', label: 'Auto-arrange nodes', run: () => { edit('autoLayout', undefined); setTimeout(() => bus.emit('frame'), 50) } },
      { id: 'providers', group: 'View', label: 'Toggle provider badges', run: () => dispatch(ui.toggleProviders()) },
      { id: 'panel-left', group: 'View', label: 'Toggle left panel', shortcut: 'Ctrl+B', run: () => dispatch(ui.togglePanel('left')) },
      { id: 'panel-right', group: 'View', label: 'Toggle right panel', shortcut: 'Ctrl+Alt+B', run: () => dispatch(ui.togglePanel('right')) },
      { id: 'panel-bottom', group: 'View', label: 'Toggle bottom panel', shortcut: 'Ctrl+J', run: () => dispatch(ui.togglePanel('bottom')) },
      { id: 'palette', group: 'View', label: 'Command palette', shortcut: 'Ctrl+K', run: () => dispatch(ui.setCommandOpen(true)) },
      ...WORKSPACE_ORDER.map((w, i) => ({ id: `ws-${w}`, group: 'Go', label: `Go to ${w[0].toUpperCase()}${w.slice(1)}`, shortcut: String(i + 1), run: () => dispatch(ui.setWorkspace(w)) })),

      { id: 'sim', group: 'Simulate', label: 'Start / stop live simulation', shortcut: 'R', run: () => dispatch(ui.setLive({ on: !S().ui.live.on })) },
      ...[1, 3, 10].map((x) => ({ id: `load-${x}`, group: 'Simulate', label: `Traffic ×${x}${x === 10 ? ' (peak event)' : ''}`, run: () => dispatch(ui.setLive({ on: true, load: x })) })),
      { id: 'chaos', group: 'Simulate', label: 'Chaos: take down a random service', run: () => { const c = doc().nodes.filter((n) => ['service', 'worker'].includes(n.techId) && !S().ui.live.down.includes(n.id)); if (!c.length) return; const n = c[Math.floor(Math.random() * c.length)]; dispatch(ui.toggleDown(n.id)); toast(`${n.name} is down`, 'warn') } },
      { id: 'heal', group: 'Simulate', label: 'Restore all services', run: () => dispatch(ui.setLive({ down: [] })) },

      { id: 'validate', group: 'Deploy', label: 'Validate design', run: () => dispatch(ui.setDock('problems')) },
      { id: 'deploy', group: 'Deploy', label: 'Open the release pipeline', enabled: () => canDeploy, run: () => dispatch(ui.setWorkspace('deploy')) },
      { id: 'agent', group: 'Agents', label: 'Ask the agent', shortcut: 'Ctrl+I', run: () => bus.emit('focus-agent') },
      { id: 'shortcuts', group: 'Help', label: 'Keyboard shortcuts', shortcut: '?', run: () => bus.emit('shortcuts') },
    ]
    return cmds
  }, [dispatch, edit, st, dialogs, canEdit, canDeploy])
}
