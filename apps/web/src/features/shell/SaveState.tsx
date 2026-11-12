import { AlertTriangle } from 'lucide-react'
import { useLazyGetProjectQuery } from '@/api/endpoints/projects'
import { errorMessage } from '@/api/types'
import type { ProjectDoc } from '@tessery/core/domain/types'
import { useAppDispatch, useAppSelector } from '@/store'
import { projectActions } from '@/store/projectSlice'
import { Button, DropdownMenu, toast, useDialogs } from '@/ui'

export function SaveState({ className }: { className?: string }) {
  const dispatch = useAppDispatch()
  const dialogs = useDialogs()
  const { dirty, saving, conflict, saveError, doc } = useAppSelector((st) => st.project)
  const [fetchProject] = useLazyGetProjectQuery()

  if (conflict) {
    const latest = async () => {
      const r = await fetchProject(doc!.id)
      if (!r.data) { toast(errorMessage(r.error), 'err'); return null }
      return r.data
    }
    const reload = async () => {
      if (!(await dialogs.confirm({ title: 'Load the latest version?', body: 'Your unsaved changes are replaced by the saved copy. Undo brings them back.', ok: 'Load latest' }))) return
      const p = await latest()
      if (p) dispatch(projectActions.rebased({ doc: structuredClone(p.doc) as unknown as ProjectDoc, version: p.version }))
    }
    const overwrite = async () => {
      if (!(await dialogs.confirm({ title: 'Overwrite the saved version?', body: 'Changes someone else saved since you opened the project are replaced by yours. They stay in version history.', ok: 'Overwrite', danger: true }))) return
      const p = await latest()
      if (p) dispatch(projectActions.overwrite({ version: p.version }))
    }
    return (
      <DropdownMenu align="end" trigger={<Button size="sm" variant="danger" icon={<AlertTriangle />}>Conflict</Button>} items={[
        { kind: 'heading', label: 'Someone else saved this project' },
        { label: 'Load their version', onSelect: reload },
        { label: 'Overwrite with mine', danger: true, onSelect: overwrite },
      ]} />
    )
  }
  if (saveError) return <Button size="xs" variant="ghost" title={saveError} onClick={() => dispatch(projectActions.saveRequested())}><span style={{ color: 'var(--err)' }}>save failed, retry</span></Button>
  return <span className={className}>{saving ? 'saving…' : dirty ? 'unsaved' : 'saved'}</span>
}
