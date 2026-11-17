/**
 * Light paper or "desk at night" (D-47). The choice is kept in this browser;
 * "system" follows the operating system. public/theme.js applies the saved
 * choice before the first paint (the CSP allows only same-origin scripts),
 * and this module keeps it in sync afterwards.
 */

import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'mc.theme'
const EVENT = 'mc-theme'

export function readThemeChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'dark' || value === 'system' ? value : 'light'
  } catch {
    return 'light'
  }
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolve(choice)
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    window.localStorage.setItem(KEY, choice)
  } catch {
    // Unavailable storage: the theme still changes for this visit.
  }
  apply(choice)
  window.dispatchEvent(new Event(EVENT))
}

/** The saved choice and the theme in effect. Renders as light first, so server and client markup match. */
export function useTheme(): { choice: ThemeChoice; theme: 'light' | 'dark' } {
  const [state, setState] = useState<{ choice: ThemeChoice; theme: 'light' | 'dark' }>({ choice: 'light', theme: 'light' })
  useEffect(() => {
    const sync = () => {
      const choice = readThemeChoice()
      setState({ choice, theme: resolve(choice) })
    }
    sync()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystem = () => {
      if (readThemeChoice() === 'system') {
        apply('system')
        sync()
      }
    }
    window.addEventListener(EVENT, sync)
    media.addEventListener('change', onSystem)
    return () => {
      window.removeEventListener(EVENT, sync)
      media.removeEventListener('change', onSystem)
    }
  }, [])
  return state
}
