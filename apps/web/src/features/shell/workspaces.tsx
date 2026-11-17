import type { ComponentType } from 'react'
import { navIcon } from '@/ui/icons/Icon'
import type { Workspace } from '@/store/uiSlice'
import { DesignSidebar } from '@/features/design/DesignSidebar'
import { DesignCanvas } from '@/features/design/DesignCanvas'
import { DesignInspector } from '@/features/design/DesignInspector'
import { ApiSidebar } from '@/features/api/ApiSidebar'
import { ApiDesigner } from '@/features/api/ApiDesigner'
import { ApiInspector } from '@/features/api/ApiInspector'
import { DatabaseSidebar } from '@/features/database/DatabaseSidebar'
import { DatabaseView } from '@/features/database/DatabaseView'
import { TableInspector } from '@/features/database/TableInspector'
import { PagesSidebar } from '@/features/pages/PagesSidebar'
import { PageBuilder } from '@/features/pages/PageBuilder'
import { PageInspector } from '@/features/pages/PageInspector'
import { DeploySidebar } from '@/features/deploy/DeploySidebar'
import { DeployView } from '@/features/deploy/DeployView'
import { EnvInspector } from '@/features/deploy/EnvInspector'
import { ObserveSidebar } from '@/features/observe/ObserveSidebar'
import { ObserveView } from '@/features/observe/ObserveView'
import { ObserveInspector } from '@/features/observe/ObserveInspector'

export interface WorkspaceDef { id: Workspace; label: string; hint: string; icon: ComponentType<{ size?: number; className?: string }>; Left: ComponentType; Center: ComponentType; Right: ComponentType }

export const WORKSPACES: WorkspaceDef[] = [
  { id: 'design', label: 'Design', hint: 'System architecture canvas', icon: navIcon('design'), Left: DesignSidebar, Center: DesignCanvas, Right: DesignInspector },
  { id: 'api', label: 'API', hint: 'REST, GraphQL, gRPC, WebSocket… contracts and handlers', icon: navIcon('api'), Left: ApiSidebar, Center: ApiDesigner, Right: ApiInspector },
  { id: 'database', label: 'Database', hint: 'Schema designer, data browser, SQL', icon: navIcon('database'), Left: DatabaseSidebar, Center: DatabaseView, Right: TableInspector },
  { id: 'pages', label: 'Pages', hint: 'Frontend pages and components', icon: navIcon('pages'), Left: PagesSidebar, Center: PageBuilder, Right: PageInspector },
  { id: 'deploy', label: 'Deploy', hint: 'Environments, multi-cloud placement, releases', icon: navIcon('deploy'), Left: DeploySidebar, Center: DeployView, Right: EnvInspector },
  { id: 'observe', label: 'Observe', hint: 'Metrics, logs, traces, SLOs, alerts', icon: navIcon('observe'), Left: ObserveSidebar, Center: ObserveView, Right: ObserveInspector },
]
