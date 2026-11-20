import { useEffect, useRef, useState } from 'react'
import { useT } from '../../lib/i18n/context'
import { STATE_CLASS, rangeIds } from '../../lib/keepers'

/**
 * "Every cage, today" (Paper 57): one 10px square per unit, per site, in
 * name order. Drag across squares (mouse or pen) to select a run, click to
 * toggle one, shift-click to extend. The selection is lifted to the page,
 * which offers "Assign" through an Anowa draft.
 */
export default function KeeperHeatmap({ sites, deadline, names, selected, onSelect }) {
  const t = useT()
  const [drag, setDrag] = useState(null)
  const anchor = useRef(null)

  useEffect(() => {
    if (!drag) return undefined
    const up = () => {
      const ids = rangeIds(drag.units, drag.from, drag.to)
      onSelect(ids, drag.additive)
      anchor.current = drag.to
      setDrag(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [drag, onSelect])

  const preview = drag ? new Set(rangeIds(drag.units, drag.from, drag.to)) : null

  return (
    <div className="flex flex-col gap-4">
      {sites.map((site) => {
        const meta = [
          site.counts.due ? t('keepers.heatmap.due', { count: site.counts.due }) : null,
          site.counts.cover ? t('keepers.heatmap.cover', { count: site.counts.cover }) : null,
          site.counts.none ? t('keepers.heatmap.none', { count: site.counts.none }) : null,
        ].filter(Boolean)
        return (
          <section key={site.id || 'none'} className="flex flex-col gap-2" aria-label={site.name || t('keepers.heatmap.noSite')}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[13px] font-semibold leading-4 text-text">
                {site.name || t('keepers.heatmap.noSite')}
                <span className="font-normal text-faint"> · {site.units.length.toLocaleString()}</span>
              </h3>
              <span className="truncate text-xs leading-4 text-muted">{meta.join(' · ') || t('keepers.heatmap.allLogged')}</span>
            </div>
            <div
              className="grid select-none gap-[2px]"
              style={{ gridTemplateColumns: 'repeat(auto-fill, 10px)' }}
              role="group"
              aria-label={t('keepers.heatmap.gridLabel', { site: site.name || '' })}
            >
              {site.units.map((u) => {
                const on = selected.has(u.id) || preview?.has(u.id)
                const label = `${u.n} · ${t(`keepers.state.${u.s}`, { deadline })}${u.k && names[u.k] ? ` · ${names[u.k]}` : ''}`
                return (
                  <button
                    key={u.id}
                    type="button"
                    tabIndex={-1}
                    title={label}
                    aria-label={label}
                    aria-pressed={on}
                    data-id={u.id}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'touch') return
                      e.preventDefault()
                      const from = e.shiftKey && anchor.current && site.units.some((x) => x.id === anchor.current) ? anchor.current : u.id
                      setDrag({ units: site.units, from, to: u.id, additive: e.shiftKey || e.metaKey || e.ctrlKey })
                    }}
                    onPointerEnter={() => drag && drag.units === site.units && setDrag((d) => ({ ...d, to: u.id }))}
                    onClick={(e) => {
                      // Touch: a tap toggles one square.
                      if (e.nativeEvent.pointerType === 'touch' || e.detail === 0) onSelect([u.id], true, true)
                    }}
                    className={`size-[10px] rounded-[2px] ${STATE_CLASS[u.s]} ${on ? 'outline outline-2 outline-offset-1 outline-text' : ''}`}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
      <ul className="flex flex-wrap gap-[14px] pt-[2px] text-xs leading-4 text-muted" aria-label={t('keepers.heatmap.legend')}>
        {['logged', 'due', 'none', 'cover', 'idle'].map((s) => (
          <li key={s} className="flex items-center gap-[6px]">
            <span className={`size-[10px] rounded-[2px] ${s === 'none' ? 'border-[1.5px] border-alert' : STATE_CLASS[s]}`} aria-hidden />
            {t(`keepers.state.${s}`, { deadline })}
          </li>
        ))}
      </ul>
    </div>
  )
}
