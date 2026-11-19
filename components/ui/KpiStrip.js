/**
 * Row of KPI cells divided by hairlines (Paper 01 Home, 28 Sensors).
 * items: [{ label, value, valueTone: 'warn'|'alert'|'good', suffix, suffixTone: 'muted'|'good'|'alert'|'cyan' }]
 */
const SUFFIX = {
  muted: 'text-muted text-[13px] leading-4',
  good: 'text-good text-[13px] leading-4',
  alert: 'text-alert text-[13px] leading-4',
  cyan: 'text-pearl-cyan text-[13px] leading-4',
}
const VALUE = { warn: 'text-warn', alert: 'text-alert', good: 'text-good' }

export function KpiStrip({ items = [], className = '' }) {
  return (
    <div className={`grid grid-cols-2 gap-y-5 p-1 md:flex ${className}`}>
      {items.map((item, i) => (
        <div
          key={item.key || item.label}
          className={`flex min-w-0 flex-col gap-[6px] border-line md:grow md:basis-0 ${
            i % 2 === 1 ? 'border-l pl-4' : 'pr-4'
          } ${i === 0 ? 'md:pl-0 md:pr-6' : 'md:border-l md:px-6'} ${
            i === items.length - 1 && i !== 0 ? 'md:pr-0' : ''
          }`}
        >
          <div className="text-[12px] uppercase leading-4 tracking-[0.06em] text-faint">
            {item.label}
          </div>
          <div className={`text-[26px] font-semibold leading-8 tracking-[-0.02em] tabular-nums ${VALUE[item.valueTone] || 'text-text'}`}>
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
