/** Text-link filter tabs used in table headers (Paper 24 Sales). */
export function Tabs({ tabs = [], value, onChange, label, className = '' }) {
  return (
    <div role="tablist" aria-label={label} className={`flex items-center gap-4 ${className}`}>
      {tabs.map((tab) => {
        const v = typeof tab === 'string' ? tab : tab.value
        const text = typeof tab === 'string' ? tab : tab.label
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(v)}
            className={`text-[13px] leading-4 focus:outline-none focus-visible:underline ${
              active ? 'text-text' : 'text-muted hover:text-text'
            }`}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

export default Tabs
