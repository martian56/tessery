import { icons, type LucideIcon } from 'lucide-react'

export const pascal = (name: string) => name.split(/[-_ ]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase()

/** Every Lucide icon name in the form pages use, such as "git-branch", for pickers. */
export const ICON_NAMES = Object.keys(icons).map(kebab)

/** Draws page icon elements in the editor the same way generated apps do. */
export function EditorIcon({ name, ...rest }: { name: string; className: string; 'aria-hidden'?: boolean; 'aria-label'?: string; 'data-node'?: string }) {
  const Found = (icons as Record<string, LucideIcon>)[pascal(name)]
  return Found ? <Found {...rest} /> : <span className={rest.className} data-node={rest['data-node']} aria-hidden />
}
