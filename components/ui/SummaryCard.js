/**
 * Summary card (Paper 42 alert counts, 44 tenant status strip): small-caps
 * label, a figure and a faint sub-line. `tone` colours the figure only;
 * the label always says what it is. `size` 'lg' for counts, 'md' for words.
 */
const TONE = {
  default: 'text-text',
  good: 'text-good',
  warn: 'text-warn',
  alert: 'text-alert',
  cyan: 'text-pearl-cyan',
}

export function SummaryCard({ label, value, sub, tone = 'default', size = 'lg', className = '', children }) {
  return (
    <div className={`flex min-w-0 grow basis-0 flex-col gap-2 rounded-[12px] border border-line bg-surface px-5 py-[18px] ${className}`}>
      <div className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-muted">{label}</div>
      <div
        className={`flex items-center gap-2 font-semibold tabular-nums ${
          size === 'lg' ? 'text-[28px] leading-[34px]' : 'text-[20px] leading-6'
        } ${TONE[tone] || TONE.default}`}
      >
        {value}
      </div>
      {sub ? <div className="text-xs leading-4 text-faint">{sub}</div> : null}
      {children}
    </div>
  )
}

export default SummaryCard
