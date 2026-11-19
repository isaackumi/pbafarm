import React from 'react'
import { List } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import StockingForm from '../components/StockingForm'
import { GradientButton } from '../components/ui'
import { useT } from '../lib/i18n/context'

function Content() {
  const t = useT()
  return (
    <Layout
      title={t('stocking.newStocking.title')}
      eyebrow={t('stocking.newStocking.eyebrow')}
      actions={
        <GradientButton reverse icon={List} href="/stocking-management">
          {t('stocking.transfers.allMovements')}
        </GradientButton>
      }
    >
      <div className="flex w-full max-w-4xl flex-col gap-4" data-tour="page-stocking">
        <p className="max-w-2xl text-sm text-muted">{t('stocking.newStocking.description')}</p>
        <StockingForm />
      </div>
    </Layout>
  )
}

export default function StockingPage() {
  return (
    <ProtectedRoute>
      <Content />
    </ProtectedRoute>
  )
}
