import { useCallback, useEffect, useState } from 'react'

const KEY = 'mc.sidebar.rail'

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** The shortcut modifier as shown on this platform: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/**
 * Wide screens can fold the sidebar to a 56 px icon rail. ⌘B / Ctrl+B
 * toggles it; the choice is kept in this browser.
 */
export function useSidebarRail(): [boolean, () => void] {
  const [rail, setRail] = useState(read)
  const toggle = useCallback(() => {
    setRail((current) => {
      const next = !current
      try {
        window.localStorage.setItem(KEY, next ? '1' : '0')
      } catch {
        // Storage can be unavailable (private mode); the rail still toggles for this visit.
      }
      return next
    })
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  return [rail, toggle]
}
