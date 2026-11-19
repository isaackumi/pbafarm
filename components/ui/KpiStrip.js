/**
 * Row of KPI cells divided by hairlines (Paper 01 Home, 28 Sensors).
 * items: [{ label, value, valueTone: 'warn'|'alert'|'good', suffix, suffixTone: 'muted'|'unit'|'good'|'alert'|'cyan' }]
 */
// Suffixes are 13/16 (Paper 24 Sales "+18% vs Oct"); 'unit' is the 14/18
// muted unit of Paper 01 Home ("/ 44", "kg · 31 of 38 logged").
const SUFFIX = {
  muted: 'text-muted text-[13px] leading-4',
  unit: 'text-muted text-[14px] leading-[18px]',
  good: 'text-good text-[13px] leading-4',
  alert: 'text-alert text-[13px] leading-4',
  cyan: 'text-pearl-cyan text-[13px] leading-4',
}
const VALUE = { warn: 'text-warn', alert: 'text-alert', good: 'text-good' }

/**
 * size 'home' (default): 12px faint caps label, 26/32 value, 6px gap.
 * size 'console' (Paper 40 console): 11px muted caps label (0.08em), 34/42
 * value, 8px gap, ruled above and below with 22px padding.
 */
const SIZES = {
  home: {
    strip: 'p-1',
    cell: 'gap-[6px]',
    label: 'text-[12px] leading-4 tracking-[0.06em] text-faint',
    value: 'text-[26px] leading-8',
  },
  console: {
    strip: 'border-y border-line py-[22px]',
    cell: 'gap-2',
    label: 'text-[11px] leading-[14px] tracking-[0.08em] text-muted',
    value: 'text-[34px] leading-[42px]',
  },
}

export function KpiStrip({ items = [], size = 'home', className = '' }) {
  const sz = SIZES[size] || SIZES.home
  return (
    <div className={`grid grid-cols-2 gap-y-5 md:flex ${sz.strip} ${className}`}>
      {items.map((item, i) => (
        <div
          key={item.key || item.label}
          className={`flex min-w-0 flex-col ${sz.cell} border-line md:grow md:basis-0 ${
            i % 2 === 1 ? 'border-l pl-4' : 'pr-4'
          } ${i === 0 ? 'md:pl-0 md:pr-6' : 'md:border-l md:px-6'} ${
            i === items.length - 1 && i !== 0 ? 'md:pr-0' : ''
          }`}
        >
          <div className={`uppercase ${sz.label}`}>
            {item.label}
          </div>
          <div className={`font-semibold tracking-[-0.02em] tabular-nums ${sz.value} ${VALUE[item.valueTone] || 'text-text'}`}>
            {item.value}
            {item.suffix != null && (
              <span className={`font-normal ${SUFFIX[item.suffixTone] || SUFFIX.muted}`}> {item.suffix}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default KpiStrip
