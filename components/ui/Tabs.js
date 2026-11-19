import { useRef } from 'react'

/**
 * Filter tabs (WAI-ARIA tablist: arrow keys, Home/End, roving tabindex).
 * variant 'text' (default): text-link tabs in table headers (Paper 24 Sales).
 * 'underline': cyan underline on the active tab (Paper 44 tenant detail).
 * 'chip': small pills, active on surface-2 (Paper 42/45 filters).
 * 'page': page-level tabs under a title (Paper 03 Cage detail, 12 My tasks):
 *   14/18 labels 28px apart on a hairline, 12px under the label, the active
 *   one underlined in the button colour.
 * A tab may carry `controls` (the id of the panel it shows).
 */
const VARIANT = {
  text: {
    list: 'gap-4',
    tab: (on) => `text-[13px] leading-4 ${on ? 'text-text' : 'text-muted hover:text-text'}`,
  },
  underline: {
    list: 'gap-5',
    tab: (on) =>
      `-mb-px border-b-2 py-[14px] text-[14px] leading-[18px] ${
        on ? 'border-pearl-cyan font-medium text-text' : 'border-transparent text-muted hover:text-text'
      }`,
  },
  page: {
    list: 'gap-7 overflow-x-auto border-b border-line',
    tab: (on) =>
      `-mb-px border-b-2 pb-3 text-[14px] leading-[18px] ${
        on ? 'border-button font-medium text-text' : 'border-transparent text-muted hover:text-text'
      }`,
  },
  chip: {
    list: 'flex-wrap gap-2',
    tab: (on) => `rounded-pill px-3 py-[6px] text-xs leading-4 ${on ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'}`,
  },
}

export function Tabs({ tabs = [], value, onChange, label, variant = 'text', className = '' }) {
  const listRef = useRef(null)
  const v = VARIANT[variant] || VARIANT.text
  const values = tabs.map((tab) => (typeof tab === 'string' ? tab : tab.value))
  const onKeyDown = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const i = Math.max(0, values.indexOf(value))
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? values.length - 1 : (i + step + values.length) % values.length
    onChange?.(values[next])
    listRef.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }
  const selected = values.includes(value) ? value : values[0]
  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex items-center ${v.list} ${className}`}>
      {tabs.map((tab) => {
        const tv = typeof tab === 'string' ? tab : tab.value
        const text = typeof tab === 'string' ? tab : tab.label
        const active = tv === selected
        return (
          <button
            key={tv}
            type="button"
            role="tab"
            id={typeof tab === 'object' && tab.id ? tab.id : undefined}
            aria-controls={typeof tab === 'object' && tab.controls ? tab.controls : undefined}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange?.(tv)}
            className={`whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm ${v.tab(active)}`}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

export default Tabs
