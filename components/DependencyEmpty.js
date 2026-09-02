import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import {
  QuickCreateCageModal,
  QuickCreateFeedTypeModal,
  QuickCreateStockingModal,
  QuickCreatePurchaseModal,
} from './QuickCreateModals'

const CREATE_MODALS = {
  cage: QuickCreateCageModal,
  feedType: QuickCreateFeedTypeModal,
  stocking: QuickCreateStockingModal,
  purchase: QuickCreatePurchaseModal,
}

/**
 * Shown under a select when a required lookup list is empty / blocked.
 * Prefer `createKind` to open an inline create modal; `href` remains as a fallback link.
 */
export default function DependencyEmpty({
  message,
  /** @type {'cage'|'feedType'|'stocking'|'purchase'|undefined} */
  createKind,
  createLabel,
  href,
  linkLabel,
  /** @type {'cage'|'feedType'|'stocking'|'purchase'|undefined} */
  secondaryCreateKind,
  secondaryCreateLabel,
  secondaryHref,
  secondaryLabel,
  onCreated,
  /** Extra props passed to the create modal (e.g. defaultFeedTypeId) */
  createProps = {},
  className = '',
}) {
  const [openKind, setOpenKind] = useState(null)
  const Modal = openKind ? CREATE_MODALS[openKind] : null

  const primaryIsCreate = Boolean(createKind && CREATE_MODALS[createKind])
  const secondaryIsCreate = Boolean(
    secondaryCreateKind && CREATE_MODALS[secondaryCreateKind],
  )

  return (
    <>
      <div
        className={`mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 ${className}`}
        role="status"
      >
        <p className="leading-snug">{message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {primaryIsCreate && (
            <button
              type="button"
              onClick={() => setOpenKind(createKind)}
              className="inline-flex items-center gap-1 font-semibold text-lagoon-800 hover:text-lagoon-950 underline-offset-2 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              {createLabel || linkLabel || 'Create'}
            </button>
          )}
          {!primaryIsCreate && href && linkLabel && (
            <Link
              href={href}
              className="inline-flex items-center gap-1 font-semibold text-lagoon-800 hover:text-lagoon-950 underline-offset-2 hover:underline"
            >
              {linkLabel}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}

          {secondaryIsCreate && (
            <button
              type="button"
              onClick={() => setOpenKind(secondaryCreateKind)}
              className="inline-flex items-center gap-1 font-medium text-chart-ink/80 hover:text-chart-ink underline-offset-2 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              {secondaryCreateLabel || secondaryLabel || 'Create'}
            </button>
          )}
          {!secondaryIsCreate && secondaryHref && secondaryLabel && (
            <Link
              href={secondaryHref}
              className="inline-flex items-center gap-1 font-medium text-chart-ink/80 hover:text-chart-ink underline-offset-2 hover:underline"
            >
              {secondaryLabel}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {Modal && (
        <Modal
          {...createProps}
          onClose={() => setOpenKind(null)}
          onCreated={(result) => {
            onCreated?.(result)
          }}
        />
      )}
    </>
  )
}
