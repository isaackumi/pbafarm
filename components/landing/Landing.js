import Head from 'next/head'
import Link from 'next/link'
import { ArrowRight, Building2, CalendarCheck, LayoutGrid, Package, TrendingUp, WifiOff } from 'lucide-react'
import { useT } from '../../lib/i18n/context'
import { Brand, LakeScene } from '../auth/AuthUi'
import LanguageSwitcher from '../LanguageSwitcher'
import { GhostButton, GradientButton } from '../ui/Buttons'
import { BRAND } from '../../lib/brand'

const SECTION = 'mx-auto w-full max-w-[1200px] px-6 sm:px-10'
const NAV_LINK = 'rounded-sm hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

function SectionHeading({ eyebrow, title, body }) {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-3.5 text-center">
      <p className="text-xs uppercase leading-4 tracking-[0.12em] text-cyan">{eyebrow}</p>
      <h2 className="text-[32px] font-semibold leading-[110%] tracking-[-0.03em] text-text sm:text-[44px]">{title}</h2>
      {body && <p className="text-base leading-6 text-muted">{body}</p>}
    </div>
  )
}

function FeatureCard({ icon: Icon, title, body, children }) {
  return (
    <article className="flex flex-col gap-5 rounded-card border border-line bg-surface p-7">
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2.5 text-lg font-semibold leading-6 text-text">
          <Icon size={18} aria-hidden className="text-muted" />
          {title}
        </h3>
        <p className="text-sm leading-5 text-muted">{body}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </article>
  )
}

/* Decorative feature art: shapes only, no figures (nothing here is real data). */
function UnitBoardArt() {
  const dots = ['bg-dot-good', 'bg-dot-good', 'bg-dot-warn', 'bg-dot-good', 'bg-dot-good', 'bg-dot-alert', 'bg-dot-good', 'bg-dot-good']
  return (
    <div className="grid grid-cols-4 gap-2.5" aria-hidden>
      {dots.map((dot, i) => (
        <div key={i} className="flex h-14 flex-col justify-between rounded-input border border-line bg-surface-2 p-2.5">
          <span className="h-1.5 w-8 rounded-pill bg-line-strong" />
          <span className={`h-2 w-2 rounded-full ${dot}`} />
        </div>
      ))}
    </div>
  )
}

function EntryRowsArt() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-input border border-line bg-surface-2 px-3 py-2.5">
          <span className="h-1.5 w-8 rounded-pill bg-line-strong" />
          <span className="h-6 flex-1 rounded-lg border border-line bg-bg" />
          <span className="h-6 flex-1 rounded-lg border border-line bg-bg" />
          <span className="h-2 w-2 rounded-full bg-dot-good" />
        </div>
      ))}
    </div>
  )
}

function BarsArt() {
  const heights = [38, 52, 46, 64, 58, 80]
  return (
    <div className="flex h-24 items-end gap-2" aria-hidden>
      {heights.map((h, i) => (
        <span key={i} className="flex-1 rounded-t-lg" style={{ height: `${h}%`, backgroundImage: 'var(--gradient-bar)' }} />
      ))}
    </div>
  )
}

function StockArt() {
  const rows = [
    ['w-[86%]', 'bg-cyan'],
    ['w-[62%]', 'bg-cyan'],
    ['w-[18%]', 'bg-alert'],
    ['w-[40%]', 'bg-warn'],
  ]
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {rows.map(([w, c], i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="h-1.5 w-14 rounded-pill bg-line-strong" />
          <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-surface-2">
            <span className={`block h-full rounded-pill ${w} ${c}`} />
          </span>
        </div>
      ))}
    </div>
  )
}

function CompaniesArt() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {['bg-pink-fill', 'bg-cyan-fill'].map((fill) => (
        <div key={fill} className="flex items-center gap-3 rounded-input border border-line bg-surface-2 px-3 py-2.5">
          <span className={`h-7 w-7 rounded-lg ${fill}`} />
          <span className="flex flex-col gap-1.5">
            <span className="h-1.5 w-20 rounded-pill bg-line-strong" />
            <span className="h-1.5 w-12 rounded-pill bg-line" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Public marketing page (Paper "Landing — 1440"), shown at `/` to signed-out visitors. */
export default function Landing() {
  const t = useT()
  const year = new Date().getFullYear()

  return (
    <div className="min-h-screen bg-bg text-text">
      <Head>
        <title>{`Anowa · ${t('landing.metaTitle')}`}</title>
        <meta name="description" content={t('landing.heroBody')} />
        <meta property="og:title" content={`Anowa · ${t('landing.metaTitle')}`} />
        <meta property="og:description" content={t('landing.heroBody')} />
        <meta property="og:url" content={BRAND.appUrl} />
      </Head>

      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className={`${SECTION} flex h-16 items-center justify-between gap-6`}>
          <Brand />
          <nav aria-label={t('landing.navLabel')} className="hidden items-center gap-7 text-sm leading-[18px] text-muted md:flex">
            <a href="#product" className={NAV_LINK}>
              {t('landing.nav.product')}
            </a>
            <a href="#how" className={NAV_LINK}>
              {t('landing.nav.how')}
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <Link href="/login" className={`text-sm leading-[18px] text-text ${NAV_LINK}`}>
              {t('auth.login.signIn')}
            </Link>
            <GhostButton href="/signup">{t('landing.cta.start')}</GhostButton>
          </div>
        </div>
      </header>

      <main>
        <section className={`${SECTION} flex flex-col items-center gap-7 pb-16 pt-20 text-center sm:pt-24`}>
          <span className="inline-flex items-center gap-2 rounded-pill border border-line-strong py-1 pl-1 pr-3 text-xs leading-4 text-muted">
            <span className="rounded-pill bg-button px-2 py-0.5 font-semibold text-button-text">{t('landing.newBadge')}</span>
            {t('landing.newText')}
          </span>
          <h1 className="max-w-[860px] text-[44px] font-semibold leading-[105%] tracking-[-0.04em] text-text sm:text-[64px] lg:text-[76px]">
            {t('landing.heroTitle')}
          </h1>
          <p className="max-w-[620px] text-lg leading-[26px] text-muted">{t('landing.heroBody')}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <GradientButton href="/signup" variant="solid">
              {t('landing.cta.start')}
            </GradientButton>
            <GhostButton href="/login" size="lg">
              {t('auth.login.signIn')}
            </GhostButton>
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs leading-4 text-faint">
            <WifiOff size={12} aria-hidden />
            {t('landing.heroNote')}
          </p>
          <div
            className="relative mt-6 aspect-[16/7] w-full overflow-hidden rounded-[28px] border border-line"
            style={{ backgroundColor: 'var(--scene-bg)' }}
            aria-hidden
          >
            <LakeScene />
          </div>
        </section>

        <section id="product" className={`${SECTION} flex scroll-mt-20 flex-col gap-12 py-24`}>
          <SectionHeading
            eyebrow={t('landing.product.eyebrow')}
            title={t('landing.product.title')}
            body={t('landing.product.body')}
          />
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FeatureCard icon={LayoutGrid} title={t('landing.features.board.title')} body={t('landing.features.board.body')}>
                <UnitBoardArt />
              </FeatureCard>
              <FeatureCard icon={CalendarCheck} title={t('landing.features.entry.title')} body={t('landing.features.entry.body')}>
                <EntryRowsArt />
              </FeatureCard>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FeatureCard icon={TrendingUp} title={t('landing.features.pnl.title')} body={t('landing.features.pnl.body')}>
                <BarsArt />
              </FeatureCard>
              <FeatureCard icon={Package} title={t('landing.features.feed.title')} body={t('landing.features.feed.body')}>
                <StockArt />
              </FeatureCard>
              <FeatureCard icon={Building2} title={t('landing.features.multi.title')} body={t('landing.features.multi.body')}>
                <CompaniesArt />
              </FeatureCard>
            </div>
          </div>
        </section>

        <section id="how" className={`${SECTION} flex scroll-mt-20 flex-col gap-12 py-24`}>
          <SectionHeading eyebrow={t('landing.how.eyebrow')} title={t('landing.how.title')} />
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              ['01', t('landing.how.setupTitle'), t('landing.how.setupBody')],
              ['02', t('landing.how.inviteTitle'), t('landing.how.inviteBody')],
              ['03', t('landing.how.runTitle'), t('landing.how.runBody')],
            ].map(([n, title, body]) => (
              <li key={n} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-7">
                <span className="font-mono text-xs leading-4 text-faint">{n}</span>
                <h3 className="text-lg font-semibold leading-6 text-text">{title}</h3>
                <p className="text-sm leading-5 text-muted">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${SECTION} py-24`}>
          <div className="flex flex-col items-center gap-6 rounded-[28px] border border-line bg-surface px-6 py-20 text-center">
            <h2 className="max-w-[720px] text-[36px] font-semibold leading-[110%] tracking-[-0.03em] text-text sm:text-[52px]">
              {t('landing.cta.title')}
            </h2>
            <p className="text-base leading-6 text-muted">{t('landing.cta.body')}</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <GradientButton href="/signup" variant="solid" icon={ArrowRight}>
                {t('landing.cta.start')}
              </GradientButton>
              <GhostButton href="/login" size="lg">
                {t('auth.login.signIn')}
              </GhostButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${SECTION} flex flex-col gap-10 py-14 md:flex-row md:justify-between`}>
          <div className="flex max-w-[280px] flex-col gap-3">
            <Brand />
            <p className="text-sm leading-5 text-muted">{t('landing.footer.tagline')}</p>
          </div>
          <nav aria-label={t('landing.footer.label')} className="grid grid-cols-2 gap-10 text-sm leading-5">
            <div className="flex flex-col gap-2.5">
              <p className="font-semibold text-text">{t('landing.nav.product')}</p>
              <a href="#product" className={`text-muted ${NAV_LINK}`}>
                {t('landing.footer.features')}
              </a>
              <a href="#how" className={`text-muted ${NAV_LINK}`}>
                {t('landing.nav.how')}
              </a>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="font-semibold text-text">{t('landing.footer.account')}</p>
              <Link href="/login" className={`text-muted ${NAV_LINK}`}>
                {t('auth.login.signIn')}
              </Link>
              <Link href="/signup" className={`text-muted ${NAV_LINK}`}>
                {t('authUi.signup.create')}
              </Link>
              <Link href="/reset-password" className={`text-muted ${NAV_LINK}`}>
                {t('auth.login.forgot')}
              </Link>
            </div>
          </nav>
        </div>
        <div className={`${SECTION} flex flex-wrap gap-x-4 gap-y-2 border-t border-line py-6 text-xs leading-4 text-faint`}>
          <span>© {year} Anowa</span>
          <a href={BRAND.siteUrl} className={NAV_LINK}>
            getanowa.com
          </a>
          <a href={`mailto:${BRAND.email}`} className={NAV_LINK}>
            {BRAND.email}
          </a>
        </div>
      </footer>
    </div>
  )
}
