export interface NavItem {
  path: string
  label: string
}

export const nav: NavItem[] = [
  { path: '/evaluations', label: 'Your cases' },
  { path: '/settings/api-keys', label: 'Provider keys' },
  { path: '/sample', label: 'Sample case' },
  { path: '/glossary', label: 'Glossary' },
]
