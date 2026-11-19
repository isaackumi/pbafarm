import { useState } from 'react'
import { ChevronDown, Languages } from 'lucide-react'
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

  const change = async (e) => {
    setBusy(true)
    try {
      await setLocale(e.target.value)
    } catch {
      // Offline or refused: the device choice still applies.
    } finally {
      setBusy(false)
    }
  }
  const options = supported.map((l) => (
    <option key={l.code} value={l.code}>
      {l.label}
    </option>
  ))

  if (dark) {
    return (
      <label className={`inline-flex items-center gap-1.5 text-sm text-zinc-300 ${className}`}>
        <Languages size={16} aria-hidden />
        <span className="sr-only">{t('common.language')}</span>
        <select
          value={locale}
          disabled={busy}
          onChange={change}
          className="min-h-9 rounded-md border border-white/15 bg-lagoon-950 px-2 text-sm text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          {options}
        </select>
      </label>
    )
  }

  // Paper 15 language pill: "English ▾".
  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        disabled={busy}
        onChange={change}
        className="cursor-pointer appearance-none rounded-pill border border-line-strong bg-transparent py-1.5 pl-3 pr-7 text-xs leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-60 [&>option]:bg-surface [&>option]:text-text"
      >
        {options}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-2.5 text-muted" aria-hidden />
    </label>
  )
}
