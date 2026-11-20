/**
 * Cost line with a coloured dot (Paper 10 "Cost breakdown", 19 "Allocation
 * rules"): 7px dot, 14/18 title over a 12/16 muted line, 14/18 medium amount,
 * hairline above, 11px vertical padding.
 */
export const BREAKDOWN_DOTS = [
  // Paper sky #6AA8F5 (light artboard #3D86E6), lime #D7F75B (light #A8C93A), then muted and faint.
  'bg-sky-ink [[data-theme=light]_&]:bg-[#3D86E6]',
  'bg-lime [[data-theme=light]_&]:bg-[#A8C93A]',
  'bg-muted',
  'bg-faint',
]

export const breakdownDot = (i) => BREAKDOWN_DOTS[Math.min(i, BREAKDOWN_DOTS.length - 1)]

export default function BreakdownRow({ dotClass, title, sub, value }) {
  return (
    <div className="flex items-center gap-[14px] border-t border-line py-[11px]">
      <span aria-hidden className={`size-[7px] shrink-0 rounded-pill ${dotClass}`} />
      <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
        <div className="truncate text-[14px] leading-[18px] text-text">{title}</div>
        {sub && <div className="truncate text-xs leading-4 text-muted">{sub}</div>}
      </div>
      <div className="shrink-0 text-right text-[14px] font-medium leading-[18px] tabular-nums text-text">{value}</div>
    </div>
  )
}
