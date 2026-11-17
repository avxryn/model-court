export interface NavItem {
  path: string
  label: string
}

export const nav: NavItem[] = [
  { path: '/evaluations', label: 'Evaluations' },
  { path: '/settings/api-keys', label: 'API keys' },
  { path: '/sample', label: 'Sample' },
]
