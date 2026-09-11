import { useEffect, useRef, useState } from 'react'

/**
 * Tracks an element's content width. Charts draw into an SVG with real pixel
 * coordinates rather than a scaled viewBox — a viewBox would stretch the axis
 * text along with the marks — so they need the width the layout actually gave
 * them, and need to redraw when it changes.
 *
 * The width is 0 until the first measurement, which is a caller's cue to render
 * nothing yet rather than lay a chart out against a guess.
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      // `contentRect` already excludes padding, which is what the plot gets.
      setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
