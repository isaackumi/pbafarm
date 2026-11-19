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
        className={`mt-2 rounded-input border border-[color:var(--warn-tint-border)] bg-[color:var(--warn-tint-bg)] px-4 py-3 text-sm leading-5 text-text ${className}`}
        role="status"
      >
        <p className="flex items-start gap-2.5">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-dot-warn" aria-hidden />
          <span>{message}</span>
        </p>
        {noAction && <p className="mt-1 pl-[18px] text-muted">{t('ui.askAdmin')}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-[18px]">
          {primaryIsCreate && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpenKind(createKind)
              }}
              className="inline-flex items-center gap-1.5 rounded-pill border border-line-strong bg-surface px-3 py-[7px] text-xs font-medium leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {createLabel || linkLabel || t('system.create')}
            </button>
          )}
          {showPrimaryLink && (
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-pill border border-line-strong bg-surface px-3 py-[7px] text-xs font-medium leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {linkLabel}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
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
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-[7px] text-xs leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {secondaryCreateLabel || secondaryLabel || t('system.create')}
            </button>
          )}
          {showSecondaryLink && (
            <Link
              href={secondaryHref}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-[7px] text-xs leading-4 text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {secondaryLabel}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
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
