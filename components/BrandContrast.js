import { CircleCheck, TriangleAlert } from 'lucide-react'
import { Button } from './ui'
import { useT } from '../lib/i18n/context'
import { AA_NORMAL, checkBrandAccent } from '../convex/lib/contrast'

/**
 * Contrast check for a brand accent (CUSTOM-006): white text on the accent
 * (buttons, header) must reach WCAG AA 4.5:1. Below that the app applies the
 * nearest accessible variant; this offers to save it.
 */
export default function BrandContrast({ hex, onUse }) {
  const t = useT()
  const c = checkBrandAccent(hex)
  if (!c) {
    return (
      <p className="mt-2 text-sm text-signal" role="alert">
        {t('branding.invalidHex')}
      </p>
    )
  }
  const ratio = c.onWhiteText.toFixed(2)
  return (
    <div className="mt-3 space-y-2" aria-live="polite">
      {c.passes ? (
        <p className="flex items-center gap-2 text-sm text-kelp">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden />
          {t('branding.contrastPass', { ratio })}
        </p>
      ) : (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn space-y-2">
          <p className="flex items-start gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>
              {t(c.passesLarge ? 'branding.contrastLargeOnly' : 'branding.contrastFail', { ratio, min: AA_NORMAL })}{' '}
              {t('branding.contrastAdjusted', { hex: c.accessibleHex })}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-6 w-6 rounded border border-foam-deep" style={{ background: hex }} aria-hidden />
              <span className="font-data">{hex}</span>
            </span>
            <span aria-hidden>→</span>
            <span
              className="inline-flex items-center rounded-lg px-3 py-1 text-white text-sm font-medium"
              style={{ background: c.accessibleHex }}
            >
              {c.accessibleHex}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={() => onUse(c.accessibleHex)}>
              {t('branding.useAccessible')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
