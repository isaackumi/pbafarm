import { useState } from 'react'
import { Languages } from 'lucide-react'
import { useLocale, useT } from '../lib/i18n/context'

/**
 * Compact language picker (I18N-002). Signed out it remembers the choice on
 * this device; signed in it saves it to the account (users.setLocale).
 * `tone="dark"` for the sidebar.
 */
export default function LanguageSwitcher({ tone = 'light', className = '' }) {
  const { locale, setLocale, supported } = useLocale()
  const t = useT()
  const [busy, setBusy] = useState(false)
  const dark = tone === 'dark'

  return (
    <label className={`inline-flex items-center gap-1.5 text-sm ${dark ? 'text-zinc-300' : 'text-muted'} ${className}`}>
      <Languages size={16} aria-hidden />
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true)
          try {
            await setLocale(e.target.value)
          } catch {
            // Offline or refused: the device choice still applies.
          } finally {
            setBusy(false)
          }
        }}
        className={`min-h-9 rounded-md border px-2 text-sm focus:outline-none focus-visible:ring-2 ${
          dark
            ? 'border-white/15 bg-lagoon-950 text-zinc-100 focus-visible:ring-white/50'
            : 'border-foam-deep bg-surface text-chart-ink focus-visible:ring-lake'
        }`}
      >
        {supported.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
