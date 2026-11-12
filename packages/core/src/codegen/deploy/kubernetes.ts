import type { DeployTarget, Environment, ProjectDoc } from '../../domain/types'
import { workloads, type Workload } from './runtime'
import { slug } from './compose'
import { yamlDoc } from './yaml'

type K8sTarget = Extract<DeployTarget, { kind: 'kubernetes' }>

export const SECRET_NAME = 'tessery-secrets'
export const IMAGE_PREFIX = '__TESSERY_IMAGE_PREFIX__'
export const IMAGE_TAG = '__TESSERY_TAG__'

const REF = /\$\{([A-Z0-9_]+)\}/g
const HAS_REF = /\$\{[A-Z0-9_]+\}/
const refs = (values: string[]) => [...new Set(values.flatMap((v) => [...v.matchAll(REF)].map((m) => m[1])))]
const k8sRef = (v: string) => v.replace(REF, '$($1)')
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function namespaceOf(doc: ProjectDoc, env: Environment): string {
  const t = env.target?.kind === 'kubernetes' ? env.target : undefined
  return t?.namespace || `${slug(doc.name)}-${slug(env.id)}`.slice(0, 63)
}

export function publicHost(doc: ProjectDoc, env: Environment, name: string, t: K8sTarget): string | undefined {
  return t.domain ? `${name}.${slug(doc.name)}-${slug(env.id)}.${t.domain}` : undefined
}

function container(w: Workload) {
  const values = [...Object.values(w.env), ...(w.command ?? []), ...(w.health ?? [])]
  const secretEnv = refs(values).map((name) => ({ name, valueFrom: { secretKeyRef: { name: SECRET_NAME, key: name } } }))
  const plainEnv = Object.entries(w.env).map(([name, value]) => ({ name, value: k8sRef(value) }))
  const probe = w.health
    ? { exec: { command: w.health.some((c) => HAS_REF.test(c)) ? ['sh', '-c', w.health.map((c) => (HAS_REF.test(c) ? `"${c.replace(REF, '$$$1')}"` : shQuote(c))).join(' ')] : w.health }, periodSeconds: 5, timeoutSeconds: 5, failureThreshold: 30 }
    : w.httpHealth && w.port
      ? { httpGet: { path: w.httpHealth, port: w.port }, periodSeconds: 5, failureThreshold: 30 }
      : undefined
  return {
    name: w.name,
    image: w.build ? `${IMAGE_PREFIX}${w.name}:${IMAGE_TAG}` : w.image,
    args: w.command?.map(k8sRef),
    ports: w.port ? [{ containerPort: w.port }, ...w.ports.map((p) => ({ containerPort: p }))] : undefined,
    env: secretEnv.length || plainEnv.length ? [...secretEnv, ...plainEnv] : undefined,
    readinessProbe: probe,
    resources: { requests: { cpu: w.cpu, memory: w.memory }, limits: { memory: w.memory } },
    volumeMounts: w.volume ? [{ name: 'data', mountPath: w.volume }] : undefined,
  }
}

function service(ns: string, w: Workload) {
  if (!w.port) return undefined
  return {
    apiVersion: 'v1', kind: 'Service',
    metadata: { name: w.name, namespace: ns },
    spec: { selector: { app: w.name }, ports: [w.port, ...w.ports].map((p) => ({ name: `p${p}`, port: p, targetPort: p })) },
  }
}

export function manifests(doc: ProjectDoc, env: Environment): string {
  const t: K8sTarget = env.target?.kind === 'kubernetes' ? env.target : { kind: 'kubernetes' }
  const ns = namespaceOf(doc, env)
  const labels = (w: Workload) => ({ app: w.name, 'app.kubernetes.io/part-of': slug(doc.name), 'tessery.dev/environment': env.id })
  const docs: unknown[] = [{ apiVersion: 'v1', kind: 'Namespace', metadata: { name: ns } }]
  for (const w of workloads(doc, env)) {
    const pod = { metadata: { labels: labels(w) }, spec: { containers: [container(w)], ...(w.schedule ? { restartPolicy: 'OnFailure' } : {}) } }
    if (w.schedule) {
      docs.push({ apiVersion: 'batch/v1', kind: 'CronJob', metadata: { name: w.name, namespace: ns }, spec: { schedule: w.schedule, concurrencyPolicy: 'Forbid', jobTemplate: { spec: { backoffLimit: 2, template: pod } } } })
      continue
    }
    if (w.role === 'data') {
      const size = `${Math.max(1, Number(w.node.config.storageGb ?? 5))}Gi`
      docs.push({
        apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: w.name, namespace: ns, labels: labels(w) },
        spec: {
          serviceName: w.name, replicas: 1, selector: { matchLabels: { app: w.name } }, template: pod,
          volumeClaimTemplates: w.volume ? [{ metadata: { name: 'data' }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: size } } } }] : undefined,
        },
      })
    } else {
      docs.push({
        apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: w.name, namespace: ns, labels: labels(w) },
        spec: {
          replicas: Math.max(1, Math.round(w.node.replicas * env.scale)),
          selector: { matchLabels: { app: w.name } },
          strategy: env.strategy === 'recreate' ? { type: 'Recreate' } : { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
          template: pod,
        },
      })
    }
    docs.push(service(ns, w))
    const host = w.public && w.port ? publicHost(doc, env, w.name, t) : undefined
    if (host) {
      docs.push({
        apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { name: w.name, namespace: ns },
        spec: { ingressClassName: t.ingressClass, rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: w.name, port: { number: w.port } } } }] } }] },
      })
    }
  }
  return `# ${env.name} on Kubernetes for ${doc.name}, generated by Tessery. Applied by the Tessery runner.\n` + docs.filter(Boolean).map((d) => yamlDoc(d as never)).join('---\n')
}
