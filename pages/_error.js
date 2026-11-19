import { ErrorFallback } from '../components/ErrorBoundary'
import { useT } from '../lib/i18n/context'

/**
 * Next.js error page: server errors and client errors the ErrorBoundary in
 * _app.js did not catch. 404s use pages/404.js.
 */
function ErrorPage({ statusCode }) {
  const t = useT()
  const title =
    statusCode && statusCode !== 500 ? t('system.error.titleCode', { code: statusCode }) : t('system.error.title')
  return <ErrorFallback title={title} />
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode || 500 : 404
  return { statusCode }
}

export default ErrorPage
