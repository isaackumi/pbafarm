import Head from 'next/head'
import { useT } from '../../lib/i18n/context'
import { BRAND } from '../../lib/brand'
import { MarketingPage } from './ui'
import Hero from './sections/Hero'
import Logos from './sections/Logos'
import Ticker from './sections/Ticker'
import About from './sections/About'
import Showcase from './sections/Showcase'
import Bento from './sections/Bento'
import Features from './sections/Features'
import AskSection from './sections/AskSection'
import WhatsAppSection from './sections/WhatsAppSection'
import HowItWorks from './sections/HowItWorks'
import Testimonial from './sections/Testimonial'
import Calculator from './sections/Calculator'
import PondSide from './sections/PondSide'
import Pricing from './sections/Pricing'
import Faq from './sections/Faq'
import Cta from './sections/Cta'
import Footer from './sections/Footer'

/**
 * The public landing page: Paper "Landing v4 — Sky (1440)" (page "Anowa ·
 * Marketing site"), section by section, top to bottom, with scroll motion
 * from lib/marketing/motion and styles/marketing.css.
 */
export default function Landing() {
  const t = useT()
  const title = `Anowa · ${t('marketing.meta.title')}`
  return (
    <MarketingPage>
      <Head>
        <title>{title}</title>
        <meta name="description" content={t('marketing.meta.description')} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={t('marketing.meta.description')} />
        <meta property="og:url" content={BRAND.appUrl} />
      </Head>
      <Hero />
      <main id="main">
        <Logos />
        <Ticker />
        <About />
        <Showcase />
        <Bento />
        <Features />
        <AskSection />
        <WhatsAppSection />
        <HowItWorks />
        <Testimonial />
        <Calculator />
        <PondSide />
        <Pricing />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </MarketingPage>
  )
}
