import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { ToastProvider } from '../components/Toast'
import BulkImport, { DownloadTemplateButton } from '../components/import/BulkImport'
import { IMPORT_KINDS } from '../lib/csvImport'
import { useT } from '../lib/i18n/context'

/**
 * Paper 53 Bulk CSV import (FBD-0 dark, M7Z-0 light). The tab lives in the
 * URL (`?kind=biweekly`) so Records and Cages can link straight to a tab.
 */
function BulkUpload() {
  const t = useT()
  const router = useRouter()
  const kind = IMPORT_KINDS.includes(router.query.kind) ? router.query.kind : 'daily'
  const setKind = (next) =>
    router.replace({ pathname: router.pathname, query: next === 'daily' ? {} : { kind: next } }, undefined, {
      shallow: true,
    })
  return (
    <Layout
      title={t('csvImport.page.title')}
      eyebrow={t('csvImport.page.eyebrow')}
      actions={<DownloadTemplateButton kind={kind} />}
    >
      <BulkImport kind={kind} onKindChange={setKind} />
    </Layout>
  )
}

export default function BulkUploadPage() {
  return (
    <ProtectedRoute permission="production.import">
      <ToastProvider>
        <BulkUpload />
      </ToastProvider>
    </ProtectedRoute>
  )
}
