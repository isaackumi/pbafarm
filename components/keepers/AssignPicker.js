import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Avatar, GhostButton, Modal, SearchField, SolidButton } from '../ui'
import { useT } from '../../lib/i18n/context'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/**
 * Who gets these units? Keepers already at the site (lightest first, with
 * their load now and after), or anyone found by name. Optional backup.
 * Choosing drafts the change; the Anowa card confirms it.
 */
export default function AssignPicker({ open, unitCount, siteId, onClose, onPick, busy }) {
  const t = useT()
  const [search, setSearch] = useState('')
  const [keeper, setKeeper] = useState(null)
  const [backup, setBackup] = useState(null)
  const [pickBackup, setPickBackup] = useState(false)
  const q = useDebounced(search.trim())
  const local = useQuery(api.keepers.board.siteKeepers, open && siteId ? { siteId } : 'skip')
  const found = useQuery(api.keepers.board.people, open && q.length >= 2 ? { search: q, ...(siteId ? { siteId } : {}) } : 'skip')

  useEffect(() => {
    if (!open) {
      setSearch('')
      setKeeper(null)
      setBackup(null)
      setPickBackup(false)
    }
  }, [open])

  const capacity = local?.capacity ?? 25
  const list = q.length >= 2 ? found ?? [] : local?.keepers ?? []
  const choose = (p) => (pickBackup ? setBackup(p) : setKeeper(p))

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      showClose
      title={t('keepers.assign.title', { count: unitCount })}
      description={t('keepers.assign.description')}
      footer={
        <>
          <GhostButton size="lg" onClick={onClose}>
            {t('common.cancel')}
          </GhostButton>
          <SolidButton disabled={!keeper || busy} onClick={() => onPick(keeper, backup)}>
            {keeper ? t('keepers.assign.submit', { name: keeper.name }) : t('keepers.assign.choose')}
          </SolidButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2" role="radiogroup" aria-label={t('keepers.assign.role')}>
          {[false, true].map((b) => (
            <button
              key={String(b)}
              type="button"
              role="radio"
              aria-checked={pickBackup === b}
              onClick={() => setPickBackup(b)}
              className={`rounded-pill px-3 py-1.5 text-xs ${FOCUS} ${pickBackup === b ? 'bg-text font-semibold text-bg' : 'border border-line-strong text-muted'}`}
            >
              {b ? t('keepers.assign.backup', { name: backup?.name || t('keepers.assign.none') }) : t('keepers.assign.keeper', { name: keeper?.name || t('keepers.assign.none') })}
            </button>
          ))}
        </div>
        <SearchField value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('keepers.assign.search')} aria-label={t('keepers.assign.search')} />
        <ul className="flex max-h-[320px] flex-col gap-1.5 overflow-y-auto" aria-label={t('keepers.assign.people')}>
          {list.length === 0 && <li className="px-1 py-3 text-sm text-muted">{q.length >= 2 ? t('keepers.assign.noMatch') : t('keepers.assign.hint')}</li>}
          {list.map((p) => {
            const after = p.units + (pickBackup ? 0 : unitCount)
            const heavy = after > capacity
            const on = (pickBackup ? backup : keeper)?.id === p.id
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => choose(p)}
                  aria-pressed={on}
                  disabled={!pickBackup ? false : keeper?.id === p.id}
                  className={`flex w-full items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-left disabled:opacity-40 ${FOCUS} ${on ? 'border-[1.5px] border-cover' : 'border border-line'}`}
                >
                  <Avatar name={p.name} size={32} />
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-sm font-semibold text-text">{p.name}</span>
                    <span className="text-xs text-muted">
                      {pickBackup ? t('keepers.assign.loadNow', { count: p.units }) : t('keepers.assign.load', { count: p.units, after })}
                    </span>
                  </span>
                  {!pickBackup && heavy && <span className="shrink-0 text-xs text-warn">{t('keepers.assign.heavy')}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
