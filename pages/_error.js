import { ErrorFallback } from '../components/ErrorBoundary'

/**
 * Next.js error page: server errors and client errors the ErrorBoundary in
 * _app.js did not catch. 404s use pages/404.js.
 */
function ErrorPage({ statusCode }) {
  const title =
    statusCode && statusCode !== 500
      ? `Something went wrong (error ${statusCode})`
      : 'Something went wrong'
  return <ErrorFallback title={title} />
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode || 500 : 404
  return { statusCode }
}

export default ErrorPage
