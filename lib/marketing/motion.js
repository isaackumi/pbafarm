/**
 * Motion for the marketing site (Paper landing v4, legal pages, 404). Small,
 * dependency-free: CSS does the animating (styles/marketing.css), these hooks
 * only say when. Everything respects prefers-reduced-motion: reveals show at
 * once, counters jump to their value, parallax stays still.
 */
import { createElement, useEffect, useRef, useState } from 'react'

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** True once the element has scrolled into view (and stays true when `once`). */
export function useInView(ref, { threshold = 0.18, rootMargin = '0px 0px -8% 0px', once = true } = {}) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setInView(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (once) io.disconnect()
        } else if (!once) setInView(false)
      },
      { threshold, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, threshold, rootMargin, once])
  return inView
}

/**
 * Fades and lifts its children in when scrolled into view. `delay` in ms;
 * `variant`: 'up' (default), 'fade', 'scale', 'left', 'right'. Children with
 * the `mk-stagger` class on the wrapper animate one after another.
 */
export function Reveal({ as = 'div', delay = 0, variant = 'up', className = '', style, children, ...rest }) {
  const ref = useRef(null)
  const inView = useInView(ref)
  return createElement(
    as,
    {
      ref,
      className: `mk-reveal mk-reveal-${variant} ${inView ? 'is-in' : ''} ${className}`,
      style: { ...style, '--mk-delay': `${delay}ms` },
      ...rest,
    },
    children,
  )
}

/** Counts from 0 to `value` once `active` turns true (ease-out, ~1.2 s). */
export function useCountUp(value, active, { duration = 1200, decimals = 0 } = {}) {
  const [shown, setShown] = useState(active && prefersReducedMotion() ? value : 0)
  useEffect(() => {
    if (!active) return undefined
    if (prefersReducedMotion()) {
      setShown(value)
      return undefined
    }
    let raf
    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - p) ** 3
      setShown(Number((value * eased).toFixed(decimals)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, active, duration, decimals])
  return shown
}

/** A number that counts up when it scrolls into view. */
export function CountUp({ value, decimals = 0, format = (n) => n.toLocaleString('en'), className = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref)
  const n = useCountUp(value, inView, { decimals })
  return (
    <span ref={ref} className={className}>
      {format(n)}
    </span>
  )
}

/**
 * Scroll-linked progress for parallax: writes `--mk-p` (0 when the element's
 * top meets the viewport bottom, 1 when its bottom leaves the top) on the
 * element. CSS turns it into transforms, e.g.
 * `transform: translateY(calc(var(--mk-p) * -40px))`.
 */
export function useScrollProgress(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return undefined
    let raf = 0
    const update = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)))
      el.style.setProperty('--mk-p', p.toFixed(4))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref])
}
