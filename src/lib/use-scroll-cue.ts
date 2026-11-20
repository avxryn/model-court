/**
 * A sideways-scrolling row says there is more (D-120): the hook marks the element with
 * `data-more-start` / `data-more-end` while content is hidden past that edge, and the
 * `scroll-cue` utility (styles.css) fades that edge. Attributes, not state, so scrolling
 * never re-renders the row.
 */

import { useEffect, type RefObject } from 'react'

export function useScrollCue(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const start = element.scrollLeft > 1
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1
      element.toggleAttribute('data-more-start', start)
      element.toggleAttribute('data-more-end', end)
    }
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [ref])
}
