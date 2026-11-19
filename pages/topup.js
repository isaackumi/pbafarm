import React from 'react'
import { List } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import TopUpForm from '../components/TopUpForm'
import { GradientButton } from '../components/ui'
import { useT } from '../lib/i18n/context'

function Content() {
  const t = useT()
  return (
    <Layout
      title={t('stocking.topup.title')}
      eyebrow={t('stocking.topup.eyebrow')}
      actions={
        <GradientButton reverse icon={List} href="/stocking-management">
          {t('stocking.transfers.allMovements')}
        </GradientButton>
      }
    >
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <p className="max-w-2xl text-sm text-muted">{t('stocking.topup.description')}</p>
        <TopUpForm />
      </div>
    </Layout>
  )
}

export default function TopUpPage() {
  return (
    <ProtectedRoute>
      <Content />
    </ProtectedRoute>
  )
}
