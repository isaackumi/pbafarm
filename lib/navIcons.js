// Top-level nav icons drawn in Paper (Shell 7Z-0, nodes EV/ET/EN/ED/DK).
// Same props as lucide icons (size, strokeWidth, className).
import { createElement as h } from 'react'

// Paper draws these with round caps; only Home also has round joins.
function icon(name, children, { linejoin = 'miter', muted = false } = {}) {
  function NavIcon({ size = 16, strokeWidth = 2, className, ...props }) {
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: linejoin,
        className,
        ...props,
      },
      ...children,
    )
  }
  NavIcon.displayName = name
  // Paper 7Z-0 / 69 / L · 01: the Settings icon is drawn in the muted colour.
  NavIcon.muted = muted
  return NavIcon
}

const path = (d) => h('path', { key: d, d })
const circle = (r, key = r) => h('circle', { key, cx: 12, cy: 12, r })

export const HomeIcon = icon('HomeIcon', [path('M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z')], { linejoin: 'round' })
export const TasksIcon = icon('TasksIcon', [path('M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12h2M4 18h2')])
export const CagesIcon = icon('CagesIcon', [circle(9), circle(4)])
export const ProductionIcon = icon('ProductionIcon', [path('M2 12c3-5 9-7 14-3l5-4v14l-5-4c-5 4-11 2-14-3z')])
export const FeedIcon = icon('FeedIcon', [path('M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10')])
export const FinanceIcon = icon('FinanceIcon', [path('M3 17l6-6 4 4 8-8M15 7h6v6')])
export const ReportsIcon = icon('ReportsIcon', [path('M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M9 13h6M9 17h4')])
export const SettingsIcon = icon('SettingsIcon', [
  path('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'),
  circle(3),
], { muted: true })

/** Row chevrons (7Z-0): right on closed groups, down on the open one. */
export const ChevronRightIcon = icon('ChevronRightIcon', [path('M9 6l6 6-6 6')])
export const ChevronDownIcon = icon('ChevronDownIcon', [path('M6 9l6 6 6-6')])

// Shell and Home icons (Paper 7Z-0 top bar, 01 Home), exact paths.
const dot = (cx) => h('circle', { key: `d${cx}`, cx, cy: 12, r: 1 })
export const SearchIcon = icon('SearchIcon', [h('circle', { key: 'c', cx: 11, cy: 11, r: 7 }), path('M20 20l-3.5-3.5')])
export const BellIcon = icon('BellIcon', [path('M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4')])
export const PencilIcon = icon('PencilIcon', [path('M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z')])
export const DownloadIcon = icon('DownloadIcon', [path('M12 4v12M6 10l6 6 6-6M5 20h14')])
export const ArrowRightIcon = icon('ArrowRightIcon', [path('M5 12h14M13 6l6 6-6 6')])
export const MoreIcon = icon('MoreIcon', [dot(5), dot(12), dot(19)])
export const TrendUpIcon = FinanceIcon
