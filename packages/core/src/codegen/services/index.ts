import type { SystemNode, ProjectDoc } from '../../domain/types'
import { builtInAuth } from '../deploy/runtime'
import { typescriptAuthService } from './typescript'
import { TECH_BY_ID } from '../../catalog/technologies'
import { graphqlSchema, openapi, protoFile, protoNames } from '../backend'
import { goService } from './go'
import { javaService, kotlinService, scalaService } from './jvm'
import { type Files, type ServiceModel, buildModel, ident, snake } from './model'
import { cppService, csharpService, elixirService, phpService, rubyService, swiftService, zigService } from './others'
import { pythonService } from './python'
import { rustService } from './rust'
import { typescriptService } from './typescript'

export type { Files, ServiceModel } from './model'
export { buildModel } from './model'

export const protoStem = (name: string) => ident(snake(name))

export const GENERATORS: Record<string, (m: ServiceModel, c: { proto: string; pkg?: string; svc?: string }) => Files> = {
  TypeScript: (m, c) => typescriptService(m, c),
  Go: (m) => goService(m),
  Python: (m, c) => pythonService(m, c),
  Rust: (m) => rustService(m),
  Java: (m) => javaService(m),
  Kotlin: (m) => kotlinService(m),
  Scala: (m) => scalaService(m),
  'C#': (m) => csharpService(m),
  Ruby: (m) => rubyService(m),
  PHP: (m) => phpService(m),
  Elixir: (m) => elixirService(m),
  Swift: (m) => swiftService(m),
  'C++': (m) => cppService(m),
  Zig: (m) => zigService(m),
}

export function serviceFiles(doc: ProjectDoc, n: SystemNode): Files {
  if (n.id === builtInAuth(doc)?.id) return typescriptAuthService(buildModel(doc, n))
  if (TECH_BY_ID[n.techId]?.image !== 'build') return {}
  const m = buildModel(doc, n)
  const contracts: Files = {}
  const proto = protoStem(n.name)
  let names: { pkg?: string; svc?: string } = {}
  if (m.spec && m.kind === 'api') {
    if (m.style === 'graphql') contracts[`${m.dir}/schema.graphql`] = graphqlSchema(m.spec)
    else if (m.style === 'grpc') {
      contracts[`${m.dir}/proto/${proto}.proto`] = protoFile(m.spec, n)
      names = protoNames(m.spec, n)
    } else if (m.routes.length) contracts[`${m.dir}/openapi.yaml`] = openapi(m.spec, n)
  }
  const generate = GENERATORS[m.language] ?? GENERATORS.TypeScript
  const files = { ...contracts, ...generate(m, { proto, ...names }) }
  const springSchema = `${m.dir}/src/main/resources/graphql/schema.graphqls`
  if (springSchema in files && m.spec) files[springSchema] = graphqlSchema(m.spec)
  return files
}
