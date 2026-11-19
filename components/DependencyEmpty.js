import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import {
  QuickCreateCageModal,
  QuickCreateFeedTypeModal,
  QuickCreateStockingModal,
  QuickCreatePurchaseModal,
} from './QuickCreateModals'
import { usePermissions } from '../hooks/usePermission'
import { useT } from '../lib/i18n/context'
import { CREATE_PERMISSIONS, routePermission } from '../lib/routePermissions'

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
  const { can } = usePermissions()
  const t = useT()
  const Modal = openKind ? CREATE_MODALS[openKind] : null

  // UX-007: only offer shortcuts this member can actually use.
  const canCreate = (kind) => Boolean(kind && CREATE_MODALS[kind] && can(CREATE_PERMISSIONS[kind]))
  const canOpen = (link) => Boolean(link && can(routePermission(link)))
  const primaryIsCreate = canCreate(createKind)
  const secondaryIsCreate = canCreate(secondaryCreateKind)
  const showPrimaryLink = !primaryIsCreate && canOpen(href) && Boolean(linkLabel)
  const showSecondaryLink = !secondaryIsCreate && canOpen(secondaryHref) && Boolean(secondaryLabel)
  const hadAction = Boolean(createKind || secondaryCreateKind || href || secondaryHref)
  const noAction = hadAction && !primaryIsCreate && !secondaryIsCreate && !showPrimaryLink && !showSecondaryLink

  return (
    <>
      <div
        className={`mt-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5 text-sm text-warn ${className}`}
        role="status"
      >
        <p className="leading-snug">{message}</p>
        {noAction && <p className="mt-1 text-warn">{t('ui.askAdmin')}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {primaryIsCreate && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpenKind(createKind)
              }}
              className="inline-flex items-center gap-1 font-semibold text-lagoon-800 hover:text-lagoon-950 underline-offset-2 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              {createLabel || linkLabel || 'Create'}
            </button>
          )}
          {showPrimaryLink && (
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 font-semibold text-lagoon-800 hover:text-lagoon-950 underline-offset-2 hover:underline"
            >
              {linkLabel}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}

          {secondaryIsCreate && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpenKind(secondaryCreateKind)
              }}
              className="inline-flex items-center gap-1 font-medium text-chart-ink/80 hover:text-chart-ink underline-offset-2 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              {secondaryCreateLabel || secondaryLabel || 'Create'}
            </button>
          )}
          {showSecondaryLink && (
            <Link
              href={secondaryHref}
              onClick={(e) => e.stopPropagation()}
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
