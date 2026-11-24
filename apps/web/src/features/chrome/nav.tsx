import { NavIcon } from '@/ui/icons/Icon'
import type { ReactNode } from 'react'

export interface NavItem { id: string; label: string; icon?: ReactNode }

/** Organization pages, each shown to people with the permission to read it. */
export const ORG_SECTIONS: (NavItem & { perm: string })[] = [
  { id: 'general', label: 'General', icon: <NavIcon name="general" />, perm: 'org:read' },
  { id: 'members', label: 'Members', icon: <NavIcon name="members" />, perm: 'member:read' },
  { id: 'teams', label: 'Teams', icon: <NavIcon name="teams" />, perm: 'team:read' },
  { id: 'servers', label: 'Servers', icon: <NavIcon name="servers" />, perm: 'server:read' },
  { id: 'integrations', label: 'Integrations', icon: <NavIcon name="integrations" />, perm: 'integration:read' },
  { id: 'roles', label: 'Roles', icon: <NavIcon name="roles" />, perm: 'role:read' },
  { id: 'access', label: 'Access', icon: <NavIcon name="access" />, perm: 'role:read' },
  { id: 'audit', label: 'Audit log', icon: <NavIcon name="audit" />, perm: 'audit:read' },
]

/** Instance administration, for instance administrators only. */
export const ADMIN_SECTIONS: NavItem[] = [
  { id: 'users', label: 'Users', icon: <NavIcon name="users" /> },
  { id: 'orgs', label: 'Organizations', icon: <NavIcon name="orgs" /> },
  { id: 'email', label: 'Email', icon: <NavIcon name="email" /> },
  { id: 'github', label: 'GitHub', icon: <NavIcon name="github" /> },
  { id: 'settings', label: 'Instance settings', icon: <NavIcon name="settings" /> },
  { id: 'updates', label: 'Updates', icon: <NavIcon name="activity" /> },
]
