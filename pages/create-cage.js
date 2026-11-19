import React from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import CreateCageForm from '../components/CreateCageForm'
import { Breadcrumbs, FormPage, GhostButton } from '../components/ui'
import { usePermissions } from '../hooks/usePermission'
import { routePermission } from '../lib/routePermissions'
import { useT } from '../lib/i18n/context'
import { useTerm } from '../hooks/useTerm'

const RELATED = [
  { key: 'onboarding.cage.allCages', href: '/cages' },
  { key: 'onboarding.cage.newStocking', href: '/stocking' },
]

export default function CreateCagePage() {
  const t = useT()
  const term = useTerm()
  const { can } = usePermissions()
  const related = RELATED.filter((item) => can(routePermission(item.href)))
  return (
    <ProtectedRoute>
      <Layout title={term.text(t('onboarding.cage.title'))} hideTitle>
        <FormPage data-tour="page-create-cage">
          {/* Paper 16 step header: title 34/42 with a muted lead, related links as pills. */}
          <header className="mb-8 flex flex-col gap-4">
            <Breadcrumbs
              items={[
                { label: t('onboarding.cage.dashboard'), href: '/dashboard' },
                { label: t('onboarding.cage.cages'), href: '/cages' },
                { label: t('onboarding.cage.title') },
              ]}
            />
            <div className="flex flex-col gap-2.5">
              <h1 data-tour="header-title" className="text-[28px] font-semibold leading-9 tracking-[-0.03em] text-text sm:text-[34px] sm:leading-[42px]">
                {term.text(t('onboarding.cage.title'))}
              </h1>
              <p className="max-w-2xl text-base leading-[22px] text-muted">{term.text(t('onboarding.cage.subtitle'))}</p>
            </div>
            {related.length > 0 && (
              <nav aria-label={t('ui.relatedPages')} className="flex flex-wrap items-center gap-2">
                {related.map((item) => (
                  <GhostButton key={item.href} href={item.href} size="sm">
                    {term.text(t(item.key))}
                  </GhostButton>
                ))}
              </nav>
            )}
          </header>
          <CreateCageForm />
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
