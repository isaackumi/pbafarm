/** 36×20 switch (Paper 22 Roles). On: brand gradient track, knob right. */
export function Toggle({ checked = false, onChange, label, disabled = false, className = '', ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      // A locked ON switch keeps the full gradient (Paper 22 Roles); only an
      // OFF switch dims when disabled.
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-pill p-[2px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:cursor-not-allowed ${
        checked ? 'justify-end' : 'justify-start bg-line-strong disabled:opacity-50'
      } ${className}`}
      style={checked ? { backgroundImage: 'var(--gradient-brand)' } : undefined}
      {...props}
    >
      <span className={`size-4 rounded-full ${checked ? 'bg-bg' : 'bg-muted'}`} />
    </button>
  )
}

export default Toggle
