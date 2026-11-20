import { useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import BulkDailyUploadForm from '../components/BulkDailyUploadForm'
import BulkBiweeklyUploadForm from '../components/BulkBiweeklyUploadForm'
import { CSV_COLUMNS } from '../components/CsvImportForm'
import { ToastProvider } from '../components/Toast'
import { GradientButton } from '../components/ui'
import { useT } from '../lib/i18n/context'

const KINDS = ['daily', 'biweekly']

/** Header-only CSV for the chosen import, built in the browser. */
function downloadTemplate(kind) {
  const csv = `${CSV_COLUMNS[kind].join(',')}\n`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${kind}-records-template.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Pill kind picker (Paper 53): the active option is the solid button colour. */
function KindPicker({ value, onChange }) {
  const t = useT()
  const labels = { daily: t('csvImport.page.kindDaily'), biweekly: t('csvImport.page.kindBiweekly') }
  return (
    <div
      role="radiogroup"
      aria-label={t('csvImport.page.kindLabel')}
      className="inline-flex w-fit flex-wrap gap-1 rounded-pill border border-line bg-bg p-1 [html[data-theme=light]_&]:border-[#DFE6EF] [html[data-theme=light]_&]:bg-[#F4F7FB]"
    >
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={`min-h-11 rounded-pill px-[18px] text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:min-h-0 sm:py-2 ${
            value === k ? 'bg-button font-medium text-button-text' : 'text-muted hover:text-text'
          }`}
        >
          {labels[k]}
        </button>
      ))}
    </div>
  )
}

function BulkUpload() {
  const t = useT()
  const [activeTab, setActiveTab] = useState('daily')
  const picker = <KindPicker value={activeTab} onChange={setActiveTab} />
  return (
    <Layout
      title={t('csvImport.page.title')}
      eyebrow={t('csvImport.page.eyebrow')}
      actions={
        // Paper 53: sky ring, 42px inner height.
        <GradientButton ring="sky" icon={ArrowDownToLine} className="[&>span]:h-[42px]" onClick={() => downloadTemplate(activeTab)}>
          {t('csvImport.page.template')}
        </GradientButton>
      }
    >
      <div className="w-full">
        {activeTab === 'daily' && <BulkDailyUploadForm header={picker} />}
        {activeTab === 'biweekly' && <BulkBiweeklyUploadForm header={picker} />}
      </div>
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
