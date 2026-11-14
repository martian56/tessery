import type { ProjectDoc } from '../domain/types'
import { runOp } from '../domain/ops'
import { blankTemplate } from './blank'

export function tasksTemplate(name = 'tasks'): ProjectDoc {
  const doc = blankTemplate(name, 'self', 'onprem')
  doc.description = 'Projects and tasks with sign-in. Every part is generated and works on the first deploy.'
  doc.icon = 'T'
  const add = (techId: string, nodeName: string, x: number, y: number, config: Record<string, string | number> = {}) => runOp(doc, 'addNode', { techId, name: nodeName, x, y, config }) as string
  const web = add('web-app', 'web', 0, 120, { framework: 'Next.js' })
  const auth = add('auth-service', 'accounts', 320, 0, { engine: 'Built-in (Tessery)' })
  const api = add('service', 'tasks-api', 320, 240, { language: 'TypeScript', framework: 'Fastify', port: 8080 })
  const db = add('postgres', 'tasks-db', 640, 120)
  for (const [s, t] of [[web, auth], [web, api], [api, db], [auth, db]]) runOp(doc, 'connect', { source: s, target: t })
  runOp(doc, 'updateApi', { nodeId: api, patch: { framework: 'Fastify', language: 'TypeScript' } })

  const projects = runOp(doc, 'addTable', { nodeId: db, name: 'projects' }) as string
  for (const column of [{ name: 'user_id', type: 'uuid' as const }, { name: 'name', type: 'text' as const, nullable: false }, { name: 'description', type: 'text' as const }]) {
    runOp(doc, 'addColumn', { nodeId: db, tableId: projects, column })
  }
  const tasks = runOp(doc, 'addTable', { nodeId: db, name: 'tasks' }) as string
  for (const column of [
    { name: 'user_id', type: 'uuid' as const },
    { name: 'project_id', type: 'uuid' as const, nullable: false, ref: { table: 'projects', column: 'id', onDelete: 'cascade' as const } },
    { name: 'title', type: 'text' as const, nullable: false },
    { name: 'done', type: 'boolean' as const, nullable: false, default: 'false' },
  ]) runOp(doc, 'addColumn', { nodeId: db, tableId: tasks, column })

  runOp(doc, 'addCrudOperations', { nodeId: api, table: 'projects' })
  for (const [kind, opName, summary] of [['GET /projects/{projectId}/tasks', 'listProjectTasks', 'Tasks of a project'], ['POST /projects/{projectId}/tasks', 'createProjectTask', 'Add a task to a project'], ['PATCH /tasks/{id}', 'updateTask', 'Change a task'], ['DELETE /tasks/{id}', 'deleteTask', 'Delete a task']]) {
    runOp(doc, 'addOperation', { nodeId: api, kind, name: opName, summary })
  }

  const home = runOp(doc, 'addPage', { appNodeId: web, name: 'Projects', route: '/' }) as string
  runOp(doc, 'updatePage', { pageId: home, patch: { access: 'user', title: 'Your projects' } })
  doc.pages.find((p) => p.id === home)!.root.children = []
  runOp(doc, 'addBlock', { pageId: home, type: 'navbar', props: { brand: name, links: '', cta: 'Sign out' } })
  runOp(doc, 'addBlock', { pageId: home, type: 'form', props: { title: 'New project', fields: 'Name, Description', submit: 'Create', action: `${api}:createProject` } })
  runOp(doc, 'addBlock', { pageId: home, type: 'table', props: { title: 'Projects', columns: 'Name, Description, Created at', source: `${api}:listProjects`, link: '/projects/{id}' } })

  const detail = runOp(doc, 'addPage', { appNodeId: web, name: 'Project', route: '/projects/[projectId]' }) as string
  runOp(doc, 'updatePage', { pageId: detail, patch: { access: 'user', title: 'Project' } })
  doc.pages.find((p) => p.id === detail)!.root.children = []
  runOp(doc, 'addBlock', { pageId: detail, type: 'navbar', props: { brand: name, links: '', cta: 'Sign out' } })
  runOp(doc, 'addBlock', { pageId: detail, type: 'form', props: { title: 'New task', fields: 'Title', submit: 'Add task', action: `${api}:createProjectTask` } })
  runOp(doc, 'addBlock', { pageId: detail, type: 'table', props: { title: 'Tasks', columns: 'Title, Done, Created at', source: `${api}:listProjectTasks` } })
  return doc
}
