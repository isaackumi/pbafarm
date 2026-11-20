import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import DependencyEmpty from '../components/DependencyEmpty'
import FeedTypeField from '../components/FeedTypeField'
import LocationMetaField from '../components/LocationMetaField'
import {
  Button,
  FormPage,
  FormCard,
  FormActions,
  Field,
  Input,
  Select,
  Textarea,
} from '../components/ui'
import { useLocation } from '../contexts/LocationContext'
import { getActiveLocationId } from '../lib/locationScope'
import { localToday } from '../lib/format'
import { cleanError } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import { useOnline } from '../hooks/useOutbox'
import OutboxPanel from '../components/OutboxPanel'
import { usePermission } from '../hooks/usePermission'
import { useT } from '../lib/i18n/context'
import { queryDate, queryNumber, queryValue } from '../lib/anowaDraftCard'
import { useReferenceList } from '../hooks/useReferenceList'
import FormLayout, { hiddenCoreKeys, useFormLayout } from '../components/FormLayout'

export default function FeedIssuePage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('ops.feed.issueFeed')} eyebrow={t('ops.feedIssue.eyebrow')}>
        <FeedIssue />
      </Layout>
    </ProtectedRoute>
  )
}

function FeedIssue() {
  const t = useT()
  const { showToast } = useToast()
  const { user } = useAuth()
  const canOverride = usePermission('inventory.adjust')
  const { activeLocationId, locationArgs } = useLocation()
  const online = useOnline()
  const layout = useFormLayout('inventory.feedIssue')
  // Live lists, kept on the device so feed can be issued with no signal (MOBILE-003).
  const feedList = useReferenceList('feedTypes', api.feed.listFeedTypes, {})
  const cageList = useReferenceList('cages', api.cages.getActive, locationArgs)
  const feedTypes = feedList.list
  const cages = cageList.list
  const lookupsReady = feedList.ready && cageList.ready
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    feedTypeId: '',
    cageId: '',
    quantityKg: '',
    bags: '',
    usageDate: localToday(),
    notes: '',
    allowNegative: false,
    overrideReason: '',
  })

  const selected = feedTypes.find((f) => (f.id || f._id) === form.feedTypeId)
  const bagSize = selected?.bag_size_kg || 25

  // Ask Anowa's Edit (artboard 48): /feed-issue?feedType=…&qty=…&cage=…&date=…
  const router = useRouter()
  const prefilled = useRef(false)
  useEffect(() => {
    if (!router.isReady || prefilled.current || !router.query.feedType) return
    prefilled.current = true
    const q = router.query
    setForm((p) => ({
      ...p,
      feedTypeId: queryValue(q, 'feedType', 64),
      cageId: queryValue(q, 'cage', 64),
      quantityKg: queryNumber(q, 'qty'),
      bags: '',
      usageDate: queryDate(q, 'date') || p.usageDate,
      notes: queryValue(q, 'notes', 500),
    }))
  }, [router.isReady, router.query])

  const onChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((p) => {
      const next = { ...p, [name]: type === 'checkbox' ? checked : value }
      if (name === 'bags' && value !== '') {
        next.quantityKg = String(
          Math.round(parseFloat(value) * bagSize * 1000) / 1000,
        )
      }
      if (name === 'quantityKg' && value !== '') {
        next.bags = String(
          Math.round((parseFloat(value) / bagSize) * 1000) / 1000,
        )
      }
      return next
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.feedTypeId) throw new Error('Select a feed type')
      const hidden = hiddenCoreKeys(layout.sections, form)
      const payload = {
        feedTypeId: form.feedTypeId,
        cageId: (!hidden.has('cageId') && form.cageId) || undefined,
        quantity: form.quantityKg ? Number(form.quantityKg) : undefined,
        bags: form.bags ? Number(form.bags) : undefined,
        usageDate: form.usageDate,
        notes: (!hidden.has('notes') && form.notes) || undefined,
        allowNegative: form.allowNegative || undefined,
        overrideReason: form.overrideReason || undefined,
        locationId:
          activeLocationId || getActiveLocationId() || undefined,
      }
      const feedName = feedTypes.find((f) => (f.id || f._id) === form.feedTypeId)?.name || 'Feed'
      const cageName = cages.find((c) => (c.id || c._id) === form.cageId)?.name
      const res = await saveOrQueue({
        kind: 'feed-issue',
        payload: JSON.parse(JSON.stringify(payload)),
        summary: `${form.usageDate} · ${feedName}${cageName ? ` to ${cageName}` : ''} · ${
          form.quantityKg || 0
        } kg`,
        userId: user?.id,
      })
      if (res.error) throw res.error
      showToast(
        res.queued ? 'info' : 'success',
        res.queued
          ? 'No connection. Saved on this device and will send when you are back online'
          : 'Feed issued — stock deducted on ledger',
      )
      setForm((p) => ({
        ...p,
        quantityKg: '',
        bags: '',
        notes: '',
        allowNegative: false,
        overrideReason: '',
      }))
    } catch (err) {
      showToast('error', cleanError(err) || 'Failed to issue feed')
    } finally {
      setSaving(false)
    }
  }

  const layoutFields = {
    feedTypeId: (
      <FeedTypeField
        id="feedTypeId"
        name="feedTypeId"
        value={form.feedTypeId}
        onChange={onChange}
        feedTypes={feedTypes}
        ready={lookupsReady}
        required
        emptyMessage="Issue feed needs at least one feed type on the catalog."
        onCreated={(result) => {
          if (result?.id) {
            setForm((p) => ({ ...p, feedTypeId: result.id }))
          }
        }}
      />
    ),
    cageId: (
      <Field label="Cage (optional)" htmlFor="cageId">
        <Select id="cageId" name="cageId" value={form.cageId} onChange={onChange}>
          <option value="">None</option>
          {cages.map((c) => (
            <option key={c.id || c._id} value={c.id || c._id}>
              {c.name}
            </option>
          ))}
        </Select>
        {form.cageId && (
          <p className="mt-2 text-sm text-chart-ink bg-foam border border-foam-deep rounded-lg px-3 py-2">
            Issuing to a cage moves the feed from the store to that cage&apos;s feed bin. It is not
            counted as eaten: the daily entry records what the fish ate, takes it from the bin
            first, and only counts towards FCR.
          </p>
        )}
        {cageList.ready && cages.length === 0 && (
          <DependencyEmpty
            message="No active cages yet — you can still issue without a cage, or stock one first."
            createKind="stocking"
            createLabel="Create stocking"
            secondaryCreateKind="cage"
            secondaryCreateLabel="Create a cage"
          />
        )}
      </Field>
    ),
    usageDate: (
      <Field label="Date" htmlFor="usageDate" required>
        <Input
          id="usageDate"
          name="usageDate"
          type="date"
          value={form.usageDate}
          onChange={onChange}
          required
        />
      </Field>
    ),
    bags: (
      <Field label="Bags" htmlFor="bags">
        <Input
          id="bags"
          name="bags"
          type="number"
          step="0.01"
          min="0"
          value={form.bags}
          onChange={onChange}
          className="font-data"
        />
      </Field>
    ),
    quantityKg: (
      <Field label="Kilograms" htmlFor="quantityKg" hint={`Bag size: ${bagSize} kg`}>
        <Input
          id="quantityKg"
          name="quantityKg"
          type="number"
          step="0.01"
          min="0"
          value={form.quantityKg}
          onChange={onChange}
          className="font-data"
        />
      </Field>
    ),
    notes: (
      <Field label="Optional notes" htmlFor="notes">
        <Textarea id="notes" name="notes" value={form.notes} onChange={onChange} rows={2} />
      </Field>
    ),
  }

  return (
    <FormPage data-tour="page-feed-issue">
      <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted">{t('ops.feedIssue.intro')}</p>

      <FormCard
        title="Issue details"
        subtitle="Enter bags or kilograms — the other field updates from bag size."
      >
        <OutboxPanel compact online={online} kinds={['feed-issue']} />
        <form onSubmit={submit} className="space-y-8">
          <LocationMetaField />
          <FormLayout
            formKey="inventory.feedIssue"
            layout={layout}
            fields={layoutFields}
            coreValues={form}
            idPrefix="fi-cf"
          />

          {canOverride && (
            <div className="rounded-xl border border-warn/30 bg-warn/10 p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-chart-ink">
                <input
                  type="checkbox"
                  name="allowNegative"
                  checked={form.allowNegative}
                  onChange={onChange}
                  className="rounded border-input-border"
                />
                Admin override (allow insufficient stock)
              </label>
              {form.allowNegative && (
                <Field label="Override reason" htmlFor="overrideReason" required>
                  <Input
                    id="overrideReason"
                    name="overrideReason"
                    value={form.overrideReason}
                    onChange={onChange}
                    required
                    placeholder="Why is this override needed?"
                  />
                </Field>
              )}
            </div>
          )}

          <FormActions>
            <Button type="submit" disabled={saving || feedTypes.length === 0} size="lg">
              {saving ? 'Saving…' : 'Issue feed'}
            </Button>
            <Button href="/stock-levels" variant="secondary">
              Cancel
            </Button>
          </FormActions>
        </form>
      </FormCard>
    </FormPage>
  )
}
