import Head from 'next/head'
import { NotFoundCard, SystemPage } from '../components/system/SystemState'
import { useT } from '../lib/i18n/context'

export default function Custom404() {
  const t = useT()
  return (
    <SystemPage>
      <Head>
        <title>{`${t('system.notFound.title')} · Anowa`}</title>
      </Head>
      <NotFoundCard />
    </SystemPage>
  )
}
