import { Check } from 'lucide-react'

/** 22×22 check cell for permission matrices (Paper 22 Roles). */
export function CheckCell({ checked = false, onChange, label, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`inline-flex size-[22px] shrink-0 items-center justify-center rounded-[7px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed ${
        checked ? 'bg-button text-button-text' : 'border border-line-strong'
      } ${className}`}
    >
      {checked && <Check size={13} strokeWidth={3} aria-hidden />}
    </button>
  )
}

/** Partial-scope chip shown in place of a check (e.g. "sites"). */
export function ScopeChip({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border border-line-strong px-2 py-[2px] text-[11px] leading-[14px] text-cyan ${className}`}
    >
      {children}
    </span>
  )
}

export default CheckCell
