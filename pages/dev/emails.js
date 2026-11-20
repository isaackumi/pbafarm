import Head from 'next/head'
import { emailContext } from '../../convex/lib/emailTemplates'
import { EMAIL_SAMPLES } from '../../convex/lib/emailTemplates/samples'

/**
 * Dev-only preview of every transactional email (Paper "Anowa · Emails",
 * E1 to E7) with sample data, at desktop and phone widths.
 *
 * Not served in production (404) unless EMAIL_PREVIEW_ENABLED=1 is set on the
 * web deployment. Sample data only; no Convex access.
 *   /dev/emails            English
 *   /dev/emails?lang=fr    French
 *   /dev/emails?id=e5      only the templates whose id starts with "e5"
 */
export async function getServerSideProps({ req, query }) {
  if (process.env.NODE_ENV === 'production' && process.env.EMAIL_PREVIEW_ENABLED !== '1') {
    return { notFound: true }
  }
  const locale = query.lang === 'fr' ? 'fr' : 'en'
  const host = String(req.headers.host || 'localhost:3000')
  const origin = `${host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'}://${host}`
  // Links point at the app; images load from this server's public/email/.
  const ctx = emailContext(locale, { SITE_URL: origin, EMAIL_ASSET_BASE_URL: origin })
  const only = typeof query.id === 'string' ? query.id : ''
  const emails = EMAIL_SAMPLES.filter((s) => !only || s.id.startsWith(only)).map((s) => {
    const mail = s.render(ctx)
    return { id: s.id, title: s.title, subject: mail.subject, preheader: mail.preheader, html: mail.html, text: mail.text }
  })
  return { props: { emails, locale } }
}

export default function EmailPreviews({ emails, locale }) {
  return (
    <div style={{ background: '#E5E7EB', minHeight: '100vh', padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Head>
        <title>Email previews</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Email previews</h1>
        <a href="?lang=en" style={{ fontWeight: locale === 'en' ? 700 : 400 }}>English</a>
        <a href="?lang=fr" style={{ fontWeight: locale === 'fr' ? 700 : 400 }}>Français</a>
      </div>
      {emails.map((e) => (
        <section key={e.id} id={e.id} style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>{e.title}</h2>
          <p style={{ margin: '0 0 2px', fontSize: 13 }}>
            <strong>Subject:</strong> {e.subject}
          </p>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#4B5563' }}>
            <strong>Preheader:</strong> {e.preheader}
          </p>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <iframe title={`${e.title} desktop`} srcDoc={e.html} sandbox="" style={{ width: 680, height: 1100, border: 0, background: '#fff' }} />
            <iframe title={`${e.title} phone`} srcDoc={e.html} sandbox="" style={{ width: 375, height: 1100, border: 0, background: '#fff' }} />
            <pre style={{ width: 360, height: 1100, overflow: 'auto', margin: 0, padding: 12, background: '#fff', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {e.text}
            </pre>
          </div>
        </section>
      ))}
    </div>
  )
}
