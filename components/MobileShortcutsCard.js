import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { FormCard, FormSection, FormActions, Button } from './ui'
import { useToast } from './Toast'
import { useSettings } from '../contexts/SettingsContext'
import { usePermissions } from '../hooks/usePermission'
import { useTerm } from '../hooks/useTerm'
import { useT } from '../lib/i18n/context'
import { navKey } from '../lib/i18n'
import { errorMessage } from '../lib/errorMessage'
import { EXTRA_DESTINATIONS, MAX_MOBILE_SHORTCUTS, MENU_SECTIONS, NAV_ITEMS, canOpenItem, resolveShortcuts } from '../lib/navigation'

/** Choose the phone tab bar places (UX-004), saved on the account (CUSTOM-007). */
export default function MobileShortcutsCard() {
  const { settings, updateSettings } = useSettings()
  const { can } = usePermissions()
  const { showToast } = useToast()
  const t = useT()
  const term = useTerm()

  const saved = useMemo(
    () => resolveShortcuts(settings?.mobileShortcuts, can).map((item) => item.path),
    [settings?.mobileShortcuts, can],
  )
  const [chosen, setChosen] = useState(saved)
  const [saving, setSaving] = useState(false)
  useEffect(() => setChosen(saved), [saved])

  const byPath = useMemo(() => new Map(NAV_ITEMS.map((item) => [item.path, item])), [])
  const label = (item) => term.text(t.or(navKey(item.path), item.title))
  const full = chosen.length >= MAX_MOBILE_SHORTCUTS
  const dirty = chosen.join('|') !== saved.join('|')

  const groups = Object.entries(MENU_SECTIONS)
    .filter(([, section]) => !section.superAdminOnly)
    .map(([key, section]) => ({
      key,
      title: t.or(`nav.section.${key}`, section.title),
      // Pages that left the sidebar (Paper 71) stay pinnable.
      items: [...section.items, ...EXTRA_DESTINATIONS.filter((e) => e.section === key)].filter(
        (item) => canOpenItem(item, can) && !chosen.includes(item.path),
      ),
    }))
    .filter((group) => group.items.length > 0)

  const move = (index, step) =>
    setChosen((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      next.splice(index + step, 0, item)
      return next
    })

  const save = async (value) => {
    setSaving(true)
    try {
      await updateSettings({ mobileShortcuts: value })
      showToast('success', t('settings.shortcuts.saved'))
    } catch (err) {
      showToast('error', errorMessage(err, t('settings.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard
      title={t('settings.shortcuts.title')}
      subtitle={t('settings.shortcuts.subtitle', { max: MAX_MOBILE_SHORTCUTS })}
    >
      <FormSection>
        <div>
          <p className="text-sm font-medium text-chart-ink">
            {t('settings.shortcuts.chosen', { count: chosen.length, max: MAX_MOBILE_SHORTCUTS })}
          </p>
          {chosen.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('settings.shortcuts.none')}</p>
          ) : (
            <ol className="mt-2 divide-y divide-foam-deep rounded-lg border border-foam-deep">
              {chosen.map((path, index) => {
                const item = byPath.get(path)
                if (!item) return null
                const Icon = item.icon
                return (
                  <li key={path} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Icon size={16} className="text-muted shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{label(item)}</span>
                    <IconButton
                      label={t('settings.shortcuts.moveUp', { name: label(item) })}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} aria-hidden />
                    </IconButton>
                    <IconButton
                      label={t('settings.shortcuts.moveDown', { name: label(item) })}
                      disabled={index === chosen.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} aria-hidden />
                    </IconButton>
                    <IconButton
                      label={t('settings.shortcuts.remove', { name: label(item) })}
                      onClick={() => setChosen((list) => list.filter((p) => p !== path))}
                    >
                      <X size={16} aria-hidden />
                    </IconButton>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-chart-ink">{t('settings.shortcuts.add')}</p>
          {full && (
            <p className="mt-1 text-sm text-muted">
              {t('settings.shortcuts.full', { max: MAX_MOBILE_SHORTCUTS })}
            </p>
          )}
          <div className="mt-2 space-y-3">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="text-xs uppercase tracking-wide text-muted">{group.title}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      disabled={full}
                      onClick={() => setChosen((list) => [...list, item.path])}
                      className="inline-flex items-center gap-1 rounded-full border border-foam-deep px-3 py-1 text-sm text-chart-ink hover:bg-foam disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={14} aria-hidden />
                      {label(item)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </FormSection>
      <FormActions>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => save(null)}>
          {t('settings.shortcuts.useDefaults')}
        </Button>
        <Button type="button" disabled={saving || !dirty} onClick={() => save(chosen)}>
          {saving ? t('settings.saving') : t('settings.shortcuts.save')}
        </Button>
      </FormActions>
    </FormCard>
  )
}

function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted hover:bg-foam hover:text-chart-ink disabled:opacity-30 disabled:hover:bg-transparent"
      {...props}
    >
      {children}
    </button>
  )
}
