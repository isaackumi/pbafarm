import { useEffect, useState } from 'react'
import Head from 'next/head'
import { MaintenanceCard } from '../../components/states/MaintenanceState'
import { SystemPage } from '../../components/states/StateCard'
import { STATUS_PAGE_URL, maintenanceUntil } from '../../lib/maintenance'
import { useT } from '../../lib/i18n/context'

/**
 * Scheduled maintenance (Paper 62). Public, no queries, so it renders while
 * the backend is down; ops point traffic here for the window (see
 * docs/ops/anowa-cutover.md). The sign-in page shows the same card while
 * NEXT_PUBLIC_MAINTENANCE_UNTIL is ahead.
 */
export default function MaintenancePage() {
  const t = useT()
  // Read on the client: a statically built page must not freeze the clock.
  const [until, setUntil] = useState(null)
  useEffect(() => setUntil(maintenanceUntil()), [])
  return (
    <>
      <Head>
        <title>{`${t('system.maintenance.eyebrow')} · Anowa`}</title>
      </Head>
      <SystemPage>
        {until && <MaintenanceCard endsAt={until.getTime()} statusPageUrl={STATUS_PAGE_URL} />}
      </SystemPage>
    </>
  )
}
