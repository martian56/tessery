import { normalizeDoc } from '@tessery/core/domain/normalize'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useGetProjectQuery } from '@/api/endpoints/projects'
import { useMeQuery, useSetupStatusQuery } from '@/api/endpoints/identity'
import { errorMessage } from '@/api/types'
import { projectActions } from '@/store/projectSlice'
import { ui } from '@/store/uiSlice'
import { useAppDispatch, useAppSelector } from '@/store'
import { Button, Empty, ErrorBoundary } from '@/ui'
import { navigate, useRoute } from './router'
import { usePermissions } from './usePermissions'
import { ProjectHome } from '@/features/home/ProjectHome'
import { SetupPage } from '@/features/auth/SetupPage'
import { LoginPage } from '@/features/auth/LoginPage'

const Shell = lazy(() => import('@/features/shell/Shell').then((m) => ({ default: m.Shell })))
const OrgSettings = lazy(() => import('@/features/settings/OrgSettings').then((m) => ({ default: m.OrgSettings })))
const AdminPage = lazy(() => import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage })))
const AccountPage = lazy(() => import('@/features/account/AccountPage').then((m) => ({ default: m.AccountPage })))

export function App() {
  const route = useRoute()
  const setup = useSetupStatusQuery()
  const me = useMeQuery(undefined, { skip: !setup.data || setup.data.required })
  if (setup.isLoading) return <Empty title="Loading…" />
  if (setup.error) return <Empty title="Cannot reach the Tessery server" action={<Button onClick={() => setup.refetch()}>Retry</Button>}>{errorMessage(setup.error)}</Empty>
  if (setup.data?.required) return <SetupPage />
  if (me.isLoading) return <Empty title="Loading…" />
  if (!me.data) return <LoginPage />
  return <ErrorBoundary label="Tessery" resetKey={JSON.stringify(route)}><Suspense fallback={<Empty title="Loading…" />}><Routes /></Suspense></ErrorBoundary>
}

function Routes() {
  const route = useRoute()
  switch (route.name) {
    case 'project': return <ProjectLoader id={route.id} />
    case 'settings': return <OrgSettings section={route.section} />
    case 'admin': return <AdminPage section={route.section} />
    case 'account': return <AccountPage />
    default: return <ProjectHome />
  }
}

function ProjectLoader({ id }: { id: string }) {
  const dispatch = useAppDispatch()
  const loadedId = useAppSelector((s) => s.project.doc?.id)
  const [gone, setGone] = useState(false)
  const { data, error, isLoading } = useGetProjectQuery(id, { refetchOnMountOrArgChange: true, pollingInterval: gone ? 0 : 5000, skipPollingIfUnfocused: true })
  useEffect(() => { setGone(!!error && 'status' in error && (error.status === 404 || error.status === 403)) }, [error])
  const localVersion = useAppSelector((s) => s.project.version)
  const perms = usePermissions({ org: data?.orgId, project: data?.id })
  const readOnly = !perms.isLoading && !perms.can('project:edit')
  const shell = useMemo(() => <Shell />, [])

  useEffect(() => {
    if (data && data.id !== loadedId) {
      const doc = normalizeDoc(structuredClone(data.doc))
      dispatch(projectActions.loaded({ doc, version: data.version, orgId: data.orgId, readOnly: true }))
      dispatch(ui.resetForProject())
      if (doc.environments[0]) dispatch(ui.setEnv(doc.environments[0].id))
    }
  }, [data, loadedId, dispatch])
  useEffect(() => {
    if (data && data.id === loadedId && data.version > localVersion) {
      dispatch(projectActions.serverUpdated({ doc: normalizeDoc(structuredClone(data.doc)), version: data.version }))
    }
  }, [data, loadedId, localVersion, dispatch])
  useEffect(() => {
    if (data && loadedId === data.id && !perms.isLoading) dispatch(projectActions.setReadOnly(readOnly))
  }, [data, loadedId, perms.isLoading, readOnly, dispatch])
  useEffect(() => () => { dispatch(projectActions.closed()) }, [dispatch])

  if (error) return <Empty title="Project not found" action={<Button variant="primary" onClick={() => navigate('/')}>Back to projects</Button>}>It may have been deleted, or you no longer have access.</Empty>
  if (isLoading || loadedId !== id) return <Empty title="Loading project…" />
  return shell
}
