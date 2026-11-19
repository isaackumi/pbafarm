/** Segmented control (Paper 01 Home "30d / 90d / Cycle"). */
export function Segmented({ options, value, onChange, label, className = '' }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex gap-[2px] rounded-pill border border-line bg-bg p-[3px] ${className}`}
    >
      {options.map((opt) => {
        const v = typeof opt === 'string' ? opt : opt.value
        const text = typeof opt === 'string' ? opt : opt.label
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(v)}
            className={`rounded-pill px-2.5 py-1 text-[12px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              active ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
            }`}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented
