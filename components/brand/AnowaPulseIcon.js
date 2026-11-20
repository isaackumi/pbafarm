/**
 * Anowa's icon for UI (nav, buttons, avatars): the logo's pulse line on a
 * 24px grid with the coral dot, a drop-in for a lucide icon (`size`,
 * `strokeWidth`, `className`). Used instead of a generic "AI sparkle" so
 * Anowa reads as the farm's heartbeat, not a chatbot. Written without JSX so
 * plain-JS modules such as lib/navigation.js (and their tests) can import it.
 */
import { createElement as h } from 'react'
// Same coral as ANOWA_CORAL in ./AnowaLogo (that file uses JSX, so it is not imported here).
const ANOWA_CORAL = '#F2A07B'

const LINE = 'M3.6 12H5.2L7.4 5.3L10.5 18.7L13.2 8.9L15 12H17.6L23 6.6V17.4L17.6 12'

export function AnowaPulseIcon({ size = 24, strokeWidth = 2, className = '', dot = true, ...rest }) {
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, focusable: 'false', className, ...rest },
    h('path', { d: LINE, stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    dot ? h('circle', { cx: 1.6, cy: 12, r: 1.5, fill: ANOWA_CORAL }) : null,
  )
}
