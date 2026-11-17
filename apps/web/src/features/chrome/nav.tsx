import { Building2, Cloud, Github, KeyRound, Mail, ScrollText, Server, ShieldCheck, SlidersHorizontal, Users, UsersRound } from 'lucide-react'
import type { ReactNode } from 'react'

export interface NavItem { id: string; label: string; icon?: ReactNode }

/** Organization pages, each shown to people with the permission to read it. */
export const ORG_SECTIONS: (NavItem & { perm: string })[] = [
  { id: 'general', label: 'General', icon: <Building2 />, perm: 'org:read' },
  { id: 'members', label: 'Members', icon: <Users />, perm: 'member:read' },
  { id: 'teams', label: 'Teams', icon: <UsersRound />, perm: 'team:read' },
  { id: 'servers', label: 'Servers', icon: <Server />, perm: 'server:read' },
  { id: 'integrations', label: 'Integrations', icon: <Cloud />, perm: 'integration:read' },
  { id: 'roles', label: 'Roles', icon: <KeyRound />, perm: 'role:read' },
  { id: 'access', label: 'Access', icon: <ShieldCheck />, perm: 'role:read' },
  { id: 'audit', label: 'Audit log', icon: <ScrollText />, perm: 'audit:read' },
]

/** Instance administration, for instance administrators only. */
export const ADMIN_SECTIONS: NavItem[] = [
  { id: 'users', label: 'Users', icon: <Users /> },
  { id: 'orgs', label: 'Organizations', icon: <Building2 /> },
  { id: 'email', label: 'Email', icon: <Mail /> },
  { id: 'github', label: 'GitHub', icon: <Github /> },
  { id: 'settings', label: 'Instance settings', icon: <SlidersHorizontal /> },
]
