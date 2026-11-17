/**
 * Fetch a route's code-split page module before it is clicked (on hover or
 * keyboard focus), so opening a page from the sidebar does not wait on the
 * network. Uses the same page modules the router splits on, so the chunk is
 * shared; each one is requested at most once.
 */

const pages = import.meta.glob(['/src/pages/(app)/**/*.tsx', '!**/_layout.tsx'])

const routes = Object.keys(pages)
  .map((file) => {
    const path = file
      .replace('/src/pages', '')
      .replace(/\/\([^)]+\)/g, '')
      .replace(/\.tsx$/, '')
      .replace(/\/index$/, '')
    const pattern = new RegExp(`^${path.replace(/\[[^\]]+\]/g, '[^/]+')}/?$`)
    return { file, pattern, dynamic: path.includes('[') }
  })
  // Static paths win over dynamic ones (/evaluations before /evaluations/[id]).
  .sort((a, b) => Number(a.dynamic) - Number(b.dynamic))

const requested = new Set<string>()

export function prefetchRoute(to: string): void {
  const pathname = to.split(/[?#]/)[0] || '/'
  const route = routes.find((r) => r.pattern.test(pathname))
  if (!route || requested.has(route.file)) return
  requested.add(route.file)
  void pages[route.file]().catch(() => requested.delete(route.file))
}

/** Props for a Link that prefetches its page on hover and keyboard focus. */
export function prefetchProps(to: string) {
  return { onMouseEnter: () => prefetchRoute(to), onFocus: () => prefetchRoute(to) }
}
