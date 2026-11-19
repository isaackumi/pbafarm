/**
 * Segmented control. size 'sm' (default): Paper 01 Home "30d / 90d / Cycle"
 * (12px, active on surface-2). size 'md': Paper 18 Calendar "Month / Week /
 * Agenda" (13px, 38px tall, active filled in the button colour).
 */
const SIZE = {
  sm: {
    track: 'gap-[2px] border-line bg-bg p-[3px]',
    item: 'px-2.5 py-1 text-[12px] leading-4',
    on: 'bg-surface-2 text-text',
  },
  md: {
    track: 'gap-[6px] border-line bg-surface p-1',
    item: 'px-[14px] py-[6px] text-[13px] leading-4',
    on: 'bg-button text-button-text',
  },
}

export function Segmented({ options, value, onChange, label, size = 'sm', className = '' }) {
  const sz = SIZE[size] || SIZE.sm
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`inline-flex rounded-pill border ${sz.track} ${className}`}
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
            className={`rounded-pill ${sz.item} focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              active ? sz.on : 'text-muted hover:text-text'
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
