import { useMemo } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, CardHeader, FormPage, PageHeader } from '../components/ui'
import { openApiDocument } from '../convex/integrations/openapi'
import { convexSiteUrl } from '../lib/apiBase'

const METHOD_CLASS = {
  get: 'bg-lake/10 text-lake',
  post: 'bg-kelp/15 text-kelp',
}

function Code({ children }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-foam px-3 py-3 font-mono text-xs leading-relaxed text-chart-ink whitespace-pre">
      {children}
    </pre>
  )
}

export default function ApiDocsPage() {
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
    <ProtectedRoute permission="integrations.manage">
      <Layout title="API documentation">
        <FormPage width="lg">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'API keys', href: '/api-keys' },
              { label: 'API documentation' },
            ]}
            description="Version 1 of the farm API. Changes inside v1 only add fields and endpoints."
            actions={
              <Button variant="secondary" href={`${base}/api/v1/openapi.json`} target="_blank" rel="noreferrer">
                OpenAPI file
              </Button>
            }
          />
          <div className="space-y-6">
            <Card>
              <CardHeader title="Getting started" />
              <ol className="list-decimal pl-5 space-y-2 text-sm text-chart-ink">
                <li>Create a key under API keys with only the permissions the other system needs.</li>
                <li>Send it as a bearer token on every request.</li>
                <li>Lists return up to 50 items (set <code>limit</code>, max 200). Follow <code>nextCursor</code> while <code>hasMore</code> is true.</li>
                <li>Writes need an <code>Idempotency-Key</code> header. Retrying with the same key returns the first answer instead of saving twice.</li>
              </ol>
              <div className="mt-4 space-y-3">
                <Code>{`curl -H "Authorization: Bearer pbk_…" \\
  "${base}/api/v1/daily-records?from=2026-11-01&limit=100"`}</Code>
                <Code>{`curl -X POST "${base}/api/v1/daily-records" \\
  -H "Authorization: Bearer pbk_…" \\
  -H "Idempotency-Key: 2026-11-15-north-pond" \\
  -H "Content-Type: application/json" \\
  -d '{"date":"2026-11-15","records":[{"cageId":"…","feedKg":12.5,"feedTypeId":"…","mortality":3}]}'`}</Code>
              </div>
            </Card>

            <Card>
              <CardHeader title="Limits and errors" />
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-chart-ink">
                <li>120 requests a minute per key and 600 per company. Over the limit you get 429 with a Retry-After header in seconds.</li>
                <li>Errors look like <code>{'{"error":{"code":"…","message":"…"}}'}</code>. 401: bad or revoked key. 403: missing permission. 422: refused by your farm rules (duplicate entry, not enough feed in stock); nothing was saved.</li>
                <li>Keys limited to some sites only see and write those sites&apos; cages.</li>
                <li>Bodies are limited to 1 MB and 100 lines per write.</li>
              </ul>
            </Card>

            <Card>
              <CardHeader title="Endpoints" />
              <ul className="divide-y divide-foam-deep">
                {operations.map(({ path, method, op }) => (
                  <li key={`${method} ${path}`} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${METHOD_CLASS[method] || ''}`}>{method}</span>
                      <code className="font-mono text-sm text-chart-ink break-all">{path}</code>
                    </div>
                    <p className="mt-1 text-sm text-chart-ink">{op.summary}</p>
                    {op.description && <p className="mt-0.5 text-sm text-muted">{op.description.replace(/`/g, '')}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
