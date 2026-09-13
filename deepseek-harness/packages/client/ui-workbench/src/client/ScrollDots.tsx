/** Accessible scroll handles migrated from the original workbench. */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import css from './workbench.module.css'

type ScrollDot = { element: HTMLElement, left: number, top: number, travel: number, progress: number }

/** Floating handles only replace the vertical scrollbar; native scrolling stays intact. */
export function ScrollDots({ root, label }: { root: RefObject<HTMLDivElement>, label: string }) {
  const layer = useRef<HTMLDivElement>(null)
  const [dots, setDots] = useState<ScrollDot[]>([])
  const drag = useRef<{ element: HTMLElement, y: number, top: number, travel: number } | null>(null)

  useEffect(() => {
    const host = root.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const registered = new Set<HTMLElement>()
    let scrollable: HTMLElement[] = []
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    const update = () => {
      frame = 0
      const bounds = host.getBoundingClientRect()
      const next: ScrollDot[] = []
      for (const element of scrollable) {
        const rect = element.getBoundingClientRect()
        const range = element.scrollHeight - element.clientHeight
        const visible = rect.height > 28 && rect.width > 0 && range > 1
          && /auto|scroll/.test(getComputedStyle(element).overflowY)
        if (!visible) {
          element.removeAttribute('data-scroll-dot')
          continue
        }
        element.setAttribute('data-scroll-dot', '')
        const travel = Math.max(1, element.clientHeight - 28)
        next.push({ element, left: rect.right - bounds.left - 26, top: rect.top - bounds.top + element.clientTop + 2,
          travel, progress: Math.max(0, Math.min(1, element.scrollTop / range)) })
      }
      setDots(next)
    }
    const discover = () => {
      for (const element of registered) {
        if (!host.contains(element)) { resize.unobserve(element); registered.delete(element); element.removeAttribute('data-scroll-dot') }
      }
      for (const element of host.querySelectorAll<HTMLElement>('*')) {
        if (layer.current?.contains(element) || registered.has(element)) continue
        registered.add(element)
        resize.observe(element)
      }
      scrollable = [...registered].filter(element => /auto|scroll/.test(getComputedStyle(element).overflowY))
      schedule()
    }
    const mutations = new MutationObserver(records => {
      if (records.some(record => !layer.current?.contains(record.target))) discover()
    })
    mutations.observe(host, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-collapsed'] })
    resize.observe(host)
    host.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    discover()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      host.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      for (const element of registered) element.removeAttribute('data-scroll-dot')
    }
  }, [root])

  return <div ref={layer} className={css.scrollDotLayer}>
    {dots.map((dot, index) => <div
      key={index}
      role="scrollbar"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(dot.progress * 100)}
      tabIndex={0}
      className={css.scrollDot}
      style={{ left: dot.left, top: dot.top + dot.travel * dot.progress }}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { element: dot.element, y: event.clientY, top: dot.element.scrollTop, travel: dot.travel }
      }}
      onPointerMove={event => {
        const current = drag.current
        if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        current.element.scrollTop = current.top + (event.clientY - current.y) / current.travel * (current.element.scrollHeight - current.element.clientHeight)
      }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onLostPointerCapture={() => { drag.current = null }}
      onWheel={event => { dot.element.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dot.element.clientHeight : 1) }}
      onKeyDown={event => {
        const element = dot.element
        const positions: Record<string, number> = {
          ArrowDown: element.scrollTop + 40, ArrowUp: element.scrollTop - 40,
          PageDown: element.scrollTop + element.clientHeight, PageUp: element.scrollTop - element.clientHeight,
          Home: 0, End: element.scrollHeight,
        }
        if (positions[event.key] === undefined) return
        event.preventDefault()
        element.scrollTop = positions[event.key]!
      }}
    ><span /></div>)}
  </div>
}
