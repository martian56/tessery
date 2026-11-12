import type { ProjectDoc } from '../types'
import { graphOps } from './graph'
import { apiOps, dbOps, envOps, obsOps, pageOps } from './design'

export const OPS = { ...graphOps, ...apiOps, ...dbOps, ...pageOps, ...envOps, ...obsOps }
export type OpName = keyof typeof OPS
export type OpArgs<K extends OpName> = Parameters<(typeof OPS)[K]>[1]
export type OpResult<K extends OpName> = ReturnType<(typeof OPS)[K]>

export function runOp<K extends OpName>(doc: ProjectDoc, name: K, args: OpArgs<K>): OpResult<K> {
  return (OPS[name] as (d: ProjectDoc, a: OpArgs<K>) => OpResult<K>)(doc, args)
}
