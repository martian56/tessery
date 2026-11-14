import type { ElementType, StyleMap, UIElement } from '@tessery/core/domain/types'
import type { PageTool } from '@/store/uiSlice'

export interface ElementSeed { type: ElementType; name?: string; props?: UIElement['props']; style?: StyleMap; tablet?: StyleMap; mobile?: StyleMap; hover?: StyleMap; children?: ElementSeed[] }

/** What a tool creates, styled with theme tokens so new elements match the site's theme. */
export const SEEDS: Partial<Record<PageTool, (size?: { w: number; h: number }) => ElementSeed>> = {
  frame: (s) => ({ type: 'frame', name: 'Frame', style: { display: 'flex', flexDirection: 'column', gap: 16, padding: 24, background: 'var(--c-surface)', borderRadius: 'var(--radius)', ...(s ? { width: s.w, minHeight: s.h } : { width: '100%', minHeight: 160 }) } }),
  text: (s) => ({ type: 'text', name: 'Text', props: { tag: 'p', text: 'Write something worth reading.' }, style: { fontSize: 18, lineHeight: 1.5, color: 'var(--c-text)', ...(s && s.w > 40 ? { width: s.w } : {}) } }),
  button: () => ({ type: 'button', name: 'Button', props: { text: 'Get started', href: '#' }, style: { padding: '12px 22px', background: 'var(--c-primary)', color: 'var(--c-onPrimary)', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: 15 } }),
  image: (s) => ({ type: 'image', name: 'Image', props: { src: '', alt: '' }, style: { width: s?.w ?? 360, height: s?.h ?? 240, objectFit: 'cover', borderRadius: 'var(--radius)', background: 'var(--c-border)' } }),
  video: (s) => ({ type: 'video', name: 'Video', props: { src: '', autoplay: true, muted: true, loop: true }, style: { width: s?.w ?? 480, height: s?.h ?? 270, objectFit: 'cover', borderRadius: 'var(--radius)', background: '#000' } }),
  rect: (s) => ({ type: 'shape', name: 'Rectangle', props: { shape: 'rect' }, style: { width: s?.w ?? 160, height: s?.h ?? 120, background: 'var(--c-primary)', borderRadius: 8 } }),
  ellipse: (s) => ({ type: 'shape', name: 'Ellipse', props: { shape: 'ellipse' }, style: { width: s?.w ?? 140, height: s?.h ?? 140, background: 'var(--c-primary)', borderRadius: '50%' } }),
  embed: (s) => ({ type: 'embed', name: 'Embed', props: { src: '', title: 'Embedded content' }, style: { width: s?.w ?? 560, height: s?.h ?? 315, borderRadius: 'var(--radius)' } }),
}

export const TOOL_LABEL: Record<PageTool, string> = {
  select: 'Select (V)', frame: 'Frame (F)', text: 'Text (T)', button: 'Button (B)', image: 'Image (I)', video: 'Video', rect: 'Rectangle (R)', ellipse: 'Ellipse (O)', pen: 'Pen (P)', pencil: 'Pencil (Shift+P)', embed: 'Embed',
}

export const TOOL_KEYS: Record<string, PageTool> = { v: 'select', f: 'frame', t: 'text', b: 'button', i: 'image', r: 'rect', o: 'ellipse', p: 'pen' }

/** Box-drawing tools insert an element sized by the drag; a click inserts it at its default size. */
export const BOX_TOOLS = new Set<PageTool>(['frame', 'text', 'button', 'image', 'video', 'rect', 'ellipse', 'embed'])
