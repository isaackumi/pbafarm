import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import WaterQualityForm from '../components/WaterQualityForm'
import OutboxPanel from '../components/OutboxPanel'
import { Card, Field, FormPage, Select } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { saveOrQueue } from '../lib/outboxSenders'
import { useOnline } from '../hooks/useOutbox'
import { errorMessage } from '../lib/errorMessage'
import { unitLabel } from '../lib/format'
import { WQ_PARAMETERS } from '../convex/lib/waterQuality'
import { useT } from '../lib/i18n/context'

/**
 * Field entry for water quality (mobile first). Works offline: a reading
 * saved without signal waits in the outbox and is sent once, with the same
 * replay key, when the phone is back online.
 */
function WaterEntry() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const t = useT()
  const online = useOnline()
  const { locationArgs } = useLocation()
  const units = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const [unitId, setUnitId] = useState('')

  useEffect(() => {
    const q = router.query.unit || router.query.cage
    if (typeof q === 'string' && q) setUnitId(q)
  }, [router.query.unit, router.query.cage])

  const unit = (units || []).find((u) => u.id === unitId)

  const save = async ({ values, notes, measuredAt }) => {
    if (!unitId) {
      showToast(t('wq.entry.chooseUnitFirst'), 'error')
      return false
    }
    const summary = `${unit?.name || 'Unit'} · ${Object.entries(values)
      .slice(0, 3)
      .map(([k, v]) => `${WQ_PARAMETERS[k].short} ${v}`)
      .join(', ')}`
    const res = await saveOrQueue({
      kind: 'water-quality',
      payload: { unitId, ...values, notes, measuredAt: measuredAt ?? Date.now() },
      summary,
      userId: user?.id,
    })
    if (res.error) {
      showToast(errorMessage(res.error, t('wq.entry.couldNotSave')), 'error')
      return false
    }
    if (res.queued) {
      showToast(t('common.queuedOffline'), 'info')
    } else if (res.data?.breaches?.length) {
      showToast(t('wq.entry.savedOutOfRange', { labels: res.data.breaches.map((b) => b.label).join(', ') }), 'warning')
    } else {
      showToast(t('wq.entry.saved'), 'success')
    }
    return true
  }

  return (
    <Layout
      title={t('wq.entry.title')}
      eyebrow={`${t('wq.entry.crumbWq')} · ${online ? t('wq.entry.online') : t('wq.entry.offline')}`}
    >
    <FormPage width="md">
      <Card className="space-y-5">
        <Field label={t('wq.entry.unit')} htmlFor="wq-unit" required>
          <Select id="wq-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{units === undefined ? t('common.loading') : t('wq.entry.chooseUnit')}</option>
            {(units || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {unitLabel(u)}
              </option>
            ))}
          </Select>
        </Field>
        <WaterQualityForm key={unitId} unitType={unit?.unitType || 'cage'} onSave={save} compact />
      </Card>
      <div className="mt-6">
        <OutboxPanel compact kinds={['water-quality']} online={online} />
      </div>
    </FormPage>
    </Layout>
  )
}

export default function WaterEntryPage() {
  return (
    <ProtectedRoute>
      <WaterEntry />
    </ProtectedRoute>
  )
}
