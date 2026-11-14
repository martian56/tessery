import type { Block, Page, ProjectDoc, Theme, UIElement } from './types'

export const DEFAULT_THEME: Theme = {
  colors: { bg: '#fafafa', surface: '#ffffff', text: '#1a1a1a', muted: '#666666', primary: '#e8833a', onPrimary: '#ffffff', border: '#e8e8e8' },
  fonts: { heading: 'system-ui', body: 'system-ui' },
  radius: 6,
}

export const themeOf = (doc: Pick<ProjectDoc, 'themes'>, appNodeId: string): Theme => {
  const t = doc.themes?.[appNodeId]
  return t ? { colors: { ...DEFAULT_THEME.colors, ...t.colors }, fonts: { ...DEFAULT_THEME.fonts, ...t.fonts }, radius: t.radius ?? DEFAULT_THEME.radius } : DEFAULT_THEME
}

export const blockElement = (b: Block): UIElement => ({ id: b.id, type: 'block', props: { block: b.type, ...b.props } })

/** The page's top element: a vertical stack, like a document. */
export const pageRoot = (id: string, children: UIElement[] = []): UIElement => ({
  id,
  type: 'frame',
  name: 'Page',
  props: { tag: 'main' },
  style: { display: 'flex', flexDirection: 'column', minHeight: '100%' },
  children,
})

/** Pages saved before the element tree listed blocks; they become block elements in a page frame. */
export function migratePage(p: Page & { root?: UIElement }): Page {
  if (p.root && p.root.type) return { ...p, blocks: [] }
  return { ...p, root: pageRoot(`root_${p.id}`, (p.blocks ?? []).map(blockElement)), blocks: [] }
}

export function walk(e: UIElement, visit: (e: UIElement, parent: UIElement | null, index: number) => void, parent: UIElement | null = null, index = 0) {
  visit(e, parent, index)
  e.children?.forEach((c, i) => walk(c, visit, e, i))
}

export function find(root: UIElement, id: string): { el: UIElement; parent: UIElement | null; index: number } | null {
  let hit: { el: UIElement; parent: UIElement | null; index: number } | null = null
  walk(root, (el, parent, index) => { if (!hit && el.id === id) hit = { el, parent, index } })
  return hit
}

export const contains = (ancestor: UIElement, id: string) => !!find(ancestor, id)

/** Block elements in document order, which is the order generated pages load their data. */
export const blocksOf = (root: UIElement) => {
  const out: UIElement[] = []
  walk(root, (e) => { if (e.type === 'block') out.push(e) })
  return out
}

export const CONTAINERS = new Set(['frame'])
