import { useEffect } from 'react'
import ErrorState from '../components/states/ErrorState'
import { useT } from '../lib/i18n/context'
import { captureException } from '../lib/monitoring'
import { displayErrorId, newErrorId } from '../lib/errorId'

/**
 * Next.js error page (Paper 62 _error card, HMM-0 / KRK-0): server errors and
 * client errors the ErrorBoundary in _app.js did not catch. 404s use
 * pages/404.js. Every error gets an id shown on the card and logged with it.
 */
function ErrorPage({ statusCode, errorId }) {
  const t = useT()
  useEffect(() => {
    if (errorId) captureException(new Error(`Error page ${statusCode || ''}`.trim()), { source: 'error-page', tags: { errorId } })
  }, [errorId, statusCode])
  const title =
    statusCode && statusCode !== 500 ? t('system.error.titleCode', { code: statusCode }) : t('system.error.title')
  return <ErrorState title={title} errorId={errorId} className="min-h-screen" />
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode || 500 : 404
  // Next's digest when there is one, else a fresh id; logged with the error.
  const errorId = displayErrorId(err?.digest) || newErrorId()
  if (err) console.error(`[${errorId}]`, err)
  return { statusCode, errorId }
}

export default ErrorPage
