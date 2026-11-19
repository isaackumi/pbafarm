import { INSPECTION_KINDS } from './InspectionForm'

const RESULT_TONE = {
  ok: 'text-kelp',
  needs_attention: 'text-warn',
  failed: 'text-signal',
}
const RESULT_LABEL = { ok: 'OK', needs_attention: 'Needs attention', failed: 'Failed' }

/** List of inspections and maintenance jobs, newest first. */
export default function InspectionHistory({ rows, showUnit = false }) {
  if (!rows) return <p className="p-5 text-sm text-muted">Loading…</p>
  if (!rows.length) return <p className="p-5 text-sm text-muted">Nothing logged yet.</p>
  return (
    <ul className="divide-y divide-foam-deep text-sm">
      {rows.map((r) => {
        const faults = (r.checklist || []).filter((c) => !c.ok)
        return (
          <li key={r._id} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <span className="tabular-nums">{r.date}</span>{' '}
                <span className="font-medium">{INSPECTION_KINDS.find((k) => k.value === r.kind)?.label || r.kind}</span>
                {r.equipmentName ? ` · ${r.equipmentName}` : ''}
                {showUnit && r.unitName ? ` · ${r.unitName}` : ''}
              </span>
              <span className={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</span>
            </div>
            {faults.length > 0 && (
              <p className="mt-1 text-muted">
                Faults: {faults.map((c) => `${c.item}${c.note ? ` (${c.note})` : ''}`).join('; ')}
              </p>
            )}
            {r.findings && <p className="mt-1 text-muted">{r.findings}</p>}
            {r.nextDueOn && <p className="mt-1 text-xs text-muted">Next due {r.nextDueOn}</p>}
          </li>
        )
      })}
    </ul>
  )
}
