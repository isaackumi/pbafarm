import Link from 'next/link'
import { StatusDot } from '../ui'
import { getActiveZone, unitLabel } from '../../lib/format'

const num = (v, decimals = 2) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: decimals })

/** "06:40" today, "18 Nov, 06:40" before. */
export function readingTime(ms, locale, now = Date.now()) {
  if (ms == null) return '—'
  const zone = getActiveZone()
  const opts = { timeZone: zone }
  const day = (d) => new Intl.DateTimeFormat('en-CA', { ...opts, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const sameDay = day(new Date(ms)) === day(new Date(now))
  return new Intl.DateTimeFormat(locale || undefined, {
    ...opts,
    ...(sameDay ? {} : { day: 'numeric', month: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

function Value({ row, param, decimals, suffix = '', t }) {
  const v = row.reading?.values?.[param]
  const breach = row.breaches[param]
  return (
    <span className={breach ? 'text-alert' : 'text-text'}>
      {num(v, decimals)}
      {v != null && suffix}
      {breach && <span className="sr-only"> ({t(`healthWater.log.${breach}`)})</span>}
    </span>
  )
}

export function WaterStatus({ row, t }) {
  if (!row.reading) {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] leading-4 text-muted">
        <StatusDot tone="neutral" />
        {t('healthWater.log.noReading')}
      </span>
    )
  }
  const bad = row.breachCount > 0
  return (
    <span className="inline-flex items-center gap-2 text-[13px] leading-4 text-muted">
      <StatusDot tone={bad ? 'alert' : 'good'} />
      {bad ? t('healthWater.log.outOfRange', { count: row.breachCount }) : t('healthWater.log.normal')}
    </span>
  )
}

/** Water log columns (Paper 07 table): time, unit, DO, temp, pH, NH₃, Secchi, status. */
export function waterLogColumns(t, locale) {
  return [
    {
      key: 'time',
      header: t('healthWater.log.col.time'),
      width: 130,
      render: (r) => <span className="tabular-nums">{readingTime(r.reading?.measuredAt, locale)}</span>,
    },
    {
      key: 'unit',
      header: t('healthWater.log.col.unit'),
      width: 120,
      render: (r) => (
        <Link
          href={`/units/${r.unit.id || r.unit._id}/water`}
          className="font-medium text-text hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded-sm"
          title={unitLabel(r.unit)}
        >
          {r.unit.name}
        </Link>
      ),
    },
    { key: 'do', header: t('healthWater.log.col.do'), width: 100, align: 'right', render: (r) => <Value t={t} row={r} param="dissolvedOxygen" decimals={1} /> },
    { key: 'temp', header: t('healthWater.log.col.temp'), width: 100, align: 'right', render: (r) => <Value t={t} row={r} param="temperatureC" decimals={1} /> },
    { key: 'ph', header: t('healthWater.log.col.ph'), width: 80, align: 'right', render: (r) => <Value t={t} row={r} param="ph" decimals={1} /> },
    { key: 'nh3', header: t('healthWater.log.col.nh3'), width: 100, align: 'right', render: (r) => <Value t={t} row={r} param="ammonia" /> },
    {
      key: 'secchi',
      header: t('healthWater.log.col.secchi'),
      width: 100,
      align: 'right',
      render: (r) => <Value t={t} row={r} param="secchiCm" decimals={0} suffix=" cm" />,
    },
    { key: 'status', header: t('healthWater.log.col.status'), render: (r) => <WaterStatus row={r} t={t} /> },
  ]
}
