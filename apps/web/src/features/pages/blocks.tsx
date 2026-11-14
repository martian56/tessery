import type { ComponentType } from 'react'
import type { Block } from '@tessery/core/domain/types'
import * as Shared from '@tessery/core/render/blocks'
import { BLOCK_CATALOG, BLOCK_META, blockProps, withAssets, type BlockMeta } from '@tessery/core/render/catalog'
import BLOCK_STYLES from '@tessery/core/render/styles.txt'

export type Device = 'desktop' | 'tablet' | 'mobile'
export type BlockDef = BlockMeta

export const BLOCKS: BlockDef[] = BLOCK_CATALOG
export const BLOCK_BY_TYPE: Record<string, BlockDef> = BLOCK_META

const components = Shared as unknown as Record<string, ComponentType<Record<string, unknown>>>

/** The same stylesheet generated apps ship, so the preview matches the deployed page. */
export const PreviewStyles = () => <style>{BLOCK_STYLES}</style>

export function renderBlock(b: Block) {
  const meta = BLOCK_META[b.type]
  const Component = meta && (meta.type === 'form' ? Shared.FormView : components[meta.component])
  if (!Component) return <section className="tsp-sec"><i>Unknown block “{b.type}”</i></section>
  return <Component {...withAssets(blockProps(b), 'editor')} onSubmit={(e: Event) => e.preventDefault()} />
}
