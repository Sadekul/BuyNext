import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Compact from this far down, full again above the lower mark (no flicker around one line).
const COMPACT_FROM = 120
const FULL_ABOVE = 60

/**
 * Phase 17 sticky header without a layout jump.
 *
 * - The top bar (the first row, `topBarRef`) scrolls away: the header sticks at
 *   minus the top bar's height (`--top-bar-height`, measured).
 * - Scrolled down, the header turns compact (`compact` true: a shorter bar).
 *   The height it loses is given back as its bottom margin, so nothing below
 *   it moves: the page under the pointer stays where it was.
 * Height changes are not animated, so reduced motion needs nothing more.
 */
export function useStickyHeader() {
  const headerRef = useRef(null)
  const topBarRef = useRef(null)
  const fullHeight = useRef(0)
  const isCompact = useRef(false)
  const [compact, setCompact] = useState(false)

  // The top bar's height, kept up to date (it wraps on narrow screens, or closes).
  useEffect(() => {
    const header = headerRef.current
    const topBar = topBarRef.current
    if (!header || !topBar) return undefined
    const measure = () => header.style.setProperty('--top-bar-height', `${topBar.offsetHeight}px`)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(topBar)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let frame = 0
    function check() {
      frame = 0
      const y = window.scrollY
      const next = isCompact.current ? y > FULL_ABOVE : y > COMPACT_FROM
      if (next === isCompact.current) return
      // The full height right now (categories and the top bar may have loaded since the last time).
      if (next) fullHeight.current = headerRef.current?.offsetHeight ?? 0
      isCompact.current = next
      setCompact(next)
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Before paint: give the height the compact header lost back as margin (none when full).
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    if (!compact) {
      header.style.marginBottom = ''
      return
    }
    const lost = fullHeight.current - header.offsetHeight
    header.style.marginBottom = lost > 0 ? `${lost}px` : ''
  }, [compact])

  return { headerRef, topBarRef, compact }
}
