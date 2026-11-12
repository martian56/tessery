import { defaultObservability, env, project, uid } from '../domain/builders'

export function blankTemplate(name = 'untitled', provider = 'aws', region = 'eu-central-1') {
  return project({
    id: uid('p'), name, icon: '○', description: 'Empty project.',
    nodes: [], edges: [], apis: {}, databases: {}, pages: [],
    environments: [
      env('dev', 'Development', 'self', 'onprem', { scale: 0.5, strategy: 'recreate', autoRollback: false }),
      env('staging', 'Staging', provider, region),
      env('prod', 'Production', provider, region, { scale: 2, strategy: 'canary', approval: true }),
    ],
    observability: defaultObservability(),
  })
}
