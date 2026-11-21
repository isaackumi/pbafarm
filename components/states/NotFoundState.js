import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n/context'
import { GradientSolidLink, STATE_GHOST, SystemCard } from './StateCard'

/** Wave lines along the card's foot (dark only: KRK-0 light parks them off the card). */
function Waves() {
  return (
    <svg
      viewBox="0 0 640 60"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[60px] w-full [[data-theme=light]_&]:hidden"
      aria-hidden
    >
      <path d="M0 34c80-14 160 14 240 0s160-14 240 0 120 10 160 4" fill="none" className="stroke-line" strokeWidth="1.5" />
      <path d="M0 48c80-12 160 12 240 0s160-12 240 0 120 8 160 3" fill="none" className="stroke-surface-2" strokeWidth="1.5" />
    </svg>
  )
}

/** Opens the header search (it listens for ⌘K / Ctrl+K). */
function openSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }))
}

/**
 * Paper 62 404 card (HMM-0 dark, KRK-0 light): "404" eyebrow, 96px sky
 * gradient numerals, "This cage drifted off", Go home and Search ⌘K, waves.
 */
export default function NotFoundState({ homeHref = '/', showSearch = true, className = '' }) {
  const t = useT()
  const [shortcut, setShortcut] = useState('⌘K')
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut('Ctrl K')
  }, [])
  return (
    <SystemCard eyebrow="404" className={`min-h-[400px] max-w-[720px] ${className}`}>
      <p
        aria-hidden
        className="bg-clip-text text-[72px] font-semibold leading-[72px] tracking-[-0.05em] text-transparent sm:text-[96px] sm:leading-[96px]"
        style={{ backgroundImage: 'var(--gradient-sky)' }}
      >
        404
      </p>
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-text">{t('system.notFound.title')}</h1>
        <p className="text-[14px] leading-5 text-muted">{t('system.notFound.body')}</p>
      </div>
      <div className="relative z-[1] flex flex-wrap justify-center gap-2.5">
        <GradientSolidLink href={homeHref}>{t('system.notFound.home')}</GradientSolidLink>
        {showSearch && (
          <button type="button" onClick={openSearch} className={STATE_GHOST}>
            {t('system.notFound.search', { shortcut })}
          </button>
        )}
      </div>
      <Waves />
    </SystemCard>
  )
}
