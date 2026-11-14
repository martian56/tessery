import { icons, type LucideIcon } from 'lucide-react'

/** Lucide's own names, such as "a-arrow-down" for AArrowDown: a dash before each capital and digit run. */
const kebab = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z])(?=[A-Z])/g, '$1-').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase()
const squash = (name: string) => name.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
const BY_NAME = new Map(Object.keys(icons).map((key) => [squash(key), key]))

/** Every Lucide icon name in the form pages use, such as "git-branch", for pickers. */
export const ICON_NAMES = Object.keys(icons).map(kebab)

/** Draws page icon elements in the editor the same way generated apps do. Any spelling of a name resolves. */
export function EditorIcon({ name, ...rest }: { name: string; className: string; 'aria-hidden'?: boolean; 'aria-label'?: string; 'data-node'?: string }) {
  const key = BY_NAME.get(squash(name))
  const Found = key ? (icons as Record<string, LucideIcon>)[key] : undefined
  return Found ? <Found {...rest} /> : <span className={rest.className} data-node={rest['data-node']} aria-hidden />
}
