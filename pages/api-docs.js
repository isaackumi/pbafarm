import { useMemo } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import { GhostButton } from '../components/ui'
import { SettingsCard } from '../components/settings'
import { IntegrationsShell } from '../components/integrations/kit'
import { openApiDocument } from '../convex/integrations/openapi'
import { convexSiteUrl } from '../lib/apiBase'
import { useT } from '../lib/i18n/context'

const METHOD_TONE = {
  get: 'border-[var(--pill-cyan-border)] text-[var(--pill-cyan-text)]',
  post: 'border-[var(--pill-pink-border)] text-[var(--pill-pink-text)]',
}

function Code({ children }) {
  return (
    <pre className="overflow-x-auto whitespace-pre rounded-input border border-line-strong bg-bg px-[14px] py-3 font-mono text-[12px] leading-relaxed text-text">
      {children}
    </pre>
  )
}

function Mono({ children }) {
  return <code className="font-mono text-[13px] text-text">{children}</code>
}

function ApiDocsScreen() {
  const t = useT()
  const base = convexSiteUrl()
  const doc = useMemo(() => openApiDocument(base), [base])
  const operations = useMemo(() => {
    const out = []
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) out.push({ path, method, op })
    }
    return out
  }, [doc])

  return (
    <IntegrationsShell
      title={t('settingsUi.integ.docs.title')}
      actions={
        <GhostButton size="lg" href={`${base}/api/v1/openapi.json`} target="_blank" rel="noreferrer">
          {t('settingsUi.integ.docs.openapi')}
        </GhostButton>
      }
    >
      <p className="max-w-3xl text-[14px] leading-[18px] text-muted">{t('settingsUi.integ.docs.description')}</p>
      <SettingsCard title={t('settingsUi.integ.docs.startTitle')}>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-[20px] text-muted marker:text-faint">
          <li>{t('settingsUi.integ.docs.step1')}</li>
          <li>{t('settingsUi.integ.docs.step2')}</li>
          <li>
            {t('settingsUi.integ.docs.step3', { limit: 'limit', cursor: 'nextCursor', more: 'hasMore' })}
          </li>
          <li>
            {t('settingsUi.integ.docs.step4', { header: 'Idempotency-Key' })}
          </li>
        </ol>
        <div className="mt-4 flex flex-col gap-3">
          <Code>{`curl -H "Authorization: Bearer pbk_…" \\
  "${base}/api/v1/daily-records?from=2026-11-01&limit=100"`}</Code>
          <Code>{`curl -X POST "${base}/api/v1/daily-records" \\
  -H "Authorization: Bearer pbk_…" \\
  -H "Idempotency-Key: 2026-11-15-north-pond" \\
  -H "Content-Type: application/json" \\
  -d '{"date":"2026-11-15","records":[{"cageId":"…","feedKg":12.5,"feedTypeId":"…","mortality":3}]}'`}</Code>
        </div>
      </SettingsCard>

      <SettingsCard title={t('settingsUi.integ.docs.limitsTitle')}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[14px] leading-[20px] text-muted marker:text-faint">
          <li>{t('settingsUi.integ.docs.limit1')}</li>
          <li>
            {t('settingsUi.integ.docs.limit2Lead')} <Mono>{'{"error":{"code":"…","message":"…"}}'}</Mono>. {t('settingsUi.integ.docs.limit2')}
          </li>
          <li>{t('settingsUi.integ.docs.limit3')}</li>
          <li>{t('settingsUi.integ.docs.limit4')}</li>
        </ul>
      </SettingsCard>

      <SettingsCard title={t('settingsUi.integ.docs.endpointsTitle')} meta={operations.length}>
        <ul>
          {operations.map(({ path, method, op }) => (
            <li key={`${method} ${path}`} className="border-t border-line py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-pill border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase leading-4 ${METHOD_TONE[method] || METHOD_TONE.get}`}>
                  {method}
                </span>
                <code className="break-all font-mono text-[14px] leading-[18px] text-text">{path}</code>
              </div>
              {/* Summaries come from the OpenAPI document, which is English only. */}
              <p className="mt-1.5 text-[14px] leading-[18px] text-text">{op.summary}</p>
              {op.description && <p className="mt-0.5 text-[13px] leading-4 text-muted">{op.description.replace(/`/g, '')}</p>}
            </li>
          ))}
        </ul>
      </SettingsCard>
    </IntegrationsShell>
  )
}

export default function ApiDocsPage() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <ApiDocsScreen />
    </ProtectedRoute>
  )
}
