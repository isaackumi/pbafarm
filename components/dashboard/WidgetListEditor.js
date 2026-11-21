import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Button, Select } from '../ui'
import { useT } from '../../lib/i18n/context'
import { MAX_WIDGETS, WIDGET_CATALOG, WIDGET_KEYS, WIDGET_SIZES } from '../../convex/lib/dashboardLayout'

export const widgetLabel = (t, key) => t.or(`dashboardLayout.widget.${key.replace('.', '_')}`, key)

/**
 * Controlled list editor for dashboard widgets (CUSTOM-005): add, remove,
 * reorder and resize. `can(permission)` hides widgets the member cannot see.
 */
export default function WidgetListEditor({ widgets, onChange, can, exclude = [] }) {
  const t = useT()
  // `exclude`: widgets the page shows in fixed places (Home: HOME_FIXED_WIDGETS).
  const available = WIDGET_KEYS.filter(
    (k) =>
      !exclude.includes(k) &&
      !widgets.some((w) => w.widget === k) &&
      (!WIDGET_CATALOG[k].permission || can(WIDGET_CATALOG[k].permission)),
  )
  const [adding, setAdding] = useState('')
  const pick = adding && available.includes(adding) ? adding : available[0] ?? ''
  const move = (i, step) => {
    const j = i + step
    if (j < 0 || j >= widgets.length) return
    const next = [...widgets]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="space-y-3">
      {widgets.length === 0 && <p className="text-sm text-muted">{t('dashboardLayout.empty')}</p>}
      <ul className="divide-y divide-foam-deep">
        {widgets.map((w, i) => (
          <li key={w.widget} className="py-2 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-40 text-sm font-medium text-chart-ink">{widgetLabel(t, w.widget)}</span>
            <Select
              aria-label={t('dashboardLayout.size')}
              className="w-auto"
              value={w.size}
              onChange={(e) => onChange(widgets.map((x, k) => (k === i ? { ...x, size: e.target.value } : x)))}
            >
              {WIDGET_SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`dashboardLayout.sizeName.${s}`)}
                </option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" aria-label={t('formLayout.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" aria-label={t('formLayout.moveDown')} disabled={i === widgets.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" aria-label={t('dashboardLayout.remove')} onClick={() => onChange(widgets.filter((_, k) => k !== i))}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {available.length > 0 && widgets.length < MAX_WIDGETS && (
        <div className="flex flex-wrap gap-2">
          <Select aria-label={t('dashboardLayout.addWidget')} className="w-auto" value={pick} onChange={(e) => setAdding(e.target.value)}>
            {available.map((k) => (
              <option key={k} value={k}>
                {widgetLabel(t, k)}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            onClick={() => {
              onChange([...widgets, { widget: pick, size: WIDGET_CATALOG[pick].defaultSize }])
              setAdding('')
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('dashboardLayout.addWidget')}
          </Button>
        </div>
      )}
    </div>
  )
}
